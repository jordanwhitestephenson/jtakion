// dependencies
const fs = require('fs');
const AWS = require('aws-sdk');
const util = require('util');
const axios = require('axios');
const FormData = require('form-data');

const https = require('https');
const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 25
});
const sqs = new AWS.SQS({
  httpOptions: { agent }
});

//const getParameter = require('./parameters.js').getParameter;
/*const getOrgId = (environmentName) => getParameter("org-id")(environmentName);
const getApiUrl = (environmentName) => getParameter("api-url")(environmentName);
const getApiToken = (environmentName) => getParameter("api-token")(environmentName);*/

//const getDbArn = (environmentName) => getParameter("db-arn")(environmentName);
//const getSecretArn = (environmentName) => getParameter("secret-arn")(environmentName);
const rdsDataService = new AWS.RDSDataService();

const logItemEvent = require('./itemEventLog.js').logItemEvent;
const finishLogEvents = require('./itemEventLog.js').finishLogEvents;
const events = require('./itemEventLog.js').events;

const maxQueueMessageSize = 262144 - 500;
var itemsToQueueBuffer = [];
var itemsToQueueBufferLength = 0;

const ruleContent = fs.readFileSync('nestedAttributesRule.txt', 'utf8');

const DEFAULT_TIMEOUT = 1000 * 60 * 2; // 2 mins
const DEFAULT_FREQUENCY = 1000; // poll check every 1 second

exports.handler = async (event) => {
    
    const start = Date.now();

	const dbArn = process.env.dbArn;//await getDbArn('default');
	const secretArn = process.env.secretArn;//await getSecretArn('default');

	async function checkIfJobCancelled(jobName) {
		let sqlParams = {
			secretArn: secretArn,
			resourceArn: dbArn,
			sql: 'SELECT stat FROM job WHERE nm = :jobname;',
			database: 'threekit',
			includeResultMetadata: true,
			parameters: [
				{
					'name': 'jobname',
					'value': {
						'stringValue': jobName
					}
				}
			]
		};
		let resp = await rdsDataService.executeStatement(sqlParams).promise();
		console.log('check cancel resp', resp);
		let columns = resp.columnMetadata.map(c => c.name);
		let data = resp.records.map(r => {
			let obj = {};
			r.map((v, i) => {
				obj[columns[i]] = Object.values(v)[0];
			});
			return obj;
		});
		if(data[0]['stat'] === 'cancelled') {
			console.log('job cancelled');
			return false;
		} else {
			console.log('job not cancelled');
			return true;
		}
	}
    
    /* helper functions */
	
	function writeCompletedItemToDatabase(id, type, sourceKey) {
		console.log('writing conpleted item to db ', id, type, sourceKey);
		let sqlParams = {
			secretArn: secretArn,
			resourceArn: dbArn,
			sql: 'INSERT INTO job_item (jid, object_id, item_type) values ((SELECT jid FROM job WHERE nm = :jobname), :objectid, :itemtype)',
			database: 'threekit',
			includeResultMetadata: true,
			parameters: [
				{
					'name': 'jobname',
					'value': {
						'stringValue': sourceKey
					}
				},
				{
					'name': 'objectid',
					'value': {
						'stringValue': id
					}
				},
				{
					'name': 'itemtype',
					'value': {
						'stringValue': type
					}
				}
			]
		};
		return rdsDataService.executeStatement(sqlParams).promise();
	}

	function writeAssetLookup(sourceKey, assetId, groupId, catalogCode, optionId, nm) {
		console.log('writing asset lookup to db ', assetId, groupId, catalogCode, sourceKey);
		let sqlParams = {
			secretArn: secretArn,
			resourceArn: dbArn,
			sql: 'INSERT INTO asset_lookup (jid, group_id, catalog_code, asset_id, option_id, nm) values ((SELECT jid FROM job WHERE nm = :jobname), :groupId, :catalogCode, :assetId, :optionId, :nm)',
			database: 'threekit',
			includeResultMetadata: true,
			parameters: [
				{
					'name': 'jobname',
					'value': {
						'stringValue': sourceKey
					}
				},
				{
					'name': 'groupId',
					'value': {
						'stringValue': groupId
					}
				},
				{
					'name': 'catalogCode',
					'value': {
						'stringValue': catalogCode
					}
				},
				{
					'name': 'assetId',
					'value': {
						'stringValue': assetId
					}
				},
				{
					'name': 'optionId',
					'value': {
						'stringValue': optionId
					}
				},
				{
					'name': 'nm',
					'value': {
						'stringValue': nm
					}
				}
			]
		};
		return rdsDataService.executeStatement(sqlParams).promise();
	}

	function pollJob(jobId, apiUrl, apiToken, options = {}) {
		const { timeout = DEFAULT_TIMEOUT, frequency = DEFAULT_FREQUENCY } = options;
		const startTime = Date.now();
		const prom = new Promise((resolve, reject) => {
			const check = async () => {
				const jobUrl = `${apiUrl}/jobs/${jobId}`;
				try {
					const res = await axios.get(jobUrl, { 'headers': { 'Authorization': 'Bearer '+apiToken } });
					console.log('poll job response: ',res);
					if (res.data.status === 'stopped' || Date.now() - startTime > timeout) {
						return resolve({
							status: res.data.status,
							success:
								res.data.status === 'stopped' &&
								res.data.taskResultFailures === 0,
						});
					}
				} catch (err) {
					console.log('caught error from got job fetch', err);
					reject(err);
				}
			
				setTimeout(check, frequency);
			};
 
   			check();
 		});
 		return prom;
	}

	function logApiCallError(error, url, body, sourceKey) {
		if (error.response) {
			// The request was made and the server responded with a status code
			// that falls out of the range of 2xx
			logItemEvent( events.failedApiCall(url, body, error.response.data, error.response.status, error.response.headers), sourceKey);
			console.log(error.response.data);
			console.log(error.response.status);
			console.log(error.response.headers);
		} else if (error.request) {
			// The request was made but no response was received
			// `error.request` is an instance of XMLHttpRequest in the browser and an instance of
			// http.ClientRequest in node.js
			console.log(error.request);
			logItemEvent( events.noResponseApiCall(url, body, error.request), sourceKey);			
		} else {
			// Something happened in setting up the request that triggered an Error
			console.log('Error', error.message);
			logItemEvent( events.unknownErrorApiCall(url, body, error.message), sourceKey);				
		}
	}
    
    //create a item and assets for a group
    function createOption (option) {
        console.log({'event': 'createGroupOption', 'optionId': option.id});
            
        const item = {'m':{'optionId':option.id},'product': {}};
        
        if (option.im && option.materialId) {
            item.product.asset = {
                'assetId': option.materialId,
                'configuration': '',
                'type': 'material'
            };
        }
        
        if (option.subGroupOptionIds) {
            const attrValues = option.subGroupOptionIds.map(id => {return {assetId: id};});
            const defaultValue = attrValues.length === 1 ? attrValues[0] : {"assetId": ""};
            item.product.attributes = [{
                "type": "Asset",
                "name": option.description,
                "blacklist": [],
                "assetType": "item",
                "values": attrValues,
                "defaultValue": defaultValue
            }];
        }
        item.product.tags = [option.groupTag];
        item.product.metadata = [
            {
                'type': 'Number',
                'name': 'Price',
                'blacklist': [],
                'values': [],
                'defaultValue': parseFloat(option.price)
            },
            {
                'type': 'String',
                'name': 'optionId',
                'blacklist': [],
                'values': [],
                'defaultValue': option.id
            },
            {
                'type': 'String',
                'name': 'groupId',
                'blacklist': [],
                'values': [],
                'defaultValue': option.groupId
            },
			{
				'type': 'String',
				'name': 'optionCode',
				'blacklist': [],
                'values': [],
                'defaultValue': option.name
			},
			{
				'type': 'String',
				'name': 'catalogCode',
				'blacklist': [],
                'values': [],
                'defaultValue': option.catalog.code
			},
			{
				'type': 'Number',
				'name': 'isOption',
				'blacklist': [],
                'values': [],
                'defaultValue': 1
			}
        ];
        if(option.displayAttributesAs) {
			item.product.metadata.push({
				'type': 'String',
				'name': '_UI_displayAttributesAs',
				'blacklist': [],
				'values': [],
				'defaultValue': JSON.stringify(option.displayAttributesAs)
			});
        }
		if(option.thumbnailUrl) {
			item.product.metadata.push({
				'type': 'String',
				'name': '_UI_thumbnailUrl',
				'blacklist': [],
                'values': [],
                'defaultValue': option.thumbnailUrl
			});
		}
        console.log("Attached groupId: " + option.groupId);
        item.product.name = option.description;

		if(option.prices) {
			if(!item.product.attributes) {
				item.product.attributes = [];
			}
			let pricingObj = {
				type: 'Pricing',
				name: 'Pricing',
				values: []
			};
			let pricebookToCurrencyMap = {};
			option.prices.forEach(price => {
				if(!pricebookToCurrencyMap.hasOwnProperty(price.pricebookId)) {
					//not in the map yet
					let currencyArray = [{code: price.currencyCode, price: price.price}];
					pricebookToCurrencyMap[price.pricebookId] = currencyArray;
				} else {
					//in the map already
					let currencyArray = pricebookToCurrencyMap[price.pricebookId];
					currencyArray.push({code: price.currencyCode, price: price.price});
				}
			});
			Object.keys(pricebookToCurrencyMap).forEach(pricebookId => {
				let priceObj = {
					pricebook: pricebookId, 
					currencies: {}
				};
				let currencyArray = pricebookToCurrencyMap[pricebookId];
				currencyArray.forEach(curr => {
					priceObj.currencies[curr.code] = parseFloat(curr.price);
				});
				
				pricingObj.values.push(priceObj);
			});
			item.product.attributes.push(pricingObj);
		}

        return item;
    }
    
    // create a item type product with optional id query
    function createItem (item) {
        console.log({'event': 'createItem', 'itemId': item.id});
        let uploadItem = { 'm':{'itemId':item.id},'query': { 'metadata': {
            'itemId': item.id,
            'catalog_code': item.catalog.code/*,
            'catalog_year': item.catalog.year,
            'catalog_month': item.catalog.month,
            'catalog_day': item.catalog.day,
            'catalog_version': item.catalog.version*/
        }}};
        
        const product = {
            'name': item.pn,
            'type': 'item',
            'orgId': item.orgId,//getOrgId(item.destEnv),
            'description': item.description,
            'tags': [
                'product',
                //`${item.catalog.code}_${item.catalog.year}-${item.catalog.month}-${item.catalog.day}_${item.catalog.version}`
				`${item.catalog.code}`
            ],
            'metadata': [
                {
                    'type': 'String',
                    'name': 'itemId',
                    'blacklist': [],
                    'values': [],
                    'defaultValue': item.id
                },
                {
                    'type': 'String',
                    'name': 'catalog_code',
                    'blacklist': [],
                    'values': [],
                    'defaultValue': item.catalog.code
                },
                {
                    'type': 'String',
                    'name': 'catalog_desc',
                    'blacklist': [],
                    'values': [],
                    'defaultValue': item.catalog.desc
                },
                {
                    'type': 'String',
                    'name': 'catalog_year',
                    'blacklist': [],
                    'values': [],
                    'defaultValue': item.catalog.year
                },
                {
                    'type': 'String',
                    'name': 'catalog_month',
                    'blacklist': [],
                    'values': [],
                    'defaultValue': item.catalog.month
                },
                {
                    'type': 'String',
                    'name': 'catalog_day',
                    'blacklist': [],
                    'values': [],
                    'defaultValue': item.catalog.day
                },
                {
                    'type': 'String',
                    'name': 'catalog_version',
                    'blacklist': [],
                    'values': [],
                    'defaultValue': item.catalog.version
                },
				{
					'type': 'String',
					'name': '_UI_displayAttributesAs',
					'blacklist': [],
					'values': [],
					'defaultValue': JSON.stringify(item.displayAttributesAs)
				}
            ],
			'rules': []
        };
        if (item.modelId) {
            product.asset = {
                'assetId': item.modelId,
                'configuration': '',
                'type': 'model'
            };
        }
        if (item.itemGroups && !item.itemGroups.some(grp => !grp.attributeIds)) {
            product.attributes = item.itemGroups.map(att => {
                const defaultValue = att.attributeIds.length === 1 ? att.attributeIds[0] : {"assetId": ""};
                
                return {
                    'type': 'Asset',
                    'name': att.groupName,
                    "blacklist": [],
                        "assetType": "item",
                        "values": att.attributeIds,
                        "defaultValue": defaultValue
                };
            });
        }

		let rule = {
			"conditions": [],
			"actions": [
				{
					"type": "custom-script",
					"name": "custom-script",
					"content": ruleContent,
					"enabled": false,
					"error": ""
				}
			],
			"name": "Propagate Nested Attribute Values"
		};
		product.rules.push(rule);

		if(item.prices) {
			if(!product.attributes) {
				product.attributes = [];
			}
			let pricingObj = {
				type: 'Pricing',
				name: 'Pricing',
				values: []
			};
			let pricebookToCurrencyMap = {};
			item.prices.forEach(price => {
				if(!pricebookToCurrencyMap.hasOwnProperty(price.pricebookId)) {
					//not in the map yet
					let currencyArray = [{code: price.currencyCode, price: price.price}];
					pricebookToCurrencyMap[price.pricebookId] = currencyArray;
				} else {
					//in the map already
					let currencyArray = pricebookToCurrencyMap[price.pricebookId];
					currencyArray.push({code: price.currencyCode, price: price.price});
				}
			});
			Object.keys(pricebookToCurrencyMap).forEach(pricebookId => {
				let priceObj = {
					pricebook: pricebookId, 
					currencies: {}
				};
				let currencyArray = pricebookToCurrencyMap[pricebookId];
				currencyArray.forEach(curr => {
					priceObj.currencies[curr.code] = parseFloat(curr.price);
				});
				
				pricingObj.values.push(priceObj);
			});
			product.attributes.push(pricingObj);
		}
        uploadItem.product = product;
        return uploadItem;
    }
    
    async function sendItemToQueue(item){
        
        var itemLength = JSON.stringify(item).length;
        
        // console.log(" checking buffer size ("+itemsToQueueBuffer.length+") and length ("+(itemsToQueueBufferLength + itemLength)+") > "+maxQueueMessageSize );
        const sendPromise = 
            ( (itemsToQueueBuffer.length >= 10) || (itemsToQueueBufferLength + itemLength >= maxQueueMessageSize) ) ?
            flushItemsToQueue() : null;
                
        // console.log(  {"event": "bufferQueue", "queueType":"needAsset", "objectType":item.type, "id":item.id} );
        // logItemEvent( item.type == 'item' ? events.enqueueItem(item.id) : events.enqueueOption(item.id), item.sourceKey );
        
        itemsToQueueBuffer.push(item);
        itemsToQueueBufferLength += itemLength;
        
        return sendPromise;
        
    }
    
    // send array of items that need assets created or updated to asset queue
    function flushItemsToQueue() {
        console.log("flushing ",itemsToQueueBuffer.length, " items to queue");
        var params = {
            "Entries": itemsToQueueBuffer.map( (it, i) => {
                console.log( {"event": "enqueue", "queueType":"needAsset", "objectType":it.type, "id":it.id} );
                logItemEvent( it.type == 'item' ? events.enqueueItem(it.id, Date.now() - start) : events.enqueueOption(it.id, Date.now() - start), it.sourceKey );
                return {
                    "Id":it.id,
                    "MessageBody": JSON.stringify(it),
                    "MessageAttributes":{"enqueueTime":{'DataType':'Number','StringValue':Date.now().toString()} }
                };
            }),
            "QueueUrl" : process.env.itemsNeedingAssetsQueue//'https://sqs.us-east-1.amazonaws.com/890084055036/itemsNeedingAssets'
        };
        
        console.log("sending to queue ", util.inspect(params, {depth: 5}) );
        
        itemsToQueueBuffer = [];
        itemsToQueueBufferLength = 0;
        
        const messageSendPromise = sqs.sendMessageBatch(params).send();
        // const messageSendPromise = Promise.resolve("sent to queue");
        
        return messageSendPromise;
    }
    
    async function pushItemsForEnv(key) {
        /*const orgId =  await getOrgId(key);
        const apiUrl = await getApiUrl(key);
        const apiToken = await getApiToken(key);*/
		console.log('key: ',key);
		const orgId = orgMap[key].orgId;
		const apiUrl = orgMap[key].apiUrl;
        const apiToken = orgMap[key].apiToken;
        console.log('orgId: ',orgId);
		console.log('apiUrl: ',apiUrl);
		console.log('apiToken: ',apiToken);
        const itemsToUploadEnv = itemsToUpload[key];
		if(itemsToUploadEnv.length > 0) {
			const itemsData = new FormData();
			console.log("Uploading Ids: ", itemsToUploadEnv.map(i => i.m));
			itemsData.append('file', JSON.stringify(itemsToUploadEnv), 'items.json');
			itemsData.append('sync', 'false');
			const config = { 'headers': {
				'Authorization': 'Bearer '+apiToken,
				...itemsData.getHeaders()
			}};
			console.log({'event': 'startApiCall'}, JSON.stringify(itemsToUploadEnv));
			const t = Date.now();
			return axios.post(
				apiUrl+'/products/import?orgId='+orgId,
				itemsData,
				config
			).catch(error => {
				console.log('erorr uploading ids '+itemsToUploadEnv.map(i => i.m), error);
				itemsToUploadEnv.forEach(itm => {
					let keyArray;
					if(itm.m.itemId) {
						keyArray = bodySourceKeys[itm.m.itemId];
					} else {
						keyArray = bodySourceKeys[itm.m.optionId];
					}			
					if (error.response) {
						// The request was made and the server responded with a status code
						// that falls out of the range of 2xx
						keyArray.forEach(k => {
							logItemEvent( events.failedApiCall(apiUrl+'/products/import?orgId='+orgId, JSON.stringify(itemsToUploadEnv), error.response.data, error.response.status, error.response.headers), k);			
						});					
						console.log(error.response.data);
						console.log(error.response.status);
						console.log(error.response.headers);
					} else if (error.request) {
						// The request was made but no response was received
						// `error.request` is an instance of XMLHttpRequest in the browser and an instance of
						// http.ClientRequest in node.js
						console.log(error.request);
						keyArray.forEach(k => {
							logItemEvent( events.noResponseApiCall(apiUrl+'/products/import?orgId='+orgId, JSON.stringify(itemsToUploadEnv), ''), k);				
						});
					} else {
						// Something happened in setting up the request that triggered an Error
						console.log('Error', error.message);
						keyArray.forEach(k => {
							logItemEvent( events.unknownErrorApiCall(apiUrl+'/products/import?orgId='+orgId, JSON.stringify(itemsToUploadEnv), error.message), k);			
						});
					}
				});
				throw error;
			})
			.then((res) => {
				console.log({'event': 'Successful API call'});
				//get jobId based on result
				const jobId = res.data.jobId;
				//poll for job completion
				return pollJob(jobId, apiUrl, apiToken, {
					timeout: 1000 * 60 * 10,
					frequency: 2000,
				}).then(pollResult => {
					let status = pollResult.status;
					let success = pollResult.success;
					if (status === 'stopped' && success) {
						console.log('items import job stopped, calling job runs api');
						const runsUrl = `${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId}`;
						return axios.get(runsUrl, { 'headers': { 'Authorization': 'Bearer '+apiToken } })
							.then(res => {
								const { runs } = res.data;
								const { results } = runs[0];
								const fileId = results.files[0].id;
								console.log('fileId ', fileId);
								return axios.get(`${apiUrl}/files/${fileId}/content`, { 'headers': { 'Authorization': 'Bearer '+apiToken } })
									.then(fileContent => {
										console.log('item import job run results: ', fileContent);
										let promises = [];	
										if(fileContent && fileContent.data) {											
											const productsCreated = fileContent.data.map(p => {
												if(p.metadata.itemId){
													let sourceKeyArray = bodySourceKeys[p.metadata.itemId];														
													sourceKeyArray.forEach(sourceKey => {
														logItemEvent( events.createdItem(p.metadata.itemId, p.id, Date.now() - t),  sourceKey);	
														let completedItemPromise = writeCompletedItemToDatabase(p.metadata.itemId, 'item', sourceKey);//.then(res => {
															//console.log('wrote completed item to db', res);
														//});	
														promises.push(completedItemPromise);			
													});																	
													return p.metadata.itemId;
												} else {
													let sourceKeyArray = bodySourceKeys[p.metadata.optionId];
													sourceKeyArray.forEach(sourceKey => {					
														logItemEvent( events.createdOption(p.metadata.optionId, p.id, Date.now() - t), sourceKey );
														let completedItemPromise = writeCompletedItemToDatabase(p.metadata.optionId, 'option', sourceKey);//.then(res => {
															//	console.log('wrote completed item to db', res);
														//});
														let assetPromise = writeAssetLookup(sourceKey, p.id, p.metadata.groupId, p.metadata.catalogCode, p.metadata.optionId, p.name);//.then(res => {
															//console.log('wrote asset lookup to db', res);
														//});
														promises.push(completedItemPromise);
														promises.push(assetPromise);
													});
													return p.metadata.optionId;
												}					
											});
											const productsFailed = itemsToUploadEnv.filter(p => {
												console.log(p);
												const itemId = p.m.itemId ? p.m.itemId : p.m.optionId;
												return !productsCreated.includes(itemId);
											}).map(p => {
												console.log(p.m);
												if(p.m.itemId){
													let sourceKeyArray = bodySourceKeys[p.m.itemId];		
													sourceKeyArray.forEach(sourceKey => {				
														logItemEvent( events.errorCreatingItem(p.m.itemId), sourceKey );
													});
													return p.m.itemId;
												} else {
													let sourceKeyArray = bodySourceKeys[p.m.optionId];	
													sourceKeyArray.forEach(sourceKey => {					
														logItemEvent( events.errorCreatingOption(p.m.optionId),  sourceKey);
													});
													return p.m.optionId;
												}
											});
											
											if (productsFailed.length > 0) {
												console.log('Items failed: ', productsFailed);
											}
										}
										return Promise.all(promises).then(r => {
											console.log('completed all db promises for item ', r);
											return fileContent.data;
										});	
										
									}).catch(error => {
										console.log(error);
										//logApiCallError(error, `${apiUrl}/files/${fileId}/content`, '', sourceKey);
										itemsToUploadEnv.forEach(itm => {
											let keyArray;
											if(itm.m.itemId) {
												keyArray = bodySourceKeys[itm.m.itemId];
											} else {
												keyArray = bodySourceKeys[itm.m.optionId];
											}			
											if (error.response) {
												// The request was made and the server responded with a status code
												// that falls out of the range of 2xx
												keyArray.forEach(k => {
													logItemEvent( events.failedApiCall(`${apiUrl}/files/${fileId}/content`, '', error.response.data, error.response.status, error.response.headers), k);			
												});					
												console.log(error.response.data);
												console.log(error.response.status);
												console.log(error.response.headers);
											} else if (error.request) {
												// The request was made but no response was received
												// `error.request` is an instance of XMLHttpRequest in the browser and an instance of
												// http.ClientRequest in node.js
												console.log(error.request);
												keyArray.forEach(k => {
													logItemEvent( events.noResponseApiCall(`${apiUrl}/files/${fileId}/content`, '', ''), k);				
												});
											} else {
												// Something happened in setting up the request that triggered an Error
												console.log('Error', error.message);
												keyArray.forEach(k => {
													logItemEvent( events.unknownErrorApiCall(`${apiUrl}/files/${fileId}/content`, '', error.message), k);			
												});
											}
										});
										throw error;
									});
							}).catch(error => {
								console.log(error);
								//logApiCallError(error, `${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId}`, '', sourceKey);
								itemsToUploadEnv.forEach(itm => {
									let keyArray;
									if(itm.m.itemId) {
										keyArray = bodySourceKeys[itm.m.itemId];
									} else {
										keyArray = bodySourceKeys[itm.m.optionId];
									}			
									if (error.response) {
										// The request was made and the server responded with a status code
										// that falls out of the range of 2xx
										keyArray.forEach(k => {
											logItemEvent( events.failedApiCall(`${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId}`, '', error.response.data, error.response.status, error.response.headers), k);			
										});					
										console.log(error.response.data);
										console.log(error.response.status);
										console.log(error.response.headers);
									} else if (error.request) {
										// The request was made but no response was received
										// `error.request` is an instance of XMLHttpRequest in the browser and an instance of
										// http.ClientRequest in node.js
										console.log(error.request);
										keyArray.forEach(k => {
											logItemEvent( events.noResponseApiCall(`${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId}`, '', ''), k);				
										});
									} else {
										// Something happened in setting up the request that triggered an Error
										console.log('Error', error.message);
										keyArray.forEach(k => {
											logItemEvent( events.unknownErrorApiCall(`${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId}`, '', error.message), k);			
										});
									}
								});
								throw error;
							});
					} else if (status === 'pending') {
						// reached specified timeout to check for completion but job still not done
						console.log('item import job polling timed out for items '+itemsToUploadEnv.map(i => i.m));
						throw new Error('item import job polling timed out for items '+itemsToUploadEnv.map(i => i.m));
						//return item;
					} else {
						// error - job failed
						console.log('item import job failed for items '+itemsToUploadEnv.map(i => i.m));
						//logApiCallError({'message':'job failed'}, apiUrl+'/products/import?orgId='+orgId, JSON.stringify(itemsToUploadEnv), sourceKey);					
						itemsToUploadEnv.forEach(itm => {
							let keyArray;
							if(itm.m.itemId) {
								keyArray = bodySourceKeys[itm.m.itemId];
							} else {
								keyArray = bodySourceKeys[itm.m.optionId];
							}
							keyArray.forEach(k => {
								logItemEvent( events.unknownErrorApiCall(apiUrl+'/products/import?orgId='+orgId, JSON.stringify(itemsToUploadEnv), 'job failed'), k);			
							});						
						});
						throw new Error('item import job failed for items '+itemsToUploadEnv.map(i => i.m));
						//return item;
					}
				}).catch(error => {
					console.log('polling error ',error);
					throw error;
				});				
			});
		} else {
			console.log('no items to upload, skipping job api call');
		}
    }
    
    
    /* process event */
    
    let itemsToUpload = {};
    console.log(util.inspect(event, {depth: 5}));
    
    const bodySourceKeys = {};
	const orgMap = {};
    for(let i=0; i<event.Records.length; i++) {
    	let r = event.Records[i];
        const body = JSON.parse(r.body);
		let notCancelled = await checkIfJobCancelled(body.sourceKey);
		if(notCancelled) {
			const getQueueTime = r.messageAttributes && r.messageAttributes['enqueueTime'] && r.messageAttributes['enqueueTime'].stringValue ? () => Date.now() - Number.parseInt(r.messageAttributes['enqueueTime'].stringValue) : () => null ;
			if(bodySourceKeys.hasOwnProperty(body.id)) {
				let sourceKeyArray = bodySourceKeys[body.id];
				sourceKeyArray.push(body.sourceKey);
			} else {
				bodySourceKeys[body.id] = [body.sourceKey];
			}
			if(!orgMap.hasOwnProperty(body.orgId)) {
				orgMap[body.orgId] = {
					"apiUrl": body.apiUrl,
					"apiToken": body.apiToken,
					"orgId": body.orgId
				};
			}
			console.log('orgMap: ',orgMap);
			if (body && body.type && body.type === 'option') {
				logItemEvent( events.dequeueOption(body.id, getQueueTime()), body.sourceKey );
				console.log('Option: ', body);
				const option = createOption(body);
				logItemEvent( events.creatingOption(body.id), body.sourceKey );
				if (!itemsToUpload[body.orgId]) {//body.destEnv]) {
					itemsToUpload[body.orgId] = [];//body.destEnv] = [];
				}
				if ((body.im && !body.materialId && !body.assetChecked) || (body.subGroupOptions && !body.subGroupOptionIds && !body.assetChecked)) {
					// option will get passed to asset queue
					logItemEvent( events.needsReferencesOption(body.id, (body.im && !body.materialId), (body.subGroupOptions && !body.subGroupOptionIds)), body.sourceKey );
					// console.log({'event': 'needsAssets', type:'option', 'optionId': body.id});
					sendItemToQueue(body);
				} else {
					//itemsToUpload[body.destEnv].push(option);
					itemsToUpload[body.orgId].push(option);
				}
			} else if (body && body.type && body.type === 'item') {
				logItemEvent( events.dequeueItem(body.id, getQueueTime()), body.sourceKey );
				console.log('Item: ', body);
				const item = createItem(body);
				logItemEvent( events.creatingItem(body.id), body.sourceKey );
				if (!itemsToUpload[body.orgId]) {//body.destEnv]) {
					//itemsToUpload[body.destEnv] = [];
					itemsToUpload[body.orgId] = [];
				}
				if (!body.modelId) {
					// item will get passed to asset queue
					logItemEvent( events.needsReferencesItem(body.id, true), body.sourceKey );
					// console.log({'event': 'needsAssets', type:'item', 'itemId': body.id});
					sendItemToQueue(body);
				} else {
					//itemsToUpload[body.destEnv].push(item);
					itemsToUpload[body.orgId].push(item);
				}
			}
		} else {
			console.log('job cancelled, skipping processing', body);
		}
    }
    
    if (itemsToQueueBuffer.length > 0) {
        flushItemsToQueue();
    }
    
    // call product import API with complete items
    return Promise.all(Object.keys(itemsToUpload).map(key => pushItemsForEnv(key)))
    .then( a => {
        return finishLogEvents().then( _ => a );
    });
        
};
