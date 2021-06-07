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

/*const getParameter = require('./parameters.js').getParameter;
const getOrgId = (environmentName) => getParameter("org-id")(environmentName);
const getApiUrl = (environmentName) => getParameter("api-url")(environmentName);
const getApiToken = (environmentName) => getParameter("api-token")(environmentName);*/

const RETRY_DELAY = 60; // in seconds
const MAX_NUMBER_OF_RETRIES = 20;

const logItemEvent = require('./itemEventLog.js').logItemEvent;
const finishLogEvents = require('./itemEventLog.js').finishLogEvents;

exports.handler = async (event) => {
    
    /* Helper functions */
    
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
    
    async function getSubgroupOptions(option) {
        /*const orgId =  await getOrgId(option.destEnv);
        const apiUrl = await getApiUrl(option.destEnv);
        const apiToken = await getApiToken(option.destEnv);*/
		const orgId =  option.orgId;
        const apiUrl = option.apiUrl;
        const apiToken = option.apiToken;
        
        const metadata = JSON.stringify({'groupId': option.subgroupId});
        console.log('metadata: '+metadata);
        return axios.get(
            apiUrl+'/catalog/products?orgId='+orgId+'&metadata='+metadata+"&type=item",
            { 'headers': { 'Authorization': 'Bearer '+apiToken } }
        )
        .then( (res) => {
            const products = res && res.data ? res.data.products : undefined;
            console.log({'event': 'subgroupQueried', 'subgroupId': option.subgroupId, 'found': JSON.stringify(products)});
            console.log('subgroupoptions: '+option.id+' products'+products.length+' '+option.subGroupOptions.length+' '+option.subGroupOptions+' '+!option.subGroupOptions.some(sgo => products.map(p => !p.metadata.optionId).includes(sgo)));
            //if (products && products.length === option.subGroupOptions.length && !option.subGroupOptions.some(sgo => products.map(p => !p.metadata.optionId).includes(sgo))) {
            if (products && !option.subGroupOptions.some(sgo => products.map(p => !p.metadata.optionId).includes(sgo))) {
                products.sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase(), 'en', {numeric: true}));
                //console.log({'event': 'subGroupOptionsAdded', 'optionId': option.id, 'options': products.map(p => p.name)});
                let productsFound = products.filter(p => {
                    return option.subGroupOptions.includes(p.metadata.optionId);
                });
                if(productsFound.length === option.subGroupOptions.length) {
                    option.subGroupOptionIds = productsFound.map(p => p.id);
                    console.log({'event': 'subGroupOptionsAdded', 'optionId': option.id, 'options': products.map(p => p.name)});
                }
                //option.subGroupOptionIds = products.map(p => p.id);
            }
            return option;
        }).catch(error => {
			console.log(error);
			logApiCallError(error, apiUrl+'/catalog/products?orgId='+orgId+'&metadata='+metadata+"&type=item", null, option.sourceKey);
			throw error;
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
                return completeItem;
            });
        }else{
            return Promise.resolve(item);
        }
    }
    
    // create a model type product with optional id query
    async function createOrUpdateModel (item) {
        /*const orgId =  await getOrgId(item.destEnv);
        const apiUrl = await getApiUrl(item.destEnv);
        const apiToken = await getApiToken(item.destEnv);*/
		const orgId =  item.orgId;
        const apiUrl = item.apiUrl;
        const apiToken = item.apiToken;
        const sourceKey = item.sourceKey;
        let itemGroupIds = [];
		item.itemGroups.forEach(ig => {
			itemGroupIds.push(ig.id);
		});
        const groupOptionsPromises = item.itemGroups.map(itemGroup => {
            const metadata = JSON.stringify({'groupId': itemGroup.id});
            return axios.get(
                apiUrl+'/catalog/products?orgId='+orgId+'&metadata='+metadata+"&type=item",
                { 'headers': { 'Authorization': 'Bearer '+apiToken } }
            );
        });
        return Promise.all(groupOptionsPromises).then(results => {
			console.log('groupOptionsPromises', item, results);
            const productArray = results.map(r => r.data.products || []).filter(r => r.length > 0);
            console.log(productArray);
            const itemGroupMap = productArray.reduce((agg, res) => {return {...agg, [res[0].metadata.groupId]: res.reduce((agg2, p) => {return {...agg2, [p.metadata.optionId]: p}}, {})}}, {});
            console.log(itemGroupMap);
            console.log(JSON.stringify(item.itemGroups));
            const hasAllGroupOptions = item.itemGroups.reduce((agg, ig) => agg && ig.groupOptionIds.reduce((agg2, optId) => agg2 && itemGroupMap[ig.id] != null && itemGroupMap[ig.id][optId] != null, true), true);
            console.log(hasAllGroupOptions);
			console.log('hasAllGroupOptions',hasAllGroupOptions);
            if (!hasAllGroupOptions) {
				logItemEvent( events.notAllGroupOptionsComplete(item.id), item.sourceKey);
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
                    'name': modelId
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
                    const content = "const materialTag = '"+layer.name+"';\n\n"
                        +"// Get map of all nodes in the model along with their tags\n"
                        +"const nodeTags = api.scene.getAll({from:api.instanceId, plug:'Properties', property:'tags'});\n\n"
                        +"// Now filter these to identify the nodes with the tag we want.\n"
                        +"const materialNodes = Object.keys(nodeTags).filter(nodeId => nodeTags[nodeId].includes(materialTag)\n);\n\n"
                        +"const nodeMaterialPaths = materialNodes.map(nodeId=>[nodeId, 'plugs', 'Material', 0, 'reference']);\n\n"
                        //+"const configurator = api.getConfigurator();\n"
                        //+"const materialAsset = configurator.configuration[\""+att.groupName+"\"];\n\n"
						+"const materialAsset = api.configuration[\""+att.groupName+"\"];\n\n"
                        +"api.scene.setAll(nodeMaterialPaths, materialAsset);";
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
            const uploadModelConfig = { 'headers': {
                'Authorization': 'Bearer '+apiToken,
                ...uploadModelData.getHeaders()
            }};
            
            return axios.post(
                apiUrl+'/products/import?orgId='+orgId,
                uploadModelData, 
                uploadModelConfig
            ).then( r => {
                if (r.data && r.data.products && r.data.products.length > 0) {
                    console.log("imported model", r.data.products[0]);
                    const model = r.data.products[0];
                    item.modelId = model.id;
                    return item;
                }
                return item;
            }).catch(error => {
				console.log(error);
				logApiCallError(error, apiUrl+'/products/import?orgId='+orgId, JSON.stringify(uploadModelData), sourceKey);
				throw error;
			});
        }).catch(error => {
			console.log(error);
			logApiCallError(error, apiUrl+'/catalog/products?orgId='+orgId+'&metadata=[metadata]&type=item', JSON.stringify(itemGroupIds), sourceKey);
			throw error;
		});
    }
    
    function flushToItemQueue(items, queue, delay) {
        console.log("flushing ",items.length, " items to queue");
        
        if(items.length <= 0){
            return Promise.resolve("no items to send to queue");
        }
        
        var params = {
            "Entries": items.map( (it, i) => {
                console.log( {"event": "enqueue", "queue":queue.name, "objectType":it.type, "id":it.id} );
                logItemEvent( events.enqueueItemOption(it.id, it.type, queue.name), it.sourceKey);
                return {
                    "Id":it.id,
                    "DelaySeconds": delay,
                    "MessageBody": JSON.stringify(it),
                    "MessageAttributes":{"enqueueTime":{'DataType':'Number','StringValue':Date.now().toString()} }
                };
            }),
            "QueueUrl" : queue.queueUrl
        };
        
        console.log("sending to queue ", params );
        
        const messageSendPromise = sqs.sendMessageBatch(params).promise();
        
        return messageSendPromise;
    }
    
    
    /* handle event */
    
    const itemsToUpload = [];
    
    // console.log(event.Records);
    
    event.Records.forEach(r => {
        const body = JSON.parse(r.body);
        console.log('Body: ', body);
        if (body && body.type && body.type === 'option') {
            
            logItemEvent( events.dequeueOption(body.id, getQueueTime(r)), body.sourceKey);
            
            //TODO refactor to seperate getting material from getting subgroups
            
            // console.log('Group: ', body);
            const option = addMaterialsToOption(body);
            itemsToUpload.push(option);
        } else if (body && body.type && body.type === 'item') {
            console.log('Item: ', body);
            
            logItemEvent( events.dequeueItem(body.id, getQueueTime(r)), body.sourceKey);
            
            //TODO refactor to seperate getting subGroups from creating/updating model
            
            const item = addModelToItem(body);
            console.log({'event': 'modelIdAdded', 'itemId': item.id, 'modelId': item.modelId});
            itemsToUpload.push(item);
        }
    });
    
    function needsMaterial(option){
        console.log('needsMaterial: '+option.id+' image: '+option.image+' materialId: '+option.materialId+' materialChecked: '+option.materialChecked);
        return option.image && !option.materialId && !option.materialChecked ;
    }
    function needsModel(item){
        console.log('needsModel: '+item.id+' item.modelid: '+item.modelId);
        return item.type === 'item' && !item.modelId ;
    }
    function needsSubGroup(option){
        console.log('needsSubGroup: '+option.id+' subGroupOptions: '+option.subGroupOptions+' subGroupOptionIds: '+option.subGroupOptionIds);
        return option.subGroupOptions && (!option.subGroupOptionIds || option.subGroupOptionIds.length !== option.subGroupOptions.length) ;
    }
    function exceedsCheckingAssets(option){
        return option.assetChecked > MAX_NUMBER_OF_RETRIES ;
    }
    function needsRetry(o){
        return (needsModel(o) || needsSubGroup(o)) && !exceedsCheckingAssets(o);
    }
    
    return Promise.all(itemsToUpload).then( res => {
        console.log("response from promise.all", JSON.stringify(res) );
        
        const done = res.filter( o => !needsMaterial(o) && !needsRetry(o) );
        const needingMaterial = res.filter( o => needsMaterial(o) );
        const needingRetry = res.filter( o => needsRetry(o) && !needsMaterial(o) );
        
        const itemsFailedGettingAssets = done.filter( exceedsCheckingAssets );
        
        if (itemsFailedGettingAssets.length > 0) {
            console.log({'event': 'itemsFailedGettingAssets', 'items': JSON.stringify(itemsFailedGettingAssets)});
			itemsFailedGettingAssets.forEach(ifga => {
				logItemEvent( events.itemsFailedGettingAssets(ifga.id, MAX_NUMBER_OF_RETRIES), ifga.sourceKey);
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