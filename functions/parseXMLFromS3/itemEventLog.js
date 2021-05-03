
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

AWS.config.setPromisesDependency(require('bluebird'));

const https = require('https');
const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 25
});

var cloudwatchlogs = new AWS.CloudWatchLogs({
  httpOptions: { agent }
});

const cloudWatchLogGroupName = '/teknion/items/import';
const logProcessName = 'parse';

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
        const logStreamName = logProcessName + "_" + guid;
        
        //try to create log group
        const logGroupParams = {
            logGroupName: logGroupName
        };
        
        var logStreamParams = {
          logGroupName: logGroupName,
          logStreamName: logStreamName
        };
        
        logPromises[sourceKey] = cloudwatchlogs.createLogGroup(logGroupParams).promise()
        .catch( err => {
            //ignore ResourceAlreadyExistsException and OperationAbortedException
            if(err.code === 'ResourceAlreadyExistsException' || err.code === 'OperationAbortedException' ){
                return Promise.resolve("ignoring error creating log group "+logGroupName);
            } else {
                throw err;
            }
        }).then( _ => {
            return cloudwatchlogs.createLogStream(logStreamParams).promise()
            .then( data => ( { events:[], prevLogAction:{"nextSequenceToken":undefined}, cwLogInfo:{groupName:logGroupName, streamName:logStreamName} } ) );
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
    // console.log("logging event with buffer flush ", prev);
    
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

