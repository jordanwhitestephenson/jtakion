// dependencies
const fs = require('fs');
const AWS = require('aws-sdk');
const axios = require('axios');
const FormData = require('form-data');
const JSZip = require("jszip");

const https = require('https');
const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 25
});
const s3 = new AWS.S3();
const sqs = new AWS.SQS({
  httpOptions: { agent }
});

//const getParameter = require('./parameters.js').getParameter;
/*const getParameter = require('./parameters.js').getParameter;
const getOrgId = (environmentName) => getParameter("org-id")(environmentName);
const getApiUrl = (environmentName) => getParameter("api-url")(environmentName);
const getApiToken = (environmentName) => getParameter("api-token")(environmentName);*/

const RETRY_DELAY = 60; // in seconds
const MAX_NUMBER_OF_RETRIES = 10080;

const rdsDataService = new AWS.RDSDataService();

const logItemEvent = require('./itemEventLog.js').logItemEvent;
const finishLogEvents = require('./itemEventLog.js').finishLogEvents;

const DEFAULT_TIMEOUT = 1000 * 60 * 2; // 2 mins
const DEFAULT_FREQUENCY = 1000; // poll check every 1 second

exports.handler = async (event) => {
    
	const dbArn = process.env.dbArn;
	const secretArn = process.env.secretArn;
	
    /* Helper functions */

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
		let columns = resp.columnMetadata.map(c => c.name);
		let data = resp.records.map(r => {
			let obj = {};
			r.map((v, i) => {
				obj[columns[i]] = Object.values(v)[0];
			});
			return obj;
		});
		if(data[0]['stat'] === 'cancelled') {
			return false;
		} else {
			return true;
		}
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

	function lookupAsset(sourceKey, groupId, catalogCode) {
		let sqlParams = {
			secretArn: secretArn,
			resourceArn: dbArn,
			sql: 'SELECT asset_id, option_id, asset_lookup.group_id, asset_lookup.nm FROM job JOIN asset_lookup ON job.jid = asset_lookup.jid WHERE job.nm = :jobname AND asset_lookup.group_id = :groupId AND asset_lookup.catalog_code = :catCode;',
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
					'name': 'catCode',
					'value': {
						'stringValue': catalogCode
					}
				}
			]
		};
		return rdsDataService.executeStatement(sqlParams).promise();
	}
    
    //add material assets to option
    function addMaterialsToOption (option) {
		if(option.image && !option.materialId) {
			// console.log("creating/using material from image ",option.image);
			
			//if it needs material, it will be handled by the 
			if(option.materialChecked){
			    console.log('option material checked before: '+option.assetChecked+' '+option.id);
				option.assetChecked = (option.assetChecked || 0) +1;
				console.log('option material checked after: '+option.assetChecked+' '+option.id);
			}
			return option;
		} else if(option.subGroupOptions && option.subGroupOptions.length > 0 && (!option.subGroupOptionIds || option.subGroupOptionIds.length !== option.subGroupOptions.length)) {
			return getSubgroupOptions(option).then(opt => {
			    console.log('suboption material checked before: '+option.assetChecked+' '+option.id);
				opt.assetChecked = (opt.assetChecked || 0) +1;
				console.log('suboption material checked after: '+option.assetChecked+' '+option.id);
				return opt;
			});
		} else {
			return Promise.resolve(option);
		}
    }

	function logApiCallError(error, url, body, sourceKey, orgId) {
		if (error.response) {
			// The request was made and the server responded with a status code
			// that falls out of the range of 2xx
			logItemEvent( events.failedApiCall(url, body, error.response.data, error.response.status, error.response.headers), sourceKey, orgId);
		} else if (error.request) {
			// The request was made but no response was received
			// `error.request` is an instance of XMLHttpRequest in the browser and an instance of
			// http.ClientRequest in node.js
			console.log(error.request);
			logItemEvent( events.noResponseApiCall(url, body, error.request), sourceKey, orgId);			
		} else {
			// Something happened in setting up the request that triggered an Error
			console.log('Unkown api call Error:', error);
			logItemEvent( events.unknownErrorApiCall(url, body, error.message), sourceKey, orgId);				
		}
	}
    
    function getSubgroupOptions(option) {        
        const metadata = JSON.stringify({'groupId': option.subgroupId, 'catalogCode': option.catalog.code});
        console.log('metadata: '+metadata);		
		return lookupAsset(option.sourceKey, option.subgroupId, option.catalog.code)
        .then( (res) => {
			let columns = res.columnMetadata.map(c => c.name);
			let data = res.records.map(r => {
				let obj = {};
				r.map((v, i) => {
					obj[columns[i]] = Object.values(v)[0];
				});
				return obj;
			});
			console.log('subgroupoptions: '+option.id+' products'+data.length+' '+option.subGroupOptions.length+' '+option.subGroupOptions+' '+!option.subGroupOptions.some(sgo => data.map(p => !p['option_id']).includes(sgo)));
			if(data && !option.subGroupOptions.some(sgo => data.map(p => !p['option_id']).includes(sgo))) {
				let optionIds = [];
				let productsFound = data.filter(p => {
					let included = option.subGroupOptions.includes(p['option_id']);
					if(included === true) {
						if(optionIds.includes(p['option_id'])) {
							included = false;
						} else {
							optionIds.push(p['option_id']);
						}
					}
                    return included;
                });
				if(productsFound.length === option.subGroupOptions.length) {
                    option.subGroupOptionIds = productsFound.map(p => p['asset_id']);
                    console.log({'event': 'subGroupOptionsAdded', 'optionId': option.id, 'options': data.map(p => p['nm'])});
                }
			}            
            return option;
        }).catch(error => {
			console.log(error);
			return option;
		});
    }
    
    // add modelId to item object
    function addModelToItem(item) {
        const hasGroupOptions = item.itemGroups.reduce((agg, grp) => {
            return agg && (!grp.groupOptionIds || (grp.groupOptions && grp.groupOptionIds.length === grp.groupOptions.length));
        }, true);
        if(!item.modelId || !hasGroupOptions){
			return createOrUpdateModel(item).then( completeItem => {
				console.log({'event': 'modelIdAdded', 'itemId': completeItem.id, 'modelId': completeItem.modelId});
				console.log('***COMPLETEITEM', completeItem)
				return completeItem;

			});
        }else{
            return Promise.resolve(item);
        }
    }
    
    // create a model type product with optional id query
    function createOrUpdateModel (item) {
		const orgId =  item.orgId;
        const apiUrl = item.apiUrl;
        const apiToken = item.apiToken;
        const sourceKey = item.sourceKey;
        let itemGroupIds = [];
		item.itemGroups.forEach(ig => {
			itemGroupIds.push(ig.id);
		});
        const groupOptionsPromises = item.itemGroups.map(itemGroup => {
			return lookupAsset(sourceKey, itemGroup.id, item.catalog.code);
        });
        return Promise.all(groupOptionsPromises).then(results => {
			console.log('groupOptionsPromises', item, results);
			console.log('groupOptionQuery results ',JSON.stringify(results));
			let data = results.map(r => {
				let columns = r.columnMetadata.map(c => c.name);
				let data = r.records.map(r => {
					let obj = {};
					r.map((v, i) => {
						obj[columns[i]] = Object.values(v)[0];
					});
					return obj;
				});
				return data;
			});			
			console.log('groupOptionQueryData', data);
			let itemGroupMap = {};
			for(let i=0; i<data.length; i++) {
				let arr = data[i];
				for(let j=0; j<arr.length; j++) {
					let obj = arr[j];
					let groupId = obj['group_id'];
					let optionId = obj['option_id'];
					let nm = obj['nm'];
					let assetId = obj['asset_id'];
					if(itemGroupMap.hasOwnProperty(groupId)) {
						let optionObj = itemGroupMap[groupId];
						optionObj[optionId] = {
							'id': assetId,
							'name': nm
						};
						itemGroupMap[groupId] = optionObj;
					} else {
						let optionObj = {};
						optionObj[optionId] = {
							'id': assetId,
							'name': nm
						};
						itemGroupMap[groupId] = optionObj;
					}
				}
			}

			console.log(itemGroupMap);
            console.log(JSON.stringify(item.itemGroups));
            const hasAllGroupOptions = item.itemGroups.reduce((agg, ig) => agg && ig.groupOptionIds.reduce((agg2, optId) => agg2 && itemGroupMap[ig.id] != null && itemGroupMap[ig.id][optId] != null, true), true);
            console.log(hasAllGroupOptions);
			console.log('hasAllGroupOptions',hasAllGroupOptions);
            if (!hasAllGroupOptions) {
				//logItemEvent( events.notAllGroupOptionsComplete(item.id), item.sourceKey);
                return Promise.resolve(item);
            }
            
            // sort options in each itemGroup
            item.itemGroups.forEach(grp => {
                grp.groupOptionIds.sort((a, b) => itemGroupMap[grp.id][a].name.toLocaleLowerCase().localeCompare(itemGroupMap[grp.id][b].name.toLocaleLowerCase(), 'en', {numeric: true}));
                grp.attributeIds = grp.groupOptionIds.map(optId => {return itemGroupMap[grp.id][optId] != null ? {'assetId': itemGroupMap[grp.id][optId].id} : null;}).filter(id => id);
            });
            
            const layerGroups = (item.itemGroups || []).filter(g => item.layers && item.layers.map(l => l.optNo).includes(g.optNo));
            
            // const getDwgPromise = axios.get( "https://teknion-assets.s3.amazonaws.com/"+item.id+"_3D.dwg", { responseType: 'arraybuffer' } ).then( r => r.data );
            // const fileUploadData = new FormData();
            // fileUploadData.append('file', JSON.stringify([uploadModel]), 'items.json');
            // const fileUploadConfig = { 'headers': {
            //     'Authorization': 'Bearer '+getApiToken(item.destEnv),
            //     ...fileUploadData.getHeaders()
            // }};
            // return axios.post(
            //     getApiUrl(item.destEnv)+'/files?orgId='+getOrgId(item.destEnv),
            //     fileUploadData,
            //     fileUploadConfig
            // ).then( r => {
            //     console.log("uploaded file", r.data);
            //     return r.data;
            // }).then( fileUpload => {
            //     // TODO move model creation / updating into here to set importedFileId
            // });
            const modelId = item.id + '_3D';
            let uploadModel = {
                'query': {
                    'name': modelId,
					"parentFolderId": "assets"
                }, 
                'product': {
                    'name': modelId,
                    'type': 'model',
                    'orgId': orgId,
                    'description': 'Model for '+item.id,
                    'importedFileId': null,
                    'metadata': [
                        {
                            'type': 'Number',
                            'name': 'Price',
                            'blacklist': [],
                            'values': [],
                            'defaultValue': parseFloat(item.price)
                        }
                    ]
                }
            };
            uploadModel.product.attributes = layerGroups.map(att => {
                const attrValues = att.groupOptionIds.map(optId => {return itemGroupMap[att.id][optId] != null ? {'assetId': itemGroupMap[att.id][optId].id} : null;}).filter(id => id);
                const defaultValue = attrValues.length === 1 ? attrValues[0] : {"assetId": ""};
                
                return {
                    'type': 'Asset',
                    'name': att.groupName,
                    "blacklist": [],
                        "assetType": "material",
                        "defaultValue": defaultValue
                };
            });
            
            uploadModel.product.rules = layerGroups.map(att => {
                const layer = item.layers.find(l => l.optNo === att.optNo);
                if (layer) {
                    const ruleName = "Apply "+att.groupName;
                    /*const content = "const materialTag = '"+layer.name+"';\n\n"
                        +"// Get map of all nodes in the model along with their tags\n"
                        +"const nodeTags = api.scene.getAll({from:api.instanceId, plug:'Properties', property:'tags'});\n\n"
                        +"// Now filter these to identify the nodes with the tag we want.\n"
                        +"const materialNodes = Object.keys(nodeTags).filter(nodeId => nodeTags[nodeId].includes(materialTag)\n);\n\n"
                        +"const nodeMaterialPaths = materialNodes.map(nodeId=>[nodeId, 'plugs', 'Material', 0, 'reference']);\n\n"
                        //+"const configurator = api.getConfigurator();\n"
                        //+"const materialAsset = configurator.configuration[\""+att.groupName+"\"];\n\n"
						+"const materialAsset = api.configuration[\""+att.groupName+"\"];\n\n"
                        +"api.scene.setAll(nodeMaterialPaths, materialAsset);";*/
					const content = `/* global api */
					
					(function main() {
						const materialAsset = api.configuration["${att.groupName}"];
					  
						// First, ensure that the incoming item instance actually has a visual asset
						// proxy (the material) to use. Some configuration options may not have any
						// visual data, in which case it has been decided with Teknion that we do
						// nothing (return)
						if (materialAsset) {
						  const proxyAsset = api.scene.get({
							id: materialAsset,
							plug: "Proxy",
							property: "asset",
						  });
						  if (!proxyAsset.assetId) return;
						}
					  
						const materialTag = "${layer.name}";
					  
						// Get map of all nodes in the model along with their tags
						const nodeTags = api.scene.getAll({
						  from: api.instanceId,
						  plug: "Properties",
						  property: "tags",
						});
					  
						// Now filter these to identify the nodes with the tag we want.
						const materialNodes = Object.keys(nodeTags).filter((nodeId) =>
						  nodeTags[nodeId].includes(materialTag)
						);
					  
						const nodeMaterialPaths = materialNodes.map((nodeId) => [
						  nodeId,
						  "plugs",
						  "Material",
						  0,
						  "reference",
						]);
						api.scene.setAll(nodeMaterialPaths, materialAsset);
					  })();`;
                    return {
                        "conditions": [],
                        "actions": [
                            {
                                "type": "custom-script",
                                "name": "custom-script",
                                "content": content,
                                "enabled": false,
                                "error": ""
                            }
                        ],
                        "name": ruleName
                    };
                }
                return undefined;
            }).filter(r => r);
            
            const uploadModelData = new FormData();
            uploadModelData.append('file', JSON.stringify([uploadModel]), 'items.json');
			//make the job asynchronous
			uploadModelData.append('sync', 'false');
            const uploadModelConfig = { 'headers': {
                'Authorization': 'Bearer '+apiToken,
                ...uploadModelData.getHeaders()
            }};
            
            const importStartTime = Date.now();
            return axios.post(
                apiUrl+'/products/import?orgId='+orgId,
                uploadModelData, 
                uploadModelConfig
            ).then( r => {
				//get jobId based on result
				const jobId = r.data.jobId;
				//poll for job completion
				return pollJob(jobId, apiUrl, apiToken, {
					timeout: 1000 * 60 * 10,
					frequency: 2000,
				}).then(pollResult => {
					let status = pollResult.status;
					let success = pollResult.success;
					if (status === 'stopped' && success) {
						const runsUrl = `${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId}`;
						const runsStartTime = Date.now();
						return axios.get(runsUrl, { 'headers': { 'Authorization': 'Bearer '+apiToken } })
							.then(res => {
								const { runs } = res.data;
								const { results } = runs[0];
								const fileId = results.files[0].id;
								const filesStartTime = Date.now();
								return axios.get(`${apiUrl}/files/${fileId}/content`, { 'headers': { 'Authorization': 'Bearer '+apiToken } })
									.then(fileContent => {
										//need to get the model id from the results
										item.modelId = fileContent.data[0].id;
										return item;
									}).catch(error => {
										const filesEndTime = Date.now();										
										let filesDuration = Math.abs(filesStartTime - filesEndTime) / 1000;
										const startDate = new Date(filesStartTime);
										const endDate = new Date(filesEndTime);
										let formattedStart = startDate.toISOString();
										let formattedEnd = endDate.toISOString();
										console.log('error during files content', error);
										logApiCallError(error, `${apiUrl}/files/${fileId}/content start: ${formattedStart} end: ${formattedEnd} duration: ${filesDuration} seconds`, '', sourceKey, orgId);
										throw error;
									});
							}).catch(error => {
								const runsEndTime = Date.now();
								let runsDuration = Math.abs(runsStartTime - runsEndTime) / 1000;
								const startDate = new Date(runsStartTime);
								const endDate = new Date(runsEndTime);
								let formattedStart = startDate.toISOString();
								let formattedEnd = endDate.toISOString();
								console.log('error during jobs runs', error);
								logApiCallError(error, `${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId} start: ${formattedStart} end: ${formattedEnd} duration: ${runsDuration} seconds`, '', sourceKey, orgId);
								throw error;
							});
					} else if (status === 'pending') {
						// reached specified timeout to check for completion but job still not done
						console.log('model import job polling timed for item '+item.pn);
						// reached specified timeout to check for completion but job still not done
						// call api to cancel current job and put back on the queue for retry
						//https://${threekitEnvDomain}/api/jobs/${jobId}/cancel?orgId=${orgId}
						const config = { 'headers': {
							'Authorization': 'Bearer '+apiToken
						}};
						return axios.post(`${apiUrl}/jobs/${jobId}/cancel?orgId=${orgId}`, {}, config)
							.then(res => {
								console.log('response from job cancel call', res);									
							})
							.catch(err => {
								console.log('error calling cancel job api', err);
							})
							.finally(() => {
								// track retries
								item.jobTries = (item.jobTries || 0) +1;
								if(item.jobTries < process.env.jobRetryLimit) {
									//requeue item/option
									return item;
								} else {
									//tried max number of times
									//write to logs
									logItemEvent( events.unknownErrorApiCall(`${apiUrl}/jobs/${jobId}`, JSON.stringify(item), `Job timed out ${process.env.jobRetryLimit} times. Model for item ${item.pn} failed to import.`), sourceKey, orgId);			
									return item;
								}
							});
					} else {
						// error - job failed
						console.log('model import job failed for item '+item.pn);
						logApiCallError({'message':'job failed'}, apiUrl+'/products/import?orgId='+orgId, JSON.stringify(uploadModelData), sourceKey, orgId);					
						return item;
					}
				}).catch(error => {
					console.log('polling error ',error);
					return item;
				});				
            }).catch(error => {
            	const importEndTime = Date.now();
				var importDuration = Math.abs(importStartTime - importEndTime) / 1000;
				const startDate = new Date(importStartTime);
				const endDate = new Date(importEndTime);
				let formattedStart = startDate.toISOString();
				let formattedEnd = endDate.toISOString();
				console.log('error during products import', error);
				logApiCallError(error, apiUrl+'/products/import?orgId='+orgId+' start: '+formattedStart+' end: '+formattedEnd+' duration: '+importDuration+' seconds', JSON.stringify(uploadModelData), sourceKey, orgId);
				return item;
			});
        }).catch(error => {
			console.log('error during group option promises', error);
			return item;
		});
    }
    
    function flushToItemQueue(items, queue, delay) {
        if(items.length <= 0){
            return Promise.resolve("no items to send to queue");
        }
        
        var params = {
            "Entries": items.map( (it, i) => {
                console.log( {"event": "enqueue", "queue":queue.name, "objectType":it.type, "id":it.id} );
                return {
                    "Id":it.id,
                    "DelaySeconds": delay,
                    "MessageBody": JSON.stringify(it),
                    "MessageAttributes":{"enqueueTime":{'DataType':'Number','StringValue':Date.now().toString()} }
                };
            }),
            "QueueUrl" : queue.queueUrl
        };
        
        //console.log("sending to queue ", params );
        
        const messageSendPromise = sqs.sendMessageBatch(params).promise();
        
        return messageSendPromise;
    }
    
    
    /* handle event */
    
    const itemsToUpload = [];
    
    //event.Records.forEach(r => {
	for(let i=0; i<event.Records.length; i++) {
		let r = event.Records[i];
        const body = JSON.parse(r.body);
        console.log('Body in forEach of events', body.type);
		let notCancelled = await checkIfJobCancelled(body.sourceKey);
		if(notCancelled) {
			if (body && body.type && body.type === 'option') {
				const option = addMaterialsToOption(body);
				itemsToUpload.push(option);
			} else if (body && body.type && body.type === 'item') {				
				const item = addModelToItem(body);
				itemsToUpload.push(item);
			}
			else if (body && body.type && body.type === 'family') {				
				const item = addModelToItem(body);
				itemsToUpload.push(item);
			}
		} else {
			console.log('job cancelled, skipping processing', body);
		}
    };
    
    function needsMaterial(option){
        return option.image && !option.materialId && !option.materialChecked ;
    }
    function needsModel(item){
        return item.type === 'item' && !item.modelId ;
    }
    function needsSubGroup(option){
        return option.subGroupOptions && (!option.subGroupOptionIds || option.subGroupOptionIds.length !== option.subGroupOptions.length) ;
    }
    function exceedsCheckingAssets(option){
        return option.assetChecked > MAX_NUMBER_OF_RETRIES ;
    }
    function needsRetry(o){
        return (needsModel(o) || needsSubGroup(o)) && !exceedsCheckingAssets(o);
    }
    
    return Promise.all(itemsToUpload).then( res => {        
        const done = res.filter( o => !needsMaterial(o) && !needsRetry(o) );
        const needingMaterial = res.filter( o => needsMaterial(o) );
        const needingRetry = res.filter( o => needsRetry(o) && !needsMaterial(o) );
        
        const itemsFailedGettingAssets = done.filter( exceedsCheckingAssets );
        
        if (itemsFailedGettingAssets.length > 0) {
			itemsFailedGettingAssets.forEach(ifga => {
				logItemEvent( events.itemsFailedGettingAssets(ifga.id, MAX_NUMBER_OF_RETRIES), ifga.sourceKey, ifga.orgId);
			});
			
        }
        
        return Promise.all( [
            flushToItemQueue(done, referencesDoneQueue, 0),
            flushToItemQueue(needingRetry, referencesRetryQueue, RETRY_DELAY),
            flushToItemQueue(needingMaterial, materialNeededQueue, 0)
            ]);
    }).then( a => finishLogEvents().then(_ => a) );
};


const referencesDoneQueue = {"name":"referencesDone", "queueUrl":process.env.parsedItemsQueue};//"https://sqs.us-east-1.amazonaws.com/890084055036/parsedAPIItems"};
const materialNeededQueue = {"name":"materialNeededQueue", "queueUrl":process.env.optionsNeedingMaterialQueue};//"https://sqs.us-east-1.amazonaws.com/890084055036/optionsNeedingMaterial"};
const referencesRetryQueue = {"name":"referencesRetryQueue", "queueUrl":process.env.itemsNeedingAssetsQueue};//"https://sqs.us-east-1.amazonaws.com/890084055036/itemsNeedingAssets"};

const getQueueTime = (record) => record.messageAttributes && record.messageAttributes['enqueueTime'] && record.messageAttributes['enqueueTime'].stringValue ? () => Date.now() - Number.parseInt(record.messageAttributes['enqueueTime'].stringValue,10) : () => null ;
const optionMissing = (needsMaterial, needsSubGroupOptionIds) => [].concat( needsMaterial ? "materialId" : null).concat( needsSubGroupOptionIds ? "subGroupOptionIds" : null ).filter( x => !!x ); 

const events = {
    
    dequeueItem: (itemId, queueTime) => ({'event': 'dequeue-processReferences', "objectType":"item", 'objectId': itemId, 'queueTime':queueTime, "process":"createItem"}),
    dequeueOption: (optionId, queueTime) => ({'event': 'dequeue-processReferences', "objectType":"option", 'objectId': optionId, 'queueTime':queueTime, "process":"createItem"}),
    
    
    enqueueItemOption: (objectId, objectType, queueName) => ({'event': 'enqueue-processReferences', "queueName":queueName, "objectType":objectType, 'objectId': objectId, "process":"processMaterial"}),
    
    
    needsReferencesItem: (itemId, needsModel) => ({ 'event': 'needsReferences', 'missing': needsModel ? ['modelId']: [], "objectType":"item", 'objectId': itemId, "process":"createItem" }),
    needsReferencesOption: (optionId, needsMaterial, needsSubGroupOptionIds) => 
        ({'event': 'needsReferences', 'missing': optionMissing(needsMaterial, needsSubGroupOptionIds), "objectType":"option", 'objectId': optionId, "process":"createItem"}),
        
    enqueueItem: (itemId, duration) => ({'event': 'enqueue-processMissingReferences', "objectType":"item", 'objectId': itemId, "duration":duration, "process":"createItem"}),
    enqueueOption: (optionId, duration) => ({'event': 'enqueue-processMissingReferences', "objectType":"option", 'objectId': optionId, "duration":duration, "process":"createItem"}),
    
    creatingItem: (itemId) => ({ 'event': 'creatingItem', "objectType":"item", 'objectId': itemId, "process":"createItem" }),
    creatingOption: (optionId) => ({ 'event': 'creatingOption', "objectType":"option", 'objectId': optionId, "process":"createItem" }),
    
    createdItem: (itemId, threeKitItemId, duration) => ({ 'event': 'createdItem', "objectType":"item", 'objectId': itemId, 'threeKitItemId': threeKitItemId, 'duration': duration, "process":"createItem" }),
    createdOption: (optionId, threeKitItemId, duration) => ({ 'event': 'createdOption', "objectType":"option", 'objectId': optionId, 'threeKitItemId': threeKitItemId, 'duration': duration, "process":"createItem" }),
    
    errorCreatingItem: (itemId) => ({'event': 'error', 'errorSource':'creatingItem', "objectType":"item", 'objectId': itemId, "process":"createItem"}),
    errorCreatingOption: (optionId) => ({'event': 'error', 'errorSource':'creatingOption', "objectType":"option", 'objectId': optionId, "process":"createItem"}),

	failedApiCall: (url, body, errorData, errorStatus, errorHeaders) => ({'event': 'error', 'errorSource':'failedApiCall', 'objectType':'unexpectedError', 'url':url, 'body':body, 'errorData':errorData, 'errorStatus':errorStatus, 'errorHeaders':errorHeaders}),
	noResponseApiCall: (url, body, request) => ({'event': 'error', 'errorSource':'noResponseApiCall', 'objectType':'unexpectedError', 'url':url, 'body':body, 'request':request}),
	unknownErrorApiCall: (url, body, message) => ({'event': 'error', 'errorSource':'unknownErrorApiCall', 'objectType':'unexpectedError', 'url':url, 'body':body, 'message':message}),

	notAllGroupOptionsComplete: (itemId) => ({'event': 'notAllGroupOptionsComplete', 'objectType':'item', 'objectId': itemId, 'process':'createItem'}),

	itemsFailedGettingAssets: (itemId, numRetries) => ({'event': 'error', 'errorSource':'itemFailedGettingAssets', 'objectType':'item', 'objectId': itemId, 'numberRetries': numRetries})
};
