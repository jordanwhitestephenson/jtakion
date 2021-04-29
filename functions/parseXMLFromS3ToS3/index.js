'use strict';

// dependencies
const AWS = require('aws-sdk');
const util = require('util');
const stream = require('stream');
const sax = require("sax");

// get reference to S3 client
const s3 = new AWS.S3();

const ENV = process.env.environment;
let ORG_ID;
let API_URL;
let API_TOKEN;

switch (ENV) {
    case 'demo':
        ORG_ID = process.env.org_id;
        API_URL = process.env.threeKit_api_url_preview;
        API_TOKEN = process.env.api_token;
        break;
    case 'dev':
        ORG_ID = process.env.org_id_dev;
        API_URL = process.env.threeKit_api_url_preview;
        API_TOKEN = process.env.api_token_dev;
        break;
    default:
        ORG_ID = process.env.org_id_default;
        API_URL = process.env.threeKit_api_url;
        API_TOKEN = process.env.api_token_default;
}

exports.handler = async (event, context, callback) => {
    

    const optionGroupsMap = {};
    const itemsToWrite = [];
    const imagesMap = {};
    var viewId3D;
    
    function writeImage(image) {
        // console.log("writing image",image);
        imagesMap[image.code] = image;
    }
    
    function writeItem(item) {
        // console.log("parsed item ",item.id);
        console.log( {"event": "parse", "objectType":"item", "itemId":item.id} );
        itemsToWrite.push(item);
    }
    
    function writeOptionGroup(optionGroup) {
        // console.log("parsed optionGroup ",optionGroup.id, " with ", optionGroup.options.length, " options");
        console.log( {"event": "parse", "objectType":"group", "optionGroupId":optionGroup.id, "optionsCount": optionGroup.options.length} );
        optionGroupsMap[optionGroup.id] = optionGroup;
    }
    
    
    function createOption (option) {
        // console.log({'event': 'createGroupOption', 'optionId': option.id});
        const t = Date.now();
            
        const item = {'query': { 'metadata' : { 'optionId': option.id }}, 'product': {}};
        
        if (option.im && option.materialId) {
            item.product.asset = {
                'assetId': option.materialId,
                'configuration': '',
                'type': 'material'
            };
        }
        
        if (option.subGroupTag) {
            item.product.attributes = [{
                "type": "Asset",
                "name": option.description,
                "blacklist": [],
                "assetType": "item",
                "values": [
                    "#"+option.subGroupTag
                ],
                "defaultValue": {
                    "assetId": ""
                }
            }];
        }
        item.product.tags = [option.groupTag];
        item.product.metadata = [
            {
                'type': 'String',
                'name': 'Price',
                'blacklist': [],
                'values': [],
                'defaultValue': option.price
            },
            {
                'type': 'String',
                'name': 'optionId',
                'blacklist': [],
                'values': [],
                'defaultValue': option.id
            }
        ];
        item.product.name = option.description;
        return item;
    }
    
    // create a item type product with optional id query
    function createItem (item) {
        // console.log({'event': 'createItem', 'itemId': item.id});
        const t = Date.now();
        let uploadItem = { 'query': { 'metadata': { 'itemId': item.id }}};
        
        const product = {
            'name': item.pn,
            'type': 'item',
            'orgId': ORG_ID,
            'description': item.description,
            'tags': ['product'],
            'metadata': [
                {
                    'type': 'String',
                    'name': 'Price',
                    'blacklist': [],
                    'values': [],
                    'defaultValue': item.price
                },
                {
                    'type': 'String',
                    'name': 'itemId',
                    'blacklist': [],
                    'values': [],
                    'defaultValue': item.id
                }
            ]
        };
        product.asset = {
            'assetId': item.modelId,
            'configuration': '',
            'type': 'model'
        };
        if (item.itemGroups) {
            product.attributes = item.itemGroups.map(att => {
                return {
                    'type': 'Asset',
                    'name': att.groupName,
                    "blacklist": [],
                        "assetType": "item",
                        "values": [
                            "#"+att.groupTag
                        ],
                        "defaultValue": {
                            "assetId": ""
                        }
                };
            });
        }
        uploadItem.product = product;
        console.log("created item in "+(Date.now() - t))
        return uploadItem;
    }
    
    function pushOptionGroup(optionGroup, stream){
        console.log("pushing optionGroup ",optionGroup);
        
        optionGroup.options.forEach( (o,i) => { 
            
            o.type = "option";
            o.groupTag = optionGroup.id+'-'+optionGroup.description.replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
            o.groupName = optionGroup.description;
            
            if(o.subgroupId){
                const subgroup = optionGroupsMap[o.subgroupId];
                o.subGroupTag = subgroup.id+'-'+subgroup.description.replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                o.subGroupName = subgroup.description;
                
                pushOptionGroup(subgroup, stream);
            }
            if(o.im){
                o.image = imagesMap[o.im];
            }
        
            const t = Date.now();
            stream.write( JSON.stringify(createOption(o)) );
            stream.write(',');
            console.log("wrote opton "+o.id+" to stream in "+(Date.now() - t) );
        } );
    }
    
    async function pushItem(item, stream){
        const t = Date.now();
        
        stream.write("[");
        
        const itemFlat = {...item};
        itemFlat.type = "item";
        // cadFiles[item.fileName] = (cadFiles[item.fileName] || 0 ) + 1 ; 
        item.itemGroups.forEach( ig => { 
            const group = optionGroupsMap[ig.id];
            ig.groupTag = group.id+'-'+group.description.replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
            ig.groupName = group.description;
            
            pushOptionGroup(group, stream);
        } );
        
        stream.write( JSON.stringify(createItem(itemFlat)) );
        
        stream.write("]");
        console.log("finished writing to stream in "+ (Date.now() - t) );
    }
    
    async function pushAllItems(){
        
        console.log("preparing to write " + itemsToWrite.length + " items");
        
        const allS3Promises = itemsToWrite.map( item => {
        //for (var i = 0; i < itemsToWrite.length; i++) {
            
            // const item = itemsToWrite[i];
            // console.log("writing item ",item.id);
            
            const st = new stream.PassThrough();
            
            var params = {Bucket: 'teknion-product-upload', Key: item.id+'.json', Body: st};
            
            const writeToS3Promise = s3.upload(params, function(err, data) {
              console.log(err, data);
            });
            
            pushItem(item, st);
            
            st.end();
            
            return writeToS3Promise;
        }).reduce( async (previousPromise, nextPromise) => {
                return previousPromise.then( _ => nextPromise);
            }, Promise.resolve());
        
        return allS3Promises;
        
    }
    
    
    // Read options from the event parameter.
    console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    const srcBucket = event.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    const srcKey    = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    
    
    const finished = util.promisify(stream.finished);

    try {
        const options = { 'trim': true, 'normalize': true };
        var saxStream = sax.createStream(false, options);
        
        var identFunc = function(t) { return t; };
        var setDescriptionOn = function( describeMe ) { 
            return (describeMe != null) ? function( t ){  describeMe.description = t } : identFunc ;
            
        };
        var setFileNamenOn = function( fileNameMe ) { 
            return (fileNameMe != null) ? function( t ){  fileNameMe.fileName = t } : identFunc ;
            
        };
        var setPriceOn = function( priceMe ) { 
            return (priceMe != null) ? function( p ){  priceMe.price = p } : identFunc ;
        };
        
        var currentContext = null;
        
        var currentItem = null;
        var currentItemLayer = null;
        var currentItemGroup = null;
        var currentImage = null;
        var setFromText = function(t){};
        var currentOptionGroup = null;
        var currentOption = null;
        
        
        saxStream
        .on("opentag",  function (node) {
            // console.log("open tag ", node );
            switch( node.name ){
                case 'VIEW':
                    if(node.attributes.VIEW_CODE === '3'){
                        viewId3D = node.attributes.VIEW_ID
                    }
                    break;
                case 'IMAGE':
                    currentImage = {};
                    currentImage.code = node.attributes.CODE;
                    currentImage.file = node.attributes.FILE;
                    break;
                case 'ITEM':
                    currentItem = {}
                    currentItem.itemGroups = [];
                    currentItem.layers = [];
                    currentItem.id = node.attributes.ID;
                    currentItem.pn = node.attributes.PN;
                    currentItem.vendorId = node.attributes.VENDOR_ID;
                    currentContext = currentItem;
                    break;
                case 'TEXT':
                    // console.log("open text tag ", node );
                    setFromText = setDescriptionOn(currentContext);
                    break;
                case 'PRICE':
                    // console.log("open price tag ", node );
                    setFromText = setPriceOn(currentContext);
                    break;
                case 'CAD_FILE':
                    // console.log("read cad file ",node);
                    if(node.attributes.VIEW_ID == viewId3D){
                        setFromText = setFileNamenOn(currentContext);
                    }
                    break;
                case 'ITEM_GROUP':
                    // console.log("open item_group tag ", node );
                    currentItemGroup = {};
                    currentItemGroup.id = node.attributes.ID;
                    currentItemGroup.optNo = node.attributes.OPTNO;
                    break;
                case 'LAYER':
                    // console.log("open layer tag ", node );
                    currentItemLayer = {};
                    currentItemLayer.name = node.attributes.NAME;
                    currentItemLayer.optCode = node.attributes.OPTCODE;
                    currentItemLayer.optNo = node.attributes.OPTNO;
                    break;
                case 'GROUP':
                    // console.log("open item_group tag ", node );
                    currentOptionGroup = {};
                    currentOptionGroup.id = node.attributes.ID;
                    currentOptionGroup.name = node.attributes.NAME;
                    currentOptionGroup.options = [];
                    currentContext = currentOptionGroup;
                    break;
                case 'OPTION':
                    // console.log("open item_group tag ", node );
                    currentOption = {};
                    currentOption.id = node.attributes.ID;
                    currentOption.name = node.attributes.NAME;
                    currentOption.im = node.attributes.IM;
                    if(node.attributes.SUBGROUP_ID){
                        currentOption.subgroupId = node.attributes.SUBGROUP_ID;
                    }
                    currentContext = currentOption;
                    break;
                default: 
                    // console.log("open unrecognized tag ", node );
                    break;
          }
        }).on("text", function (t) {
          setFromText(t);
        }).on("closetag",  function (node) {
            // console.log("close tag ", node );
            switch( node ){
                case 'IMAGE':
                    writeImage(currentImage);
                    break;
                case 'ITEM':
                    currentContext = null;
                    writeItem(currentItem);
                    break;
                case 'TEXT':
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
            // capture any errors that occur when writing data to the file
            console.error('Sax Stream:', err);
        }).on('close', function() {
            console.log('Done.');
        });
        
        const params = {
            Bucket: srcBucket,
            Key: srcKey
        };
        
        var s3GetObject = s3.getObject(params);
        var s3Stream = s3GetObject.createReadStream();
        // console.log("got s3 steam for ",params, s3Stream);
        
        // Listen for errors returned by the service
        s3GetObject
        .on('error', function(err) {
            console.error(err);
        })
        .on('end', function() {
            console.log('end s3GetObject');
        });
        
        var piped = s3Stream
            .pipe(saxStream);
            
        saxStream.on('end',async function(){ 
            console.log('SaxStream end'); 
            await pushAllItems();
        });
                
        console.log("after creating read stream");
        
        return finished(piped);

    } catch (error) {
        console.log(error);
        return;
    }  

};