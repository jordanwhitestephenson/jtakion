
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');


var cloudwatchlogs = new AWS.CloudWatchLogs();

const cloudWatchLogGroupName = '/teknion/items/import';

const logPromises = {};

const guid = uuidv4();

function logItemEvent(itemEvent, sourceKey){
    // console.log("logging item event to stream",sourceKey);
    
    return stepLogStreamPromise(sourceKey)( (logStreamPromise) => {
        
        if(itemEvent){
            const event = createLogEvent(itemEvent);
            
            return logStreamPromise.then( logEventWithBufferFlush(event) );
        }
        
        return logStreamPromise;
    });
}

function createLogEvent(event){
    return { "message": JSON.stringify(event), "timestamp": Date.now() };
}

function finishFlushingLogEvents(){
    return Promise.all(
        Object.keys(logPromises).map(function(key, index) {
            return stepLogStreamPromise(key)( logStreamPromise => logStreamPromise.then(flushEventsToLog) );
        })
    );
}


function stepLogStreamPromise(sourceKey){
    if(!logPromises[sourceKey]) {
        
        const logGroupName = cloudWatchLogGroupName + "/" + sourceKey;
        const logStreamName = 'processItem_'+ guid;

		//replace non-valid characters from logGroupName with -
		const cleanedLogGroupName = logGroupName.replace(/[^\\.\\-_/#A-Za-z0-9]+/g,'-');
        
        var params = {
          logGroupName: cleanedLogGroupName,
          logStreamName: logStreamName
        };
        console.log("creating log stream ",params);
        logPromises[sourceKey] = cloudwatchlogs.createLogStream(params).promise().then( data => {
            return { events:[], prevLogAction:{"nextSequenceToken":undefined}, cwLogInfo:{groupName:cleanedLogGroupName, streamName:logStreamName} };
        });
    }
    return ( stepPromise ) => { 
        logPromises[sourceKey] = stepPromise(logPromises[sourceKey]);
        return logPromises[sourceKey];
    };
}

const flushEventsToLog = (prev) => {
    
    if(prev.events.length > 0){
        var params = {
           "logEvents": prev.events,
           "logGroupName": prev.cwLogInfo.groupName,
           "logStreamName": prev.cwLogInfo.streamName,
           "sequenceToken": prev.prevLogAction ? prev.prevLogAction.nextSequenceToken : undefined
        };
        console.log("flushing "+prev.events.length+" log events: ",params);
            
        return cloudwatchlogs.putLogEvents(params).promise()
            .then( r => ({ events:[], prevLogAction:r, cwLogInfo: prev.cwLogInfo }) )
            .catch(err => {
                console.log("got error logging ", err);
                if(err.expectedSequenceToken){
                    prev.prevLogAction.nextSequenceToken = err.expectedSequenceToken ;
                    console.log("got error logging, retrying with  ", err.expectedSequenceToken);
                    return flushEventsToLog(prev);
                } else {
                    console.log("got error logging, dropping events  ", prev.events);
                    return { events:[], prevLogAction:prev.prevLogAction, cwLogInfo: prev.cwLogInfo };
                }
            } );
    } else {
        return Promise.resolve( prev );
    }
};

const logEventWithBufferFlush = (event) => (prev) => {
    console.log("logging event with buffer flush ", prev);
    
    prev.events.push(event);
    
    const append = Promise.resolve( prev );
    
    if(prev.events.length >= 500 ){
        return append.then( flushEventsToLog );
    } else {
        return append;
    }
    
};

module.exports.logItemEvent = logItemEvent;
module.exports.finishLogEvents = finishFlushingLogEvents;

const optionMissing = (needsMaterial, needsSubGroupOptionIds) => [].concat( needsMaterial ? "materialId" : null).concat( needsSubGroupOptionIds ? "subGroupOptionIds" : null ).filter( x => !!x ); 

module.exports.events = {
    
    dequeueItem: (itemId, queueTime) => ({'event': 'dequeue-processItem', "objectType":"item", 'objectId': itemId, 'queueTime':queueTime, "process":"createItem"}),
    dequeueOption: (optionId, queueTime) => ({'event': 'dequeue-processItem', "objectType":"option", 'objectId': optionId, 'queueTime':queueTime, "process":"createItem"}),
    
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
	unknownErrorApiCall: (url, body, message) => ({'event': 'error', 'errorSource':'unknownErrorApiCall', 'objectType':'unexpectedError', 'url':url, 'body':body, 'message':message})
};