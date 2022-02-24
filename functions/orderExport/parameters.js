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
    
    const prefix = "/"+environmentName+"/threekit-import/api-tokens";
    
    if( !apiKeyCache[orgId]){
        const params = {
            "Path":prefix
        };
        apiKeyCache[orgId] = ssm.getParametersByPath(params).promise().then( res => {
            return res["Parameters"].reduce( (agg, next) => {
                const name = next["Name"].substring( prefix.length +1 );
                agg[name]=next["Value"];
                return agg;
            }, {});
        });
    }
    
    const forEnv = await apiKeyCache[orgId];
    
    return forEnv[orgId];
}

module.exports.getParameter = getParameter;
module.exports.getApiToken = getApiToken;