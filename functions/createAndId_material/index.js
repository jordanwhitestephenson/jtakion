// dependencies
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

const RETRY_DELAY = 20; // in seconds
const MAX_NUMBER_OF_RETRIES = 30;

const getParameter = require('./parameters.js').getParameter;
/*const getOrgId = (environmentName) => getParameter("org-id")(environmentName);
const getApiUrl = (environmentName) => getParameter("api-url")(environmentName);
const getApiToken = (environmentName) => getParameter("api-token")(environmentName);*/
const getDamUrl = () => getParameter("api-url")("dam");
const getAuthHeaderForRequest = require('./oAuth-header.js').getAuthHeaderForRequest;

const damImageMap = {};

const logItemEvent = require('./itemEventLog.js').logItemEvent;
const finishLogEvents = require('./itemEventLog.js').finishLogEvents;

exports.handler = async (event) => {
    
    /* Helper functions */

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
			console.log('APIERROR', error);
			logItemEvent( events.unknownErrorApiCall(url, body, error.message), sourceKey);				
		}
	}
    
    // get swatch info from DAM
    async function populateImageMap(page) {
        const damUrl = await getDamUrl();
        if (!page) {
            page = 1;
        }
        const requestUrl = damUrl+'/?limit=1000&total=1&property_assettype=assettype_tileable_images&page='+page;
        
        const authHeader = await getAuthHeaderForRequest({url: requestUrl, method: 'GET'});
        console.log('authHeader: ', JSON.stringify(authHeader));
        return axios.get(requestUrl, {headers: authHeader}).then(res => {
            console.log(res);
            res.data.media.forEach(image => {
                damImageMap[image.name] = {
                    id: image.id,
                    fileName: image.name+'.'+image.extension,
                    dateModified: image.dateModified
                };
            });
            if (res.data.total && res.data.total.count && res.data.total.count > (page * 1000)) {
                return populateImageMap(page+1);
            }
        });
    }
    
    //add materialId
    function addMaterial (option) {
        
        if( requiresMaterial(option) ){
            // console.log("creating/using material from image ",option.image);
            return createOrGetMaterial(option).then( material => {
                console.log(" RESOLVED MATERIAL ", material, option);
                option.materialId = material.id;
                option.materialJobId = material.jobId;
                option.materialChecked = (option.materialChecked || 0) +1;
                console.log({'event': 'materialIdAdded', 'groupTag': option.groupTag, 'optionId': option.id, 'materialId': material.id});
				if(material.id) {
					return getThumbnailUrl(option).then(thumbnailUrl => {
						console.log('thumbnailUrl', thumbnailUrl);
						option['thumbnailUrl'] = thumbnailUrl;
						return option;
					});
				} else {
					return option;
				}
            })
            .catch( err => {
                console.log({'event': 'materialIdAdded', 'groupTag': option.groupTag, 'optionId': option.id, 'error':err});
                option.materialChecked = (option.materialChecked || 0) +1;
                return option;
            });
        } else{
            return Promise.resolve(option);
        }
        
    }

	async function getThumbnailUrl(option) {
		/*const orgId =  await getOrgId(option.destEnv);
        const apiUrl = await getApiUrl(option.destEnv);
        const apiToken = await getApiToken(option.destEnv);*/
		const orgId =  option.orgId;
        const apiUrl = option.apiUrl;
        const apiToken = option.apiToken;
        const sourceKey = option.sourceKey;
		let materialName = option.image.code.replace(/ /g, '-');
		const thumbStartTime = Date.now();
		return axios.get(
			apiUrl+'/assets?orgId='+orgId+'&name='+materialName+'&type=texture' ,
            { 'headers': { 'Authorization': 'Bearer '+apiToken } }
		).then(res => {
			console.log('texture call results', res.data);
			let asset = res.data.assets[0];
			return `${apiUrl}/assets/thumbnail/${asset.id}?orgId=${orgId}`;
		}).catch(error => {
		    const thumbEndTime = Date.now();
			var thumbDuration = Math.abs(thumbStartTime - thumbEndTime) / 1000;
			const startDate = new Date(thumbStartTime);
			const endDate = new Date(thumbEndTime);
			let formattedStart = startDate.toISOString();
			let formattedEnd = endDate.toISOString();
			console.log(error);
			logApiCallError(error, apiUrl+'/assets?orgId='+orgId+'&name='+materialName+'&type=texture start: '+formattedStart+' end: '+formattedEnd+' duration: '+thumbDuration+' seconds', null, sourceKey);
			throw error;
		});
	}
    
    async function createOrGetMaterial(option){
        /*const orgId =  await getOrgId(option.destEnv);
        const apiUrl = await getApiUrl(option.destEnv);
        const apiToken = await getApiToken(option.destEnv);*/
		const orgId =  option.orgId;
        const apiUrl = option.apiUrl;
        const apiToken = option.apiToken;
		const sourceKey = option.sourceKey;
        
        function getMaterials(materialName){
            const matStartTime = Date.now();
            return axios.get(
                apiUrl+'/assets?orgId='+orgId+'&name='+materialName+"&type=material" ,
                { 'headers': { 'Authorization': 'Bearer '+apiToken } }
            )
            .then( (res) => {
                console.log({'event': 'materialQueried', 'materialName': materialName, 'found': JSON.stringify(res.data.assets)});
				console.log('material call results', res.data);
                return res.data;
            }).catch(error => {
                const matEndTime = Date.now();
    			var matDuration = Math.abs(matStartTime - matEndTime) / 1000;
    			const startDate = new Date(matStartTime);
    			const endDate = new Date(matEndTime);
    			let formattedStart = startDate.toISOString();
    			let formattedEnd = endDate.toISOString();
				console.log(error);
				logApiCallError(error, apiUrl+'/assets?orgId='+orgId+'&name='+materialName+'&type=material start: '+formattedStart+' end: '+formattedEnd+' duration: '+matDuration+' seconds', null, sourceKey);
				throw error;
			});
        }
        
        async function importMaterial( image, optionId ){
            const damUrl = await getDamUrl();
            
            var zip = new JSZip();
            
            const imageFileName = image.code.replace(/ /g, '-')+".jpg";
            
            const textureDefinition = { "image": imageFileName };
            const textureFileName = image.code.replace(/ /g, '-')+".pbrtex";
            zip.file( textureFileName , JSON.stringify( textureDefinition ) );
            
            const materialDefinition = { "baseMap": textureFileName };
            const materialFileName = image.code.replace(/ /g, '-')+".pbrmat";
            zip.file( materialFileName , JSON.stringify( materialDefinition ) );
            
            //TODO replace with DAM server call to get image
            // const getImagePromise = axios.get( "https://teknion-assets.s3.amazonaws.com/"+image.file+".jpg", { responseType: 'arraybuffer' } )
            //     .then( r => r.data )
            //     .catch(err => {
            //         console.log("Image not found ", image.file+".jpg", err);
            //         return axios.get( "https://teknion-assets.s3.amazonaws.com/52_Ebony.jpg", { responseType: 'arraybuffer' } ).then( r => r.data);
            //     });
            const cachedFile = damImageMap[image.file] || {};
            const fileId = cachedFile.id;
            if (!fileId) {
                console.log('Image not found in cache ', image.file);
            }
            const requestUrl = damUrl+"/"+fileId+"/download/";
            const authHeader = await getAuthHeaderForRequest({url: requestUrl, method: 'GET'});
            const getImagePromise = axios.get( requestUrl, { headers: authHeader } )
                .then( r => {
                    if (r.data && r.data.s3_file) {
						var s3Url = r.data.s3_file;
                        console.log('Found S3 Location for ', imageFileName, ": ", r.data.s3_file);
                        return axios.get(s3Url, { responseType: 'arraybuffer' })
                            .then( r => {
                                console.log('Found file for ', imageFileName);
                                return r.data;
                            })
                        .catch(err => {
                            console.log("Image not found in Bynder: "+image.file+".jpg", err);
							logApiCallError(err, s3Url, "Option Id: "+optionId+" - Image not found in Bynder ", image.file+".jpg", sourceKey);
                            return axios.get( "https://teknion-assets.s3.amazonaws.com/52_Ebony.jpg", { responseType: 'arraybuffer' } ).then( r => r.data);
                        });
                    }
                })
                .catch(err => {
                    console.log("Image not found in DAM ", image.file+".jpg", err);
					logApiCallError(err, damUrl+"/"+fileId+"/download/", "Option Id: "+optionId+" - Image not found in DAM: "+ image.file+".jpg", sourceKey);
                    return axios.get( "https://teknion-assets.s3.amazonaws.com/52_Ebony.jpg", { responseType: 'arraybuffer' } ).then( r => r.data);
                });
            
            zip.file ( imageFileName , getImagePromise );
            
            return zip.generateAsync({type : "nodebuffer"}).then( z => {
                // console.log("got zip file ready to send ", z);
                
                const filename = image.code.replace(/ /, '-')+".pbrzip";
                const fileUploadData = new FormData();
                fileUploadData.append('file', z, filename);
                
                const fileUploadConfig = { 'headers': {
                        'Authorization': 'Bearer '+apiToken,
                        ...fileUploadData.getHeaders()
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                };
                // console.log("Start API call to upload zip", filename );
                
                if(false){
                    var params = {Bucket: 'teknion-pbr-upload', Key: filename, Body: z};
                    s3.upload(params, function(err, data) {
                      console.log(err, data);
                    });
                }
                
                const filesStartTime = Date.now();
                return axios.post(
                    apiUrl+'/files?orgId='+orgId,
                    fileUploadData,
                    fileUploadConfig
                ).catch(error => {
                    const filesEndTime = Date.now();										
					let filesDuration = Math.abs(filesStartTime - filesEndTime) / 1000;
					const startDate = new Date(filesStartTime);
					const endDate = new Date(filesEndTime);
					let formattedStart = startDate.toISOString();
					let formattedEnd = endDate.toISOString();
					console.log(error);
					logApiCallError(error, apiUrl+'/files?orgId='+orgId+' start: '+formattedStart+' end: '+formattedEnd+' duration: '+filesDuration+' seconds', 'failed calling files API with pbrzip for option Id: '+optionId, sourceKey);
					throw error;
				}).then( r => {
                    console.log({'event': 'fileUpload', 'fileName': filename, 'result': JSON.stringify(r.data)});
                    return r.data;
                }).then( fileUpload => {
                    
                    // console.log("file uploaded ", fileUpload.files[0].id);
                    
                    const importJobData = {
                      "fileId": fileUpload.files[0].id,
                      "orgId": orgId,
                      "sync": false,
                      "title": "Import "+filename
                    };
                    
                    const assetStartTime = Date.now();
                    return axios.post(
                        apiUrl+'/asset-jobs/import?orgId='+orgId,
                        importJobData, 
                        { 'headers': { 'Authorization': 'Bearer '+apiToken } }
                    ).catch(error => {
                        const assetEndTime = Date.now();										
    					let assetDuration = Math.abs(assetStartTime - assetEndTime) / 1000;
    					const startDate = new Date(assetStartTime);
    					const endDate = new Date(assetEndTime);
    					let formattedStart = startDate.toISOString();
    					let formattedEnd = endDate.toISOString();
						console.log(error);
						logApiCallError(error, apiUrl+'/asset-jobs/import?orgId='+orgId+' start: '+formattedStart+' end: '+formattedEnd+' duration: '+assetDuration+' seconds', JSON.stringify(importJobData), sourceKey);
					}).then( r => {
                        console.log({'event': 'assetsImportJobStarted', 'fileId': fileUpload.files[0].id, 'jobId': r.data.jobId });
						console.log('asset-jobs/import results',r.data);
                        return r.data;
                    });
                });
                
            });
        }

        
        return getMaterials(option.image.code.replace(/ /g, '-'))
            .then( data => {
                
                if( data && data.count >= 1 ){
                    return data.assets[0];
                }
                else{ 
                    
                    let materialJob;
                    
                    if( !option.materialJobId ){
                        
                        materialJob = importMaterial( option.image, option.id ).then( jobCreated => {
                            console.log({'event': 'jobStarted', 'jobId': jobCreated.job.id, 'status': jobCreated.job.status});

                            return jobCreated.job;
                        });
                        
                    } else {
                        const matJobStartTime = Date.now();
                        //get job 
                        materialJob = axios.get(
                            apiUrl+'/jobs/'+option.materialJobId,
                            { 'headers': { 'Authorization': 'Bearer '+apiToken } }
                        ).catch(error => {
                            const matJobEndTime = Date.now();										
        					let matJobDuration = Math.abs(matJobStartTime - matJobEndTime) / 1000;
        					const startDate = new Date(matJobStartTime);
        					const endDate = new Date(matJobEndTime);
        					let formattedStart = startDate.toISOString();
        					let formattedEnd = endDate.toISOString();
							console.log(error);
							logApiCallError(error, apiUrl+'/jobs/'+option.materialJobId+' start: '+formattedStart+' end: '+formattedEnd+' duration: '+matJobDuration+' seconds', null, sourceKey);
							throw error;
						}).then( r => {
                            console.log({'event': 'jobRetrieved', 'jobId': option.materialJobId, 'status': r.data.status});
							console.log('job result',r);
                            return r.data;
                        });
                    }
                    
                    //will likely never get here.  If the materialJob is finished, then it would have successfully created the material and queried for it
                    
                    return materialJob.then( job => {
                        
                        if( job.status == 'stopped'){
                            //if status is complete get 
                            
                            return getMaterials(option.image.code.replace(/ /, '-'))
                            .then( data2 => {
                                if(data2 && data2.count >= 1 ){
                                    return data2.assets[0];
                                }
                                else{
                                    console.error("material not found after creation", option.image.code.replace(/ /, '-'));
                                    // throw {"message":"material not found after creation"};
                                    return {jobId:job.id};
                                }
                            });
                            
                        }
                        else{
                            // otherwise return material with no materialId, but materialJobId
                            return Promise.resolve({jobId:job.id});
                        }
                    });
                    
                    
    
                }
            })
            ;
        
    }
    
    function flushToItemQueue(items, queue, delay) {
        console.log("flushing ",items.length, " items to queue");
        
        if(items.length <= 0){
            return Promise.resolve("no items to send to queue");
        }
        
        var params = {
            "Entries": items.map( (it, i) => {
                console.log( {"event": "enqueue", "queue":queue.name, "objectType":it.type, "id":it.id} );
                // logItemEvent( events.enqueueOptionMaterial(it.id, queue.name), it.sourceKey);
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
    if (Object.keys(damImageMap).length === 0) {
        await populateImageMap(1);
    }
    
    console.log('Image Map Length: ', Object.keys(damImageMap).length);
    
    const materialsProcessed = Promise.all(event.Records.map(r => {
        const body = JSON.parse(r.body);
        console.log('Body: ', body);
        
        //const getQueueTime = r.messageAttributes && r.messageAttributes['enqueueTime'] && r.messageAttributes['enqueueTime'].stringValue ? () => Date.now() - Number.parseInt(r.messageAttributes['enqueueTime'].stringValue,10) : () => null ;
        // logItemEvent( events.dequeueOption(body.id, getQueueTime()), body.sourceKey );
        
        return addMaterial(body);
    }));
    
    return materialsProcessed.then( options => {
        const done = options.filter( o => !requiresMaterial(o) );
        const retry = options.filter( o => requiresMaterial(o) && (o.materialChecked <= MAX_NUMBER_OF_RETRIES) );
        const failed = options.filter( o => requiresMaterial(o) && (o.materialChecked > MAX_NUMBER_OF_RETRIES) );
        
        return Promise.all( [
            flushToItemQueue(done, materialFoundQueue, 0),
            flushToItemQueue(retry, materialRetryQueue, RETRY_DELAY),
            flushToItemQueue(failed, materialNotFoundQueue, 0),
            ]);
    }).then( a => {
        return finishLogEvents().then( _ => a);
    });
    
};
    
function requiresMaterial(option){
    return option.image && !option.materialId;
}

const materialFoundQueue = {"name":"materialFound", "queueUrl":process.env.MaterialFoundQueue};
const materialNotFoundQueue = {"name":"materialNotFound", "queueUrl":process.env.MaterialNotFoundQueue};
const materialRetryQueue = {"name":"materialRetry", "queueUrl":process.env.MaterialRetryQueue};


const events = {
    
    dequeueOption: (optionId, queueTime) => ({'event': 'dequeue-processMaterial', "objectType":"option", 'objectId': optionId, 'queueTime':queueTime, "process":"processMaterial"}),
    
    enqueueOptionMaterial: (optionId, queueName) => ({'event': 'enqueue-processMaterial', "queueName":queueName, "objectType":"option", 'objectId': optionId, "process":"processMaterial"}),
    
	failedApiCall: (url, body, errorData, errorStatus, errorHeaders) => ({'event': 'error', 'errorSource':'failedApiCall', 'objectType':'unexpectedError', 'url':url, 'body':body, 'errorData':errorData, 'errorStatus':errorStatus, 'headers':errorHeaders}),
	noResponseApiCall: (url, body, request) => ({'event': 'error', 'errorSource':'noResponseApiCall', 'objectType':'unexpectedError', 'url':url, 'body':body, 'request':request}),
	unknownErrorApiCall: (url, body, message) => ({'event': 'error', 'errorSource':'unknownErrorApiCall', 'objectType':'unexpectedError', 'url':url, 'body':body, 'message':message})
};