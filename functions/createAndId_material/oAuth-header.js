const crypto = require('crypto');
const oauth1a = require('oauth-1.0a');

const getParameter = require('./parameters.js').getParameter;
const getConsumerKey = () => getParameter("consumer-key")("dam");
const getConsumerSecret = () => getParameter("consumer-secret")("dam");
const getTokenKey = () => getParameter("token-key")("dam");
const getTokenSecret = () => getParameter("token-secret")("dam");
const getDamUrl = () => getParameter("api-url")("dam");

async function getAuthHeaderForRequest(request) {
    const consumerKey = await getConsumerKey();
    const consumerSecret = await getConsumerSecret();
    const tokenKey = await getTokenKey();
    const tokenSecret = await getTokenSecret();
    
    const oauth = oauth1a({
        consumer: { key: consumerKey, secret: consumerSecret },
        signature_method: 'HMAC-SHA1',
        hash_function(base_string, key) {
            return crypto
                .createHmac('sha1', key)
                .update(base_string)
                .digest('base64')
        },
    })

    const authorization = oauth.authorize(request, {
        key: tokenKey,
        secret: tokenSecret,
    });

    return oauth.toHeader(authorization);
}

module.exports.getAuthHeaderForRequest = getAuthHeaderForRequest;