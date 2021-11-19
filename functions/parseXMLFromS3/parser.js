
const AWS = require('aws-sdk');
const sax = require("sax");
const s3 = new AWS.S3();

AWS.config.setPromisesDependency(require('bluebird'));

const logItemEvent = require('./itemEventLog.js').logItemEvent;
    
const parse = (s3Params, sourceKey, apiUrl, orgId, apiToken) => {//destEnv) => {
    
    const optionGroupsMap = {};
    const itemsToWrite = [];
    const imagesMap = {};
    var viewId3D;

	const currencies = [];
	const priceZones = [];
	const priceZoneMap = {};

	const languageMap = {};
	var defaultLanguageId = null;
	var parseErrorsExist = false;
	var catalogCode = null;
    
    function writeImage(image) {
        // console.log("writing image",image);
        imagesMap[image.code] = image;
    }
    
    async function writeItem(item) {
        // console.log( {"event": "parse", "objectType":"item", "itemId":item.id} );
        //logItemEvent( {"event": "parse", "objectType":"item", "objectId":item.id, "process":"parse"}, sourceKey );
        itemsToWrite.push(item);
    }
    
    async function writeOptionGroup(optionGroup) {
        // console.log( {"event": "parse", "objectType":"group", "optionGroupId":optionGroup.id, "optionsCount": optionGroup.options.length} );
        //logItemEvent( {"event": "parse", "objectType":"group", "objectId":optionGroup.id, "optionsCount": optionGroup.options.length, "process":"parse"}, sourceKey );
        optionGroupsMap[optionGroup.id] = optionGroup;
    }

	async function writeCurrency(currency) {
		//console.log('write currency: ', currency);
		currencies.push(currency);
	}

	async function writePriceZone(priceZone) {
		//console.log('write priceZone: ', priceZone);
		priceZones.push(priceZone);
	}

	async function writeLanguage(language) {
		languageMap[language.langId] = language;
		if(defaultLanguageId === null) { //set default langauge id to the id of the first language
			defaultLanguageId = language.langId;
		}
	}
    
    const usedOptionGroups = new Set();
    
    function postProcessParsedItems(){
		priceZones.forEach( zone => {
			let curr;
			currencies.forEach( currency => {
				if(currency.currencyId === zone.currencyId) {
					curr = currency;
				}
			});
			priceZoneMap[zone.zoneId] = {priceZone:zone, currency: curr};
		});
        // itemsToWrite.sort( (a,b) => {
        //     if (a.id < b.id) {
        //         return -1;
        //     }
        //     if (a.id > a.id) {
        //         return 1;
        //     }
        //     return 0;
        // });
        
        itemsToWrite.forEach( item => {
            
            item.type = "item";
            item.sourceKey = sourceKey;
            //item.destEnv = destEnv;
			item.apiToken = apiToken;
			item.apiUrl = apiUrl;
			item.orgId = orgId;

			if(item.prices) {
				//link each price with the zone and currency
				item.prices.forEach( price => {
					if(priceZoneMap.hasOwnProperty(price.zoneId)) {
						let priceZoneObj = priceZoneMap[price.zoneId];
						price.currency = priceZoneObj.currency;
						price.priceZone = priceZoneObj.priceZone;
						price.priceZone.name = price.currency.name; //pricebooks will be set up in 3kit with the name = currency name
					}
				});
			}
        
            item.itemGroups.forEach( ig => { 
                const group = optionGroupsMap[ig.id];
					if(group) {
					ig.groupTag = group.id+'-'+group.description.replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
					ig.groupName = group.description;
					ig.groupOptionIds = group.options.map(opt => opt.id);
					ig.groupOptionFirstUsed = !usedOptionGroups.has(ig.id);
					if(!usedOptionGroups.has(ig.id)){
						postProcessParsedOptionGroup(group);
					}
				} else {
					logItemEvent({'event':'error', 'errorSource':'itemGroupMissing', 'objectType':'item', 'objectId': item.id, 'missingGroup':ig.id}, sourceKey);
					parseErrorsExist = true;
				}
            } );
            
            Object.keys(optionGroupsMap).forEach(key => {
                const group = optionGroupsMap[key];
                setOptionGroupPricing(group);
            });
            
            // logItemEvent(  {"event": "enqueue-processItem", "objectType":item.type, "objectId":item.id, "process":"parse"} ); 
            // console.log("prepared item ",item," to send to queue");
            
            return item;
        });
    }

	function setOptionGroupPricing(group) {
		group.options.forEach( o => {
			if(o.prices) {
				o.prices.forEach( price => {
					if(priceZoneMap.hasOwnProperty(price.zoneId)) {
						let priceZoneObj = priceZoneMap[price.zoneId];
						price.currency = priceZoneObj.currency;
						price.priceZone = priceZoneObj.priceZone;
						price.priceZone.name = price.currency.name; //pricebooks will be set up in 3kit with the name = currency name
					}
				});
			}
		});
	}
    
    function postProcessParsedOptionGroup(group){
        usedOptionGroups.add(group.id);
        group.options.forEach( o => postProcessParsedOption(o, group) );
    }
    
    function postProcessParsedOption(option, optionGroup){
        
        option.type = "option";
        option.groupId = optionGroup.id;
        option.groupTag = optionGroup.id+'-'+optionGroup.description.replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        option.groupName = optionGroup.description;
        option.sourceKey = sourceKey;
        //option.destEnv = destEnv;
		option.apiToken = apiToken;
		option.apiUrl = apiUrl;
		option.orgId = orgId;
        
        if(option.im) {
            option.image = imagesMap[option.im];
			if(!imagesMap.hasOwnProperty(option.im)) {
				logItemEvent({'event':'error', 'errorSource':'optionImageMissing', 'objectType':'option', 'objectId': option.id, 'missingImage':option.im}, sourceKey);
				parseErrorsExist = true;
			}
        }
        
        if(option.subgroupId){
            const subgroup = optionGroupsMap[option.subgroupId];
			if(subgroup) {
				option.subGroupTag = subgroup.id+'-'+subgroup.description.replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
				option.subGroupName = subgroup.description;
				option.subGroupOptions = (subgroup.options || []).map(opt => opt.id);
				option.groupOptionFirstUsed = !usedOptionGroups.has(option.subgroupId);
				if(!usedOptionGroups.has(option.subgroupId)){
					postProcessParsedOptionGroup(subgroup);
				}
			} else {
				logItemEvent({'event':'error', 'errorSource':'optionSubgroupMissing', 'objectType':'option', 'objectId': option.id, 'missingSubGroup':option.subgroupId}, sourceKey);
				parseErrorsExist = true;
			}
        }
    }
    
    const options = { 'trim': true, 'normalize': true };
    var saxStream = sax.createStream(false, options);
    
    var identFunc = function(t) { return t; };
    var setDescriptionOn = function( describeMe, textObj ) { 
        return (describeMe != null) ? function( t ){ 
			textObj.description = t;
			describeMe.translations.push(textObj);
			if(textObj.langId === defaultLanguageId) { //only set description if it is the default language id (could be multiple languages)
				describeMe.description = t;
			}
		} : identFunc ;
    };
    var setFileNamenOn = function( fileNameMe ) { 
        return (fileNameMe != null) ? function( t ){  fileNameMe.fileName = t } : identFunc ;
    };
    var setPriceOn = function( priceMe ) { 
		if(priceMe != null) {
			return function( p ) {
				let priceObj = priceMe.prices.pop();
				priceObj.price = p;
				priceMe.prices.push(priceObj);
			}
		} else {
			return identFunc;
		}
    };
	/*var setPriceOnOld = function(priceMe) {
		return (priceMe != null) ? function( p ){  priceMe.price = p } : identFunc ;
	}*/
	var setNameOn = function( nameMe ) {
		return (nameMe != null) ? function( t ){ nameMe.name = t } : identFunc;
	}
    
    var currentContext = null;
    
    var currentCatalog = null;
    
    var currentItem = null;
    var currentItemLayer = null;
    var currentItemGroup = null;
    var currentImage = null;
    var setFromText = function(t){};
    var currentOptionGroup = null;
    var currentOption = null;
    
    // const parseHandler = {
    //     open: {},
    //     close: {},
    //     text: {}
    // };
	var currentCurrency = null;
	var currentPriceZone = null;
	var currentLanguage = null;
	var currentText = null;

	var nodes = [];
    
    
    saxStream
    .on("opentag",  function (node) {
		nodes.push(node);
        switch( node.name ){
			case 'LANGUAGE':
				currentLanguage = {};
				currentLanguage.langId = node.attributes.LANG_ID;
				setFromText = setNameOn(currentLanguage);
				break;
			case 'CURRENCY':
				currentCurrency = {};
				currentCurrency.code = node.attributes.CODE;
				currentCurrency.currencyId = node.attributes.CURRENCY_ID;
				setFromText = setNameOn(currentCurrency);
                break;
			case 'PRICE_ZONE':
				currentPriceZone = {};
				currentPriceZone.currencyId = node.attributes.CURRENCY_ID;
				currentPriceZone.zoneId = node.attributes.ZONE_ID;
				setFromText = setNameOn(currentPriceZone);
				break;
            case 'CATALOG':
                currentCatalog = {};
                currentCatalog.code = node.attributes.CODE;
                currentCatalog.desc = node.attributes.DESC;
                currentCatalog.year = node.attributes.YEAR;
                currentCatalog.month = node.attributes.MONTH;
                currentCatalog.day = node.attributes.DAY;
                currentCatalog.version = node.attributes.VERSION;
				catalogCode = node.attributes.CODE;
            case 'VIEW':
                if(node.attributes.VIEW_CODE === '3'){
                    viewId3D = node.attributes.VIEW_ID;
                }
                break;
            case 'IMAGE':
                currentImage = {};
                currentImage.code = node.attributes.CODE;
                currentImage.file = node.attributes.FILE;
                break;
            case 'ITEM':
                currentItem = {};
                currentItem.itemGroups = [];
                currentItem.layers = [];
                currentItem.id = node.attributes.ID;
                currentItem.pn = node.attributes.PN;
                currentItem.vendorId = node.attributes.VENDOR_ID;
                if (currentCatalog) {
                    currentItem.catalog = currentCatalog;
                }
				currentItem.translations = [];
                currentContext = currentItem;
                break;
            case 'TEXT':
				let parentNode = nodes[nodes.length-2];
				if(parentNode.name !== 'PROMPTS') { 
					currentText = {};
					currentText.langId = node.attributes.LANG_ID;
					setFromText = setDescriptionOn(currentContext, currentText);
				}
                break;
            case 'PRICE':
				if(!currentContext.prices) {
					currentContext.prices = [];
				}
				currentContext.prices.push({zoneId:node.attributes.ZONE_ID});
                setFromText = setPriceOn(currentContext);
                break;
            case 'CAD_FILE':
                if(node.attributes.VIEW_ID == viewId3D){
                    setFromText = setFileNamenOn(currentContext);
                }
                break;
            case 'ITEM_GROUP':
                currentItemGroup = {};
                currentItemGroup.id = node.attributes.ID;
                currentItemGroup.optNo = node.attributes.OPTNO;
                break;
            case 'LAYER':
                currentItemLayer = {};
                currentItemLayer.name = node.attributes.NAME;
                currentItemLayer.optCode = node.attributes.OPTCODE;
                currentItemLayer.optNo = node.attributes.OPTNO;
                break;
            case 'GROUP':
                currentOptionGroup = {};
                currentOptionGroup.id = node.attributes.ID;
                currentOptionGroup.name = node.attributes.NAME;
                currentOptionGroup.options = [];
				currentOptionGroup.translations = [];
                currentContext = currentOptionGroup;
                break;
            case 'OPTION':
                currentOption = {};
                currentOption.id = node.attributes.ID;
                currentOption.name = node.attributes.NAME;
                currentOption.im = node.attributes.IM;
                if(node.attributes.SUBGROUP_ID){
                    currentOption.subgroupId = node.attributes.SUBGROUP_ID;
                }
				if (currentCatalog) {
                    currentOption.catalog = currentCatalog;
                }
				currentOption.translations = [];
                currentContext = currentOption;
                break;
            default: 
                break;
      }
    }).on("text", function (t) {
      setFromText(t);
    }).on("closetag",  function (node) {
		nodes.pop();
        switch( node ){
			case 'LANGUAGE':
				writeLanguage(currentLanguage);
				currentLanguage = null;
				setFromText = identFunc;
				break;
			case 'CURRENCY':
				writeCurrency(currentCurrency);
				setFromText = identFunc;
				break;
			case 'PRICE_ZONE':
				writePriceZone(currentPriceZone);
				setFromText = identFunc;
				break;
            case 'CATALOG':
                currentCatalog = null;
                break;
            case 'IMAGE':
                writeImage(currentImage);
                break;
            case 'ITEM':
                currentContext = null;
                writeItem(currentItem);
                break;
            case 'TEXT':
				currentText = null;
                setFromText = identFunc;
                break;
            case 'PRICE':
                setFromText = identFunc;
                break;
            case 'CAD_FILE':
                setFromText = identFunc;
                break;
            case 'ITEM_GROUP':
                currentItem.itemGroups.push(currentItemGroup);
                break;
            case 'LAYER':
                currentItem.layers.push(currentItemLayer);
                break;
            case 'GROUP':
                currentContext = null;
                writeOptionGroup(currentOptionGroup);
                break;
            case 'OPTION':
                currentOptionGroup.options.push(currentOption);
                currentContext = currentOptionGroup;
                break;
            default: 
                // console.log("close unrecognized tag ", node );
                break;
      }
    }).on('error', function(err) {
        //TODO capture any errors that occur when writing data to the file
        console.error('Sax Stream:', err);
		logItemEvent( {"event": "error", "errorSource":"parse", "objectType":"parse", "error":JSON.stringify(err)}, sourceKey );
		parseErrorsExist = true;
    }).on('close', function() {
        console.log('Done.');
    });
    
    const s3GetObjectStream = s3.getObject(s3Params);
    var s3Stream = s3GetObjectStream.createReadStream();
    
    var piped = s3Stream.pipe(saxStream);
    
    return new Promise( (resolve, reject) => {
        piped.on('end', () => { 
            console.log('SaxStream end'); 
            
            postProcessParsedItems();
            console.log( "parsed ",itemsToWrite.length, " items, and ", Object.keys(optionGroupsMap).length, " optionGroups");
            resolve( { "items":itemsToWrite, "optionGroupsMap":optionGroupsMap, "languageMap":languageMap, "defaultLanguageId":defaultLanguageId, "parseErrorsExist":parseErrorsExist, "catalogCode":catalogCode} );
        });
    });

        // .then( x => {
        //     console.log("after finished parsing");
            
        //     return x;
        // })
        // .then( _ => ( { "items":itemsToWrite, "optionGroupsMap":optionGroupsMap } ) );
};

module.exports.parse = parse;