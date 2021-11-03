const AWS = require('aws-sdk');

var ssm = new AWS.SSM();

const cache = {};

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


module.exports.getParameter = getParameter;