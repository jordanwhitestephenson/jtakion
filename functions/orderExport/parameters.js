const AWS = require('aws-sdk');

var ssm = new AWS.SSM();

const cache = {};
const apiKeyCache = {};

const getParameter = (parameterName) => async (environmentName) =>{
    
    const prefix = "/"+environmentName+"/threekit-import/";
    
    if( !cache[environmentName]){
        const params = {
            "Path":prefix
        };
        cache[environmentName] = ssm.getParametersByPath(params).promise().then( res => {
            return res["Parameters"].reduce( (agg, next) => {
                const name = next["Name"].substring( prefix.length );
                agg[name]=next["Value"];
                return agg;
            }, {});
        });
    }
    
    const forEnv = await cache[environmentName];
    
    return forEnv[parameterName];
}

const getApiToken = (orgId) => async (environmentName) =>{
    
    const parameterName = "/"+environmentName+"/threekit-import/api-tokens/"+orgId;
    
    if( !apiKeyCache[orgId]){
        const params = {
            "Name":parameterName
        };
        apiKeyCache[orgId] = ssm.getParameter(params).promise().then( res => {
            return res["Parameter"]["Value"];
        });
    }
    
    const foundKey = await apiKeyCache[orgId];
    
    return foundKey;
}

module.exports.getParameter = getParameter;
module.exports.getApiToken = getApiToken;