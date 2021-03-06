// dependencies
const axios = require('axios');
const date = require('date-and-time');

const getApiToken = require('./parameters.js').getApiToken;

exports.handler = async (event) => {
	console.log("request: " + JSON.stringify(event));
	const apiUrl = process.env.apiUrl;
	const env = event.queryStringParameters.env;
	const orderId = event.pathParameters.orderId;
	const orgId = event.queryStringParameters.orgId;
	console.log('Creating SIF for orderId: '+ orderId + ',with orgId: '+ orgId + ', in env: '+env);
	const apiToken = await getApiToken(orgId)(env); 
	console.log("found api token ",apiToken);
	let oslIndex = 0;

	/********************/
	/* helper functions */
	/********************/
	function handleAxiosError(error) {
		let msg;
		if (error.response) {
			// The request was made and the server responded with a status code that falls out of the range of 2xx
			console.log('error.resonse.data: '+error.response.data);
			console.log('error.resonse.status: '+error.response.status);
			console.log('error.resonse.headers: '+error.response.headers);
			msg = error.response.status;
		  } else if (error.request) {
			// The request was made but no response was received `error.request` is an instance of http.ClientRequest in node.js
			console.log('error.request: '+error.request);
			msg = error.request;
		  } else {
			// Something happened in setting up the request that triggered an Error
			console.log('Error', 'error.message: '+error.message);
			msg = error.message;
		  }
		  console.log('error.config: '+error.config);
		  throw new Error(msg);		  
	}

	function createErrorResponse(code, msg) {
		const response = {
			statusCode: code,
			body: msg
		};
		return response;
	}

	async function getProducts(apiUrl, apiToken, orgId, productList) {
		let productPromises = [];
		productList.forEach(item => {
			productPromises.push(axios.get(
				apiUrl+'/assets/export/'+item+'?orgId='+orgId,
				{ 'headers': { 'Authorization': 'Bearer '+apiToken } }
			));
		});
		console.log('# asset calls: '+productPromises.length);
		return Promise.all(productPromises).then(results => {	
			console.log('completed asset calls');
			let productMap = {};
			results.forEach(res => {
				productMap[res.data.id] = res.data;
			});
			return productMap;
		});
	}

	async function getOrder(orderId, apiUrl, apiToken) {
		console.log('getting order');
        return axios.get(
			apiUrl+'/orders/'+orderId+'?fullConfiguration=true',  
            { 'headers': { 'Authorization': 'Bearer '+apiToken } }
		)
		.catch( (error) => handleAxiosError(error))
        .then( (res) => {
			console.log('got order');
			return res.data;		
        });
	}

	/*async function getCustomer(customerId, apiUrl, apiToken) {
        return axios.get(
            apiUrl+'/customers/'+customerId,
            { 'headers': { 'Authorization': 'Bearer '+apiToken } }
		)
		.catch( (error) => handleAxiosError(error))
        .then( (res) => {
			return res.data;
        });
	}*/

	function configVariantProduct(obj, assetNames, productIds) {
		let keys = Object.keys(obj);
		let key = keys[0];
		assetNames.add(obj[key].itemName);
    if(obj[key].assetId && obj[key].assetId !== '') {
		  productIds.add(obj[key].assetId);
    }
		if(!obj[key].configuration || obj[key].configuration === '') {
			return;
		} else {
			return configVariantProduct(obj[key].configuration, assetNames, productIds);
		}
	}
	function configVariant(obj, assetNames, productIds) {
		if(typeof obj === 'object') {
			assetNames.add(obj.itemName);
      if(obj.assetId && obj.assetId !== '') {
			  productIds.add(obj.assetId);
      }
			if(!obj.configuration || obj.configuration === '') {				
				return;
			} else {
				return configVariantProduct(obj.configuration, assetNames, productIds);
			}
		}
	}

	function processConfigVariant(obj, productMap, result) {
		let keys = Object.keys(obj);
		let key = keys[0];
		let priceCurrencyResult1 = getPriceAndCurrency(productMap, obj[key].assetId);
		let assetId = obj[key].assetId;
		result += addOsl(key, assetId, productMap, priceCurrencyResult1);
		oslIndex++;
		if(obj[key].configuration === '' || obj[key].configuration === undefined) {
			return result;
		} else {
			return processConfigVariant(obj[key].configuration, productMap, result);
		}
	}

	function addOsl(key, assetId, productMap, priceCurrencyResult) {		
		if(!key) {
			key = '';
		}
		let value = '';
		let optionCode = '';
		if(assetId) {			
			console.log('assetId', assetId);
			let product = productMap[assetId];
			console.log('product', product);
			if(product) {
				product.metadata.forEach(met => {
					if(met.name === 'optionCode') {
						optionCode = met.defaultValue;
					}
				});
			}
			if(!optionCode) {
				optionCode = '';
			}
			value = product.name;
		}		
		let osl = `OSL=${oslIndex}
OG=${key}
ON=${optionCode}
OD=${value}
OP=${priceCurrencyResult.price}
END=OSL
`;
return osl;
	}

	function getPriceAndCurrency(productMap, assetId) {
		let product = productMap[assetId];
		let price = '';
		let cur = '';
		if(product) {
			product.attributes.forEach(attr => {
				if(attr.name === 'Pricing') {
					let curs = attr.values[0].currencies;
					Object.keys(curs).forEach(key => {
						if(price === '') {
							cur = key;
							price = curs[key];
						}
					});
				}
			});
		}
		return {price:price,currency:cur};
	}

	function addItem(item, productMap) {
		let product = productMap[item.configuration.productId];
		console.log('addItem', product);
		let priceCurrencyResult = getPriceAndCurrency(productMap, product.id);

		let sifitem = `PN=${product.name}
PD=${product.description}
QT=${item.count}
MC=
MV=
ME=
VC=
VD=
CUR=${priceCurrencyResult.currency}
PL=${priceCurrencyResult.price}
PB=
PS=
B%=
S%=
FG=
CC=
CP=
CT=
U1=
U2=
U3=
U4=
U5=
HT=
DP=
WT=
VO=
NT=
`;
		oslIndex = 0;
		product.attributes.forEach(attr => {
			let key = attr.name;
			if(key !== 'Pricing') {
				let val = item.configuration.variant[key];
				oslIndex = 0;
				//check if val has children
				if(typeof val === 'object') {
					if(!val.configuration || val.configuration === '') {
						let priceCurrencyResult = getPriceAndCurrency(productMap, val.assetId);
						sifitem += addOsl(key, val.assetId, productMap, priceCurrencyResult);
					} else {							
						let priceCurrencyResult = getPriceAndCurrency(productMap, val.assetId);
						let result = addOsl(key, val.assetId, productMap, priceCurrencyResult);
						oslIndex++;
						sifitem += processConfigVariant(val.configuration, productMap, result);
					}
				} else {
					sifitem += addOsl(key, val, productMap, {price:'',currency:''});
				}
				oslIndex++;
			}
		});
		sifitem += `TK=
`;
		return sifitem;
	}

	function addCustomer(customer) {
		if(customer) {
			let names = customer.name.split(' ');
			let firstName = '';
			let lastName = '';
			let first = true;
			names.forEach((name) => {
				if(first === true) {
					firstName = name;
				} else {
					if(lastName === '') {
						lastName = name;
					} else {
						lastName = lastName + ' ' + name;
					}					
				}
				first = false;
			});
			return `
CTB=
FNM=${firstName}
LNM=${lastName}
CMP=${customer.company}
AD1=
AD2=
AD3=
AD4=
ZIP=
CNT=
PHO=
FAX=
EML=
CTY=
CNO=
END=CTB`;
		} else {
			return '';
		}
	}

	function addHeader(order, customer) {
		//set up header variables
		const createdAt = order.createdAt?date.parse(order.createdAt, 'YYYY-MM-DD HH:mm:ss     ', true):'';
		const createDate = order.createdAt?date.format(createdAt, 'MM-DD-YYYY'):'';
		const createTime = order.createdAt?date.format(createdAt, 'HH:mm:ss'):'';
		
		let siffileheader = `SF=orderexport.sif
VR=ProjectSpec Version 5.0.4.0
SV=5.0.4.0
VD=0
ST=TEKNION_ORDER_ENTRY_SIF;ProjectSpec
OE=TeknionOrderEntry
HGT=
DT=${createDate}
TM=${createTime}
NR=
LA=
CU=
UM=
UV=
UA=
UW=
TL=
TS=
TP=
TYP=
CON=
POA=
PNT=
DLT=
DEM=
VIA=
STE=
SBG=
SQN=
DAT=
DAR=
DAS=
CBD=
CBH=
CBP=
AHC=
AHP=
REM=
PIN=
TR1=
TR2=${addCustomer(customer)}
END=OE
GR=
END=GR
`;
		return siffileheader;
	}

	function base64Encode(data) {
		let buff = Buffer.from(data);
		let base64data = buff.toString('base64');
		return base64data;
	}

	/************************/
	/* end helper functions */
	/************************/

	//call the ThreeKit order API
	let orderResult;
	try {
		orderResult = await getOrder(orderId, apiUrl, apiToken);
	} catch (e) {
		if(e instanceof NotFoundError) {
			return createErrorResponse('404', e.message);
		} else {
			return createErrorResponse('500', e.message);
		}
	}
	console.log('Order: '+JSON.stringify(orderResult));

	let productIds = new Set();
	let assetNames = new Set();	
	//find top level product ids to look up and all asset names to look up pricing
	orderResult.cart.forEach((item) => {
		productIds.add(item.configuration.productId);
		let variantKeys = Object.keys(item.configuration.variant);
		for(let i=0; i< variantKeys.length; i++) {
			let key = variantKeys[i];
			let val = item.configuration.variant[key];
			configVariant(val, assetNames, productIds);
		}
	});
	//call asset API to get top level product info (names of top level products not included in order response)
	const productMap = await getProducts(apiUrl, apiToken, orgId, productIds);
	console.log('productMap',productMap);
	
	const customerId = orderResult.customerId;	  
	//parse order result - if customerId field has a value call the customer API
	let cust;
	if(customerId) {
		//const customerResult = await getCustomer(customerId, apiUrl, apiToken);
		//console.log(JSON.stringify(customerResult));
		//cust = customerResult;
	}

	//create the header part of the SIF file
	let header = addHeader(orderResult, cust);
	let sifbody = header;
	//loop through items in order
	orderResult.cart.forEach((item) => {
		//create the item part of the SIF file
		let itm = addItem(item, productMap);
		sifbody += itm;
	});

	let base64data = base64Encode(sifbody);
	
    const response = {
		statusCode: 200,
		headers: { "Content-Type": "text/plain; charset=UTF-8", "Content-Disposition": "attachment; filename=\"orderExport.sif\"" }, //downloadable response
		//headers: { "Content-Type": "text/plain; charset=UTF-8" }, //inline response
		body: base64data,
		isBase64Encoded: true
    };
    return response;
};

class NotFoundError extends Error {
	constructor(...params) {
		super(...params);
	
		// Maintains proper stack trace for where our error was thrown (only available on V8)
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, NotFoundError);
		}
	
		this.name = 'NotFoundError';
	}
}