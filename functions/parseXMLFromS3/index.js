'use strict';

// dependencies
const AWS = require('aws-sdk');
const util = require('util');
const axios = require('axios');
const FormData = require('form-data');
const string2fileStream = require('string-to-file-stream');

AWS.config.setPromisesDependency(require('bluebird'));

var Promise = require("bluebird");

const https = require('https');
const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 25
});

// get reference to S3 client
const s3 = new AWS.S3();
var sqs = new AWS.SQS({
  httpOptions: { agent }
});

const logItemEvent = require('./itemEventLog.js').logItemEvent;
const finishLogEvents = require('./itemEventLog.js').finishLogEvents;

const parse = require('./parser.js').parse;
//const { getParameter } = require('./parameters.js');

const rdsDataService = new AWS.RDSDataService();

const getParameter = require('./parameters.js').getParameter;
/*const getOrgId = (environmentName) => getParameter("org-id")(environmentName);
const getApiUrl = (environmentName) => getParameter("api-url")(environmentName);
const getApiToken = (environmentName) => getParameter("api-token")(environmentName);*/
const getDbArn = (environmentName) => getParameter("db-arn")(environmentName);
const getSecretArn = (environmentName) => getParameter("secret-arn")(environmentName);

const parsedFilesCache = {};

var totalItems = 0;
var apiUrl;
var orgId;
var apiToken;
var orgName;

exports.handler = async (event) => {
    totalItems = 0;
    const start = Date.now();
	var parseErrorsExist = false;
    
    /* handles 
        s3 trigger event 
        or 
        sqs message event - with original s3 trigger event in body 
    */
    const eventBody = event.Records[0].s3 ? event.Records[0] : JSON.parse( event.Records[0].body )  ;
    
    // Read options from the event parameter.
    console.log("Reading options from event:\n", util.inspect(eventBody, {depth: 5}));
    
    const srcBucket = eventBody.s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    const srcKey = decodeURIComponent(eventBody.s3.object.key.replace(/\+/g, " "));
    const itemIdToParse = eventBody.itemIdToParse;	
    
    const s3Params = {
        Bucket: srcBucket,
        Key: srcKey
    };
    
    const s3GetObject = s3.getObject(s3Params); 
	
    //const destEnv = await s3GetObject.promise().then( data => {
	const metadata = await s3GetObject.promise().then( data => {
        console.log("got s3GetObject data", data);
        return data.Metadata;
    });/*.then( meta => {
		//meta && meta['destenv'] ? meta['destenv'] : 'local' 
		apiUrl = meta['basepath'];
		orgId = meta['orgid'];
		apiToken = meta['privatetoken'];
	});*/
	apiUrl = metadata['basepath'];
	orgId = metadata['orgid'];
	apiToken = metadata['privatetoken'];
	orgName = metadata['orgname'];
    //console.log("got destenv ",destEnv);
	console.log('orgId', orgId);
	console.log('apiUrl', apiUrl);
	console.log('apiToken', apiToken);
	console.log('orgName', orgName);
    
    const sourceKey = srcKey.split('.').slice(0,-1).join('.').replace(':nm',':total');
    
    //logItemEvent({"objectType":"environment", "IMPORT_ENVIRONMENT": destEnv}, sourceKey );
	logItemEvent({"objectType":"environment", "IMPORT_ENVIRONMENT": orgName}, sourceKey );

	/*const orgId =  await getOrgId(destEnv);
    const apiUrl = await getApiUrl(destEnv);
    const apiToken = await getApiToken(destEnv);*/
	const dbArn = await getDbArn('default');
	const secretArn = await getSecretArn('default');

	function writeJobStatusToDatabase(total, nm) {
		console.log('writing job to db ', total, nm);
		let sqlParams = {
			secretArn: secretArn,
			resourceArn: dbArn,
			sql: 'INSERT INTO job (nm, total_items, stat) values (:nm, :total, :stat)',
			database: 'threekit',
			includeResultMetadata: true,
			parameters: [
				{
					'name': 'nm',
					'value': {
						'stringValue': nm
					}
				},
				{
					'name': 'total',
					'value': {
						'longValue': total
					}
				},
				{
					'name': 'stat',
					'value': {
						'stringValue': 'pending'
					}
				}
			]
		};
		rdsDataService.executeStatement(sqlParams).promise()
			.then(data => {
				console.log(data);
			}).catch(err => {
				console.log(err);
			});				
	}

	var pricebookByNameMap = {};
	async function getAllPricebooks() {
		return axios.get(
			apiUrl+'/orgs/'+orgId+'/pricebooks?all=true',
			{ 'headers': { 'Authorization': 'Bearer '+apiToken } }
		).then( (res) => {
			return res.data;		
        }).catch(error => {
			logError(error, 'allPricebooks', apiUrl+'/orgs/'+orgId+'/pricebooks?all=true');
			finishLogEvents();
			throw error;
		});
	}
	let allPriceBookResult = await getAllPricebooks();
	allPriceBookResult.pricebooks.forEach(pricebook => {
	    pricebookByNameMap[pricebook.name] = pricebook;
	});
    
    const putItemOnQueue = (item, parsed) => {
        // console.log( "omitting ", item.itemGroups.filter( ig => !ig.groupOptionFirstUsed ).map( ig => ig.id ), " because not primary");
        return Promise.all(
            item.itemGroups.filter( ig => ig.groupOptionFirstUsed ).map( ig => putOptionGroupOnQueue( ig.id, parsed ) )
        ).then( ogs => {
            console.log("sending item to queue ", item.id);
            return sendItemToQueue( item );
        });
    };
    
    const putOptionGroupOnQueue = (optionGroupId, parsed) => {
        const optionGroup = parsed.optionGroupsMap[optionGroupId];
        
        return Promise.all(
            optionGroup.options.map( o => { 
                
                if(o.subgroupId && o.groupOptionFirstUsed){
                    
                    return putOptionGroupOnQueue(o.subgroupId, parsed)
                        .then( s => Promise.resolve( o ).then( sendItemToQueue ) );
                    
                } else {
                
                    return Promise.resolve( o ).then( sendItemToQueue );
                    
                }
            }) 
        );
    };
    
    function pushAllItems(parsed){
        
        console.log("preparing to write " + parsed.items.length + " items");
        
        const itemsPromise = Promise.all( parsed.items.map(  i => putItemOnQueue(i,parsed) ) );
        
        return itemsPromise;
        
    }
    
    function pushItem(itemId, parsed){
        
        const matchingItems = parsed.items.filter( i => i.id === itemId );
        
        console.log("preparing to write item ", itemId, " (matching ", matchingItems.length, " item)" );
        
        const itemsPromise = Promise.all( matchingItems.map( i => putItemOnQueue(i,parsed) ) );
        
        return itemsPromise;
        
    }
    
    function requeueAllItems( parsed ){
        
        return Promise.all(
            parsed.items.map( i => {
                const requeueEvent = {...event.Records[0] };
                requeueEvent.itemIdToParse = i.id;
                var params = {
                    "MessageBody": JSON.stringify(requeueEvent),
                    "QueueUrl" : process.env.foundItemsQueue//'https://sqs.us-east-1.amazonaws.com/890084055036/foundItems'
                };
                    
                console.log("requeueing ", util.inspect(params, {depth: 5}) );
                
                const messageSendPromise = sqs.sendMessage(params).promise();
                // const messageSendPromise = Promise.resolve("sent to queue");
                
                // messageSendPromise.then( (f ) => {console.log("finished sending to queue in ",Date.now() - t, " - ", f) } );
                
                return messageSendPromise;
            })
        );
        
    }
    
    const maxQueueMessageSize = 262144 - 500;
    var itemsToQueueBuffer = [];
    var itemsToQueueBufferLength = 0;
    
    function sendItemToQueue(item){
        
        var itemLength = JSON.stringify(item).length;
        
        // console.log(" checking buffer size ("+itemsToQueueBuffer.length+") and length ("+(itemsToQueueBufferLength + itemLength)+") > "+maxQueueMessageSize );
        const sendPromise = 
            ( (itemsToQueueBuffer.length >= 10) || (itemsToQueueBufferLength + itemLength >= maxQueueMessageSize) ) ?
            flushItemsToQueue() : Promise.resolve("item buffered for queue");
          
        // console.log(  {"event": "bufferQueue", "queueType":"parsed", "objectType":item.type, "id":item.id} );
        
        itemsToQueueBuffer.push(item);
        itemsToQueueBufferLength += itemLength;

		totalItems++;
        
        return sendPromise;
        
    }
    
    function flushItemsToQueue(){
        console.log("flushing ",itemsToQueueBuffer.length, " items to queue");
        
        if(itemsToQueueBuffer.length > 0){
            var params = {
                "Entries": itemsToQueueBuffer.map( (it, i) => {
                    // console.log( {"event": "enqueue", "queueType":"parsed", "objectType":it.type, "id":it.id} );
                    logItemEvent(  {"event": "enqueue-processItem", "objectType":it.type, "objectId":it.id, "duration":Date.now() - start, "process":"parse"}, sourceKey ); 
                    return {
                        "Id":it.id,
                        "MessageBody": JSON.stringify(it),
                        "MessageAttributes":{"enqueueTime":{'DataType':'Number','StringValue':Date.now().toString() } }
                    };
                }),
                "QueueUrl" : process.env.parsedItemsQueue//'https://sqs.us-east-1.amazonaws.com/890084055036/parsedAPIItems'
            };
                
            // console.log("sending to queue ", util.inspect(params, {depth: 5}) );
            
            itemsToQueueBuffer = [];
            itemsToQueueBufferLength = 0;
            
            // const t = Date.now();
            
            const messageSendPromise = sqs.sendMessageBatch(params).promise();
            // const messageSendPromise = Promise.resolve("sent to queue");
            
            // messageSendPromise.then( (f ) => {console.log("finished sending to queue in ",Date.now() - t, " - ", f) } );
            
            return messageSendPromise;
        } else {
            return Promise.resolve("flushed no items to queue");
        }
    }
    
    function setUiDisplayAttributesAsForOption(option, optionGroupsMap) {
    	let displayAttributesAs = {};
		const optionGroup = optionGroupsMap[option.subgroupId];
		let anyOptionsHaveImage = false;
		if(optionGroup) {
			//console.log('ooptionGroup: ',JSON.stringify(optionGroup));
			optionGroup.options.forEach(option => {
				if(option.image) {
					anyOptionsHaveImage = true;
				}
			});
			if(anyOptionsHaveImage) {
				displayAttributesAs[option.description] = {"type":"image"};
			} else {
				displayAttributesAs[option.description] = {"type":"dropdown"};
			}	
		}	
		option['displayAttributesAs'] = displayAttributesAs;
    }

	function setUiDisplayAttributesAs(item, optionGroupsMap) {
		let displayAttributesAs = {};
		item.itemGroups.forEach(ig => {
			//console.log('ig: ',JSON.stringify(ig));
			const optionGroup = optionGroupsMap[ig.id];
			let anyOptionsHaveImage = false;
			if(optionGroup) {
				//console.log('optionGroup: ',JSON.stringify(optionGroup));
				optionGroup.options.forEach(option => {
					if(option.image) {
						anyOptionsHaveImage = true;
					}
				});
				if(anyOptionsHaveImage) {
					displayAttributesAs[optionGroup.description] = {"type":"image"};
				} else {
					displayAttributesAs[optionGroup.description] = {"type":"dropdown"};
				}	
			}		
		});
		item['displayAttributesAs'] = displayAttributesAs;
	}

	function createRow(csvFileContent, elements) {
		csvFileContent += elements.map(element => `"${element}"`).join(',') + '\n';
		return csvFileContent;
	}

	function createHeader(languageMap, csvFileContent) {
		let headerElements = [];
		headerElements.push('Canonical Name');
		Object.keys(languageMap).forEach(key => {
			let lang = languageMap[key];
			headerElements.push(lang.name);
		});
		return createRow(csvFileContent, headerElements);
	}

	function createTranslationArray(obj, defaultLanguageId) {
		let columns = [];
		obj.translations.forEach(translation => {
			let desc = translation.description;
			desc = desc.replace(/"/g,'""');
			if(translation.langId === defaultLanguageId) {
				columns.unshift(desc);//add to beginning for the canonical name
			}
			columns.push(desc);
		});
		return columns;
	}

	function handleTranslations(parsed) {
		console.log('starting translations');
		let canonicalNames = [];
		//create CSV file and send
		let csvFileContent = '';
		let languageMap = parsed.languageMap;
		let defaultLanguageId = parsed.defaultLanguageId;
		//create header row
		csvFileContent = createHeader(languageMap, csvFileContent);
		//create row for each item
		parsed.items.forEach(item => {
			if(item.translations) {
				let columns = createTranslationArray(item, defaultLanguageId);
				if(!canonicalNames.includes(columns[0])) { //only add row if not already one for it
					csvFileContent = createRow(csvFileContent, columns);
					canonicalNames.push(columns[0]);
				}
			}
		});
		//create row for each optiongroup and option
		Object.keys(parsed.optionGroupsMap).forEach(key => {
			let optionGroup = parsed.optionGroupsMap[key];
			if(optionGroup.translations) {
				let columns = createTranslationArray(optionGroup, defaultLanguageId);
				if(!canonicalNames.includes(columns[0])) { //only add row if not already one for it
					csvFileContent = createRow(csvFileContent, columns);
					canonicalNames.push(columns[0]);
				}
			}
			if(optionGroup.options) {
				optionGroup.options.forEach(option => {
					if(option.translations) {
						let columns = createTranslationArray(option, defaultLanguageId);
						if(!canonicalNames.includes(columns[0])) { //only add row if not already one for it
							csvFileContent = createRow(csvFileContent, columns);
							canonicalNames.push(columns[0]);
						}
					}
				});
			}
		});
		//upload translations file
		const data = new FormData();
		data.append('file', string2fileStream(csvFileContent, { path: 'no-this-file.txt' }));
		const config = {
			method: 'post',
			url: apiUrl+'/products/translations?orgId='+orgId,
			headers: {
				authorization: `Bearer ${apiToken}`,
				...data.getHeaders()
			},
			data
		};
		return axios(config);
	}

	function sliceIntoChunks(arr, chunkSize) {
		const res = [];
		for (let i = 0; i < arr.length; i += chunkSize) {
			const chunk = arr.slice(i, i + chunkSize);
			res.push(chunk);
		}
		return res;
	}

	function processChunks(chunks) {
		if(chunks && chunks.length > 0) {
			let chunk = chunks[0];
			let deletePromises = chunk.map(p => {
				return axios.delete(apiUrl+'/assets/'+p.id+'?orgId='+orgId, { 'headers': { 'Authorization': 'Bearer '+apiToken }});
			});
			return Promise.all(deletePromises).then(results => {
				console.log('DONE deletes chunk', results);
				//check if results has any errors, if not remove this chunk
				let hasErrors = false;
				results.forEach(res => {
					if(res.status > 399) {
						hasErrors = true;
					}
				});
				if(!hasErrors) {
					chunks.splice(0,1);
				}
				console.log('chunks after splice', chunks);
				return processChunks(chunks);
			});
		} else {
			return Promise.resolve();
		}
	}

	function handleDeletes(catalogCode) {
		logItemEvent({"event": "deleteStart", "objectType":'optiondelete'}, sourceKey);
		return axios.get(
			apiUrl+'/assets?orgId='+orgId+'&metadata={ "isOption": 1,"catalogCode":"'+catalogCode+'" }&all=true',
			{ 'headers': { 'Authorization': 'Bearer '+apiToken } }
		).then( (res) => {
			console.log('options', res.data.assets);
			//if (res && res.data && res.data.products && res.data.products.length > 0) {
			if (res && res.data && res.data.assets && res.data.assets.length > 0) {
				console.log(res.data.assets.length, ' options to delete');
				let chunks = sliceIntoChunks(res.data.assets, 20);
				console.log('chunks', chunks);
				return Promise.resolve(chunks);
			} else {
				Promise.resolve([]);
			}
		}).then(res => {
			//should get list of chunks
			return processChunks(res);
        }).catch(error => {
			logError(error, 'deleteQuery', apiUrl+'/assets?orgId'+orgId+'&metadata={ "isOption": 1,"catalogCode":"'+catalogCode+'" }&all=true');
			throw error;
		});
	}

	function logError(error, objectType, url) {
		if (error.response) {
			// The request was made and the server responded with a status code
			// that falls out of the range of 2xx
			logItemEvent({'event': 'error', 'errorSource':objectType, 'objectType':objectType, 'url':url, 'errorData':error.response.data, 'errorStatus':error.response.status, 'headers':JSON.stringify(error.response.headers)}, sourceKey);	
			console.log(error.response.data);
			console.log(error.response.status);
			console.log(error.response.headers);
		} else if (error.request) {
			// The request was made but no response was received
			// `error.request` is an instance of XMLHttpRequest in the browser and an instance of
			// http.ClientRequest in node.js
			logItemEvent({'event': 'error', 'errorSource':objectType, 'objectType':objectType, 'url':url, 'request':error.request}, sourceKey);										
		} else {
			// Something happened in setting up the request that triggered an Error
			logItemEvent({'event': 'error', 'errorSource':objectType, 'objectType':objectType, 'url':url, 'message':error.message}, sourceKey);						
		}
	}

	function logTranslationError(error, url) {
		logError(error, 'translation', url);
	}

	function logPricebookError(error, url) {
		logError(error, 'pricebook', url);
	}
    
    /* start parsing */
    
    if( !parsedFilesCache[srcKey] ){
        //parsedFilesCache[srcKey] = parse(s3Params, sourceKey, destEnv);
		parsedFilesCache[srcKey] = parse(s3Params, sourceKey, apiUrl, orgId, apiToken);
    }
	
    return parsedFilesCache[srcKey].then( parsed => {        
        console.log( "parsed ", {parsedItems:{count:parsed.items.length},optionGroups:{count:Object.keys(parsed.optionGroupsMap).length}} );
        console.log('items: ',parsed.items);
		console.log('optionsgroups: ',JSON.stringify(parsed.optionGroupsMap));	
		parseErrorsExist = parsed.parseErrorsExist;
		
		parsed.items.forEach(item => {
			item.prices.forEach(price => {
				if(price.priceZone && price.priceZone.name && pricebookByNameMap.hasOwnProperty(price.priceZone.name)) {
					let pricebook = pricebookByNameMap[price.priceZone.name];
					price['pricebookId'] = pricebook.id;
					price['currencyCode'] = pricebook.currencies[0];
					//price['currencyCode'] = convertCurrency(price.currency, item);
				} else {
					let priceZoneName;
					if(price.priceZone && price.priceZone.name) {
						priceZoneName = price.priceZone.name;
					} else {
						priceZoneName = price.zoneId;
					}
					logItemEvent({'event': 'error', 'errorSource':'priceZoneNotFound', 'objectType':'item', 'objectId': item.id, 'priceZone':priceZoneName}, sourceKey);
					parseErrorsExist = true;
				}
			});
		});
		Object.keys(parsed.optionGroupsMap).forEach(key => {
			let optionGroup = parsed.optionGroupsMap[key];
			if(optionGroup.options) {
				optionGroup.options.forEach(option => {
					option.prices.forEach(price => {
						if(price.priceZone && price.priceZone.name && pricebookByNameMap.hasOwnProperty(price.priceZone.name)) {
							let pricebook = pricebookByNameMap[price.priceZone.name];
							price['pricebookId'] = pricebook.id;
							price['currencyCode'] = pricebook.currencies[0];
							//price['currencyCode'] = convertCurrency(price.currency, option);
						} else {
							let priceZoneName;
							if(price.priceZone && price.priceZone.name) {
								priceZoneName = price.priceZone.name;
							} else {
								priceZoneName = price.zoneId;
							}
							logItemEvent({'event': 'error', 'errorSource':'priceZoneNotFound', 'objectType':'option', 'objectId': option.id, 'priceZone':priceZoneName}, sourceKey);	
							parseErrorsExist = true;								
						}						
					});
				});
			}
		});
		parsed.items.forEach(item => {
			setUiDisplayAttributesAs(item, parsed.optionGroupsMap);
		});
		Object.keys(parsed.optionGroupsMap).forEach(key => {
			let optionGroup = parsed.optionGroupsMap[key];
			if(optionGroup.options) {
				optionGroup.options.forEach(option => {
					if(option.subgroupId) {
						setUiDisplayAttributesAsForOption(option, parsed.optionGroupsMap);
					}
				});
			}
		});
		
		return handleDeletes(parsed.catalogCode).then(res => {
			console.log('finished deletes');
			logItemEvent({"event": "deleteComplete", "objectType":'optiondelete'}, sourceKey);
			return handleTranslations(parsed).then(res => {
				console.log('finished translations');
				logItemEvent({"event": "translations-added", "objectType":'translation'}, sourceKey);
				if(parseErrorsExist) {
					logItemEvent({"event": "error", "errorSource": "parseErrors", "objectType":"parse"}, sourceKey);
					return Promise.all([
						finishLogEvents()
					]);
				} else {
					return pushAllItems(parsed).then( r => {
						console.log('total items in import',totalItems);
						logItemEvent({"TOTAL_ITEMS": totalItems,"Id":"TOTAL_ITEMS"}, sourceKey );						
						return Promise.all([
							r,
							flushItemsToQueue(), 
							finishLogEvents(),
							writeJobStatusToDatabase(totalItems, sourceKey)
						]);
					}).then( res => {
						// console.log("FINISHED ALL for ", srcKey, util.inspect(res, {depth: 5}) );
						console.log('res after promise all',res);
						console.log( "queued ", {parsedItems:{count:parsed.items.length},optionGroups:{count:Object.keys(parsed.optionGroupsMap).length},queuedItems:{count:res[0].length}} );
						return {parsedItems:{count:parsed.items.length},optionGroups:{count:Object.keys(parsed.optionGroupsMap).length},queuedItems:{count:res[0].length}};
					});
				}
			}).catch(error => {
				console.log('error', error);
				logTranslationError(error, apiUrl+'/products/translations?orgId='+orgId);	
				finishLogEvents();	
				throw error;	
			});
		}).catch(error => {
			console.log('error', error);
			finishLogEvents();	
			throw error;
		})
    });

};