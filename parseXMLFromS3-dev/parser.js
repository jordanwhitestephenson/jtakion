const AWS = require("aws-sdk");
const sax = require("sax");
const s3 = new AWS.S3();
const http = require("https");
const axios = require("axios");

AWS.config.setPromisesDependency(require("bluebird"));

const logItemEvent = require("./itemEventLog.js").logItemEvent;

// ?name=Around_Guest_3D&orgId=6396b548-c9c2-4706-8[…]pe=model&bearer_token=cdc00df4-fe64-480c-8632-2cca83f846bd

const parse = (s3Params, sourceKey, apiUrl, orgId, apiToken) => {
  const optionGroupsMap = {};
  const itemsToWrite = [];
  const familyToWrite = [];
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
    imagesMap[image.code] = image;
  }

  async function writeItem(item) {
    item.type = "item";
    itemsToWrite.push(item);
  }
  async function writeFamilyItem(item) {
    item.family = "true";
    familyToWrite.push(item);
  }

  async function writeOptionGroup(optionGroup) {
    optionGroupsMap[optionGroup.id] = optionGroup;
  }

  async function writeCurrency(currency) {
    currencies.push(currency);
  }

  async function writePriceZone(priceZone) {
    priceZones.push(priceZone);
  }

  async function writeLanguage(language) {
    languageMap[language.langId] = language;
    if (defaultLanguageId === null) {
      //set default langauge id to the id of the first language
      defaultLanguageId = language.langId;
    }
  }

  const usedOptionGroups = new Set();

  function postProcessParsedItems() {
    console.log("IN POST PROCESS");
    priceZones.forEach((zone) => {
      let curr;
      currencies.forEach((currency) => {
        if (currency.currencyId === zone.currencyId) {
          curr = currency;
        }
      });
      priceZoneMap[zone.zoneId] = { priceZone: zone, currency: curr };
    });
    console.log(familyToWrite, "familyToWrite  WE HAVE HERE");
    familyToWrite.forEach((item) => {
      item.sourceKey = sourceKey;
      item.apiToken = apiToken;
      item.apiUrl = apiUrl;
      item.orgId = orgId;

      return item;
    });

    itemsToWrite.forEach((item) => {
      item.sourceKey = sourceKey;
      item.apiToken = apiToken;
      item.apiUrl = apiUrl;
      item.orgId = orgId;

      if (item.prices) {
        //link each price with the zone and currency
        item.prices.forEach((price) => {
          if (priceZoneMap.hasOwnProperty(price.zoneId)) {
            let priceZoneObj = priceZoneMap[price.zoneId];
            price.currency = priceZoneObj.currency;
            price.priceZone = priceZoneObj.priceZone;
            price.priceZone.name = price.currency.name; //pricebooks will be set up in 3kit with the name = currency name
          }
        });
      }

      item.itemGroups.forEach((ig) => {
        const group = optionGroupsMap[ig.id];
        if (group) {
          ig.groupTag =
            group.id +
            "-" +
            group.description.replace(/\s/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
          ig.groupName = group.description;
          ig.groupOptionIds = group.options.map((opt) => opt.id);
          ig.groupOptionFirstUsed = !usedOptionGroups.has(ig.id);
          if (!usedOptionGroups.has(ig.id)) {
            postProcessParsedOptionGroup(group);
          }
        } else {
          logItemEvent(
            {
              event: "error",
              errorSource: "itemGroupMissing",
              objectType: "item",
              objectId: item.id,
              missingGroup: ig.id,
            },
            sourceKey,
            orgId
          );
          parseErrorsExist = true;
        }
      });

      Object.keys(optionGroupsMap).forEach((key) => {
        const group = optionGroupsMap[key];
        setOptionGroupPricing(group);
      });
      return item;
    });
  }

  function setOptionGroupPricing(group) {
    group.options.forEach((o) => {
      if (o.prices) {
        o.prices.forEach((price) => {
          if (priceZoneMap.hasOwnProperty(price.zoneId)) {
            let priceZoneObj = priceZoneMap[price.zoneId];
            price.currency = priceZoneObj.currency;
            price.priceZone = priceZoneObj.priceZone;
            price.priceZone.name = price.currency.name; //pricebooks will be set up in 3kit with the name = currency name
          }
        });
      }
    });
  }

  function postProcessParsedOptionGroup(group) {
    usedOptionGroups.add(group.id);
    group.options.forEach((o) => postProcessParsedOption(o, group));
  }

  function postProcessParsedOption(option, optionGroup) {
    option.type = "option";
    option.groupId = optionGroup.id;
    option.groupTag =
      optionGroup.id +
      "-" +
      optionGroup.description.replace(/\s/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
    option.groupName = optionGroup.description;
    option.sourceKey = sourceKey;
    option.apiToken = apiToken;
    option.apiUrl = apiUrl;
    option.orgId = orgId;

    if (option.im) {
      option.image = imagesMap[option.im];
      if (!imagesMap.hasOwnProperty(option.im)) {
        logItemEvent(
          {
            event: "error",
            errorSource: "optionImageMissing",
            objectType: "option",
            objectId: option.id,
            missingImage: option.im,
          },
          sourceKey,
          orgId
        );
        parseErrorsExist = true;
      }
    }

    if (option.subgroupId) {
      const subgroup = optionGroupsMap[option.subgroupId];
      if (subgroup) {
        option.subGroupTag =
          subgroup.id +
          "-" +
          subgroup.description
            .replace(/\s/g, "_")
            .replace(/[^a-zA-Z0-9_]/g, "");
        option.subGroupName = subgroup.description;
        option.subGroupOptions = (subgroup.options || []).map((opt) => opt.id);
        option.groupOptionFirstUsed = !usedOptionGroups.has(option.subgroupId);
        if (!usedOptionGroups.has(option.subgroupId)) {
          postProcessParsedOptionGroup(subgroup);
        }
      } else {
        logItemEvent(
          {
            event: "error",
            errorSource: "optionSubgroupMissing",
            objectType: "option",
            objectId: option.id,
            missingSubGroup: option.subgroupId,
          },
          sourceKey,
          orgId
        );
        parseErrorsExist = true;
      }
    }
  }

  const options = { trim: true, normalize: true };
  var saxStream = sax.createStream(false, options);

  var identFunc = function (t) {
    return t;
  };
  var setDescriptionOn = function (describeMe, textObj) {
    return describeMe != null
      ? function (t) {
          textObj.description = t;
          describeMe.translations.push(textObj);
          if (textObj.langId === defaultLanguageId) {
            //only set description if it is the default language id (could be multiple languages)
            describeMe.description = t;
          }
        }
      : identFunc;
  };
  var setFileNamenOn = function (fileNameMe) {
    return fileNameMe != null
      ? function (t) {
          fileNameMe.fileName = t;
        }
      : identFunc;
  };
  var setPriceOn = function (priceMe) {
    if (priceMe != null) {
      return function (p) {
        let priceObj = priceMe.prices.pop();
        priceObj.price = p;
        priceMe.prices.push(priceObj);
      };
    } else {
      return identFunc;
    }
  };

  var setNameOn = function (nameMe) {
    return nameMe != null
      ? function (t) {
          nameMe.name = t;
        }
      : identFunc;
  };

  var currentContext = null;

  var currentCatalog = null;

  var currentItem = null;
  var currentItemLayer = null;
  var currentItemGroup = null;
  var currentProductFamily = null;
  var currentImage = null;
  var setFromText = function (t) {};
  var currentOptionGroup = null;
  var currentOption = null;

  var currentCurrency = null;
  var currentPriceZone = null;
  var currentLanguage = null;
  var currentText = null;

  var nodes = [];

  saxStream
    .on("opentag", function (node) {
      nodes.push(node);

      // async function trySwitch() {}
      switch (node.name) {
        case "LANGUAGE":
          currentLanguage = {};
          currentLanguage.langId = node.attributes.LANG_ID;
          setFromText = setNameOn(currentLanguage);
          break;
        case "CURRENCY":
          currentCurrency = {};
          currentCurrency.code = node.attributes.CODE;
          currentCurrency.currencyId = node.attributes.CURRENCY_ID;
          setFromText = setNameOn(currentCurrency);
          break;
        case "PRICE_ZONE":
          currentPriceZone = {};
          currentPriceZone.currencyId = node.attributes.CURRENCY_ID;
          currentPriceZone.zoneId = node.attributes.ZONE_ID;
          setFromText = setNameOn(currentPriceZone);
          break;
        case "CATALOG":
          currentCatalog = {};
          currentCatalog.code = node.attributes.CODE;
          currentCatalog.desc = node.attributes.DESC;
          currentCatalog.year = node.attributes.YEAR;
          currentCatalog.month = node.attributes.MONTH;
          currentCatalog.day = node.attributes.DAY;
          currentCatalog.version = node.attributes.VERSION;
          catalogCode = node.attributes.CODE;
        case "VIEW":
          if (node.attributes.VIEW_CODE === "3") {
            viewId3D = node.attributes.VIEW_ID;
          }
          break;
        case "IMAGE":
          currentImage = {};
          currentImage.code = node.attributes.CODE;
          currentImage.file = node.attributes.FILE;
          break;

        case "ITEM":
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
        case "TEXT":
          let parentNode = nodes[nodes.length - 2];
          if (parentNode.name !== "PROMPTS") {
            currentText = {};
            currentText.langId = node.attributes.LANG_ID;
            setFromText = setDescriptionOn(currentContext, currentText);
          }
          break;
        case "PRICE":
          if (!currentContext.prices) {
            currentContext.prices = [];
          }
          currentContext.prices.push({ zoneId: node.attributes.ZONE_ID });
          setFromText = setPriceOn(currentContext);
          break;
        case "CAD_FILE":
          if (node.attributes.VIEW_ID == viewId3D) {
            setFromText = setFileNamenOn(currentContext);
          }
          break;

        //*******VISUALIZATION SECTION**********//
        case "PRODUCT_FAMILY":
          const pdpmodelname = node.attributes.PDP_3D_MODEL;
          const nameWithSpaces = pdpmodelname.replace(".fbx", "");
          currentProductFamily = {};
          currentProductFamily.modelName = nameWithSpaces;
          currentProductFamily.name = node.attributes.NAME;
          currentProductFamily.type = "item";
          let metadata1 = {
            type: "String",
            name: "family",
            blacklist: [],
            values: [],
            defaultValue: node.attributes.NAME.toLowerCase().replace(
              /\s/g,
              "-"
            ),
          };
          let metadata2 = {
            type: "String",
            name: "type",
            blacklist: [],
            values: [],
            defaultValue: "family",
          };

          let metadata3 = {
            type: "String",
            name: "catalog-version",
            blacklist: [],
            values: [],
            defaultValue: currentCatalog.version,
          };
          currentProductFamily.catalogCode = currentCatalog.code;
          currentProductFamily.metadata = [metadata1, metadata2, metadata3];
          const familyName = node.attributes.NAME;
          const lowerCaseFamily = familyName.toLocaleLowerCase();
          currentProductFamily.tags = [
            `${"catalog-version_" + currentCatalog.version}`,
            "type_family",
            `${"family_" + lowerCaseFamily.replace(/\s/g, "-")}`,
          ];
          currentProductFamily.proxyId = "75ed9de5-bfbc-4a55-9217-256414f8a58a";
          (currentProductFamily.rules = [
            {
              conditions: [],
              actions: [
                {
                  type: "custom-script",
                  content:
                    "function getMetadata(api, assetId, metadataKey){\n\tconst theItem = api.scene.get({id: assetId});\n\tif(!theItem) return '';\n\t\n\tconst theMetadataValue= theItem.configurator.metadata.find((i)=>i.name===metadataKey)?.defaultValue;\n    return theMetadataValue;\n\t\n}\n\nfunction getOptionCode(api, obj, arr){\n    const theAssetId = obj?.assetId;\n    if(!theAssetId) return '';\n    const theOptionCode = getMetadata(api, theAssetId, 'optionCode');\n    if(theOptionCode && !theOptionCode.startsWith('~')) arr.push(theOptionCode);\n    if(obj.configuration){\n        const theAttributes = Object.keys(obj.configuration);\n        if(theAttributes && theAttributes.length > 0) {\n            for (let attr in obj.configuration) {\n                getOptionCode(api, obj.configuration[`${attr}`], arr);\n            }\n        }\n    }\n}\n\nfunction setAttributeContentsInTree( api, attr_config){\n    const attr_arr = attr_config.getDisplayAttributes();\nif(!attr_arr) return undefined;\n    //strucure of an attribute in the Json\n    const selectedOptionName = attr_config.name;\n    let result = {\n        selectedOptionName : selectedOptionName,\n    };\n    \n    attr_arr.forEach((attr)=>{ \n        nestedConfig = attr_config.getNestedConfigurator(attr);\n        //when there's no further nested configuration\n        if(!nestedConfig){\n            result[`${attr.name}`] = {\n                configuration: attr_config.configuration[`${attr.name}`],\n                optionCode : getMetadata(api, attr_config.configuration[`${attr.name}`]?.assetId, 'optionCode')\n        }\n        }else{\n            result[`${attr.name}`] = setAttributeContentsInTree(api, nestedConfig);\n        }\n        \n    });\n\n    result.optionCode = attr_config.metadata.itemId ? attr_config.metadata.itemId : attr_config.metadata.optionCode;\n\n    return result;\n}\n\n    let attr_arr0= api.configurator.getDisplayAttributes();\n\n    let style_attr = attr_arr0?.find(attr => attr.name === \"Style\");\n\n    let selectedStyle = style_attr?.values.find(val => val.assetId===style_attr.value.assetId);\n    let style_config = api.configurator.getNestedConfigurator(style_attr);\n\n    let styleConfiguration = selectedStyle ? {\n        [`${selectedStyle.name}`] : setAttributeContentsInTree(api, style_config)\n    } : {};\n//Now styleConfiguration has the current configuration, need to fetch the previously saved configuration to compare and set attributes values accordingly\n    if(!window.cache) window.cache = {};\n    const prevStyleConfiguration = window.cache.prevStyleConfiguration;\n//...code here....\n\n//After all the attributes are set to the similar value or first option in the option list, get the current configuration and set to window.cache\n    attr_arr0= api.configurator.getDisplayAttributes();\n    style_attr = attr_arr0?.find(attr => attr.name === \"Style\");\n    selectedStyle = style_attr?.values.find(val => val.assetId===style_attr.value.assetId);\n    style_config = api.configurator.getNestedConfigurator(style_attr);\n    styleConfiguration = selectedStyle ? {\n        [`${selectedStyle.name}`] : setAttributeContentsInTree(api, style_config)\n    } : {};\n    \n    window.cache.prevStyleConfiguration = styleConfiguration;\n\n    //orderCode:\n    const configuration_level0 = api.configurator?.getFullConfiguration();\n    const theVariant = configuration_level0?.Style.configuration?._Variant;\n\n    if(!theVariant || !theVariant.assetId) return;//don't have _Variant\n\n    let orderCode = getMetadata(api, theVariant.assetId, 'itemId');\n    const optionCode_arr = [];\n    getOptionCode(api, theVariant, optionCode_arr);\n    orderCode = orderCode+ optionCode_arr.join('');\n    api.configurator.setConfiguration({\n    \"_OrderCode\": orderCode,\n});\n",
                  enabled: false,
                  error: "",
                  name: "custom-script",
                },
              ],
              name: "Set OrderCode",
              disabled: false,
            },
            {
              conditions: [],
              actions: [
                {
                  type: "custom-script",
                  content:
                    '(async () => {\n  const Style = api.configuration;\n  if (!Style) return;\n  const player = api.enableApi("player");\n  const configurator = await player.getConfigurator();\n  if (!configurator) return;\n  const attrs = configurator.getDisplayAttributes();\n  const styleAttr = attrs.find((entry) => entry.name === "Style");\n  const styleConfigurator = configurator.getNestedConfigurator(styleAttr);\n  if (!styleConfigurator) return;\n  const styleAttrs = styleConfigurator.getDisplayAttributes();\n  const variantAttr = styleAttrs.find((entry) => entry.name === "_Variant");\n  if (!variantAttr) return;\n  const variantConfigurator =\n    styleConfigurator.getNestedConfigurator(variantAttr);\n  if (!variantConfigurator) return;\n  if (!variantConfigurator.metadata.visualization) return;\n  api.configurator.setConfiguration({\n    _visibility: variantConfigurator.metadata.visualization,\n  });\n})();',
                  enabled: false,
                  error: "",
                  name: "custom-script",
                },
              ],
              name: "Set Visibility",
              disabled: false,
            },
            {
              conditions: [],
              actions: [
                {
                  type: "custom-script",
                  content:
                    'function getNestedValue(attr) {\n  if (!attr || !attr.assetId) return null; // no valid nested attr value\n  // check if attr has nested attr\n  const { configurator } = api.scene.get({ id: attr.assetId });\n  const { attributes = [] } = configurator || {};\n  const nestedAttr = attributes.find(({ type }) => type === "Asset");\n  if (!nestedAttr) {\n    // this attr is a leaf node, so no further nesting to traverse, just return its value\n    return attr;\n  }\n  // at this point, we have a nested attribute we need to dive into\n  if (!attr.configuration) {\n    // no configuration means nested attr not set\n    return null;\n  }\n  // get nested attr\n  const nestedAttrName = nestedAttr.name;\n  return getNestedValue(attr.configuration[nestedAttrName]);\n}\n(async () => {\n  const Style = api.configuration;\n  if (!Style) return;\n  const player = api.enableApi("player");\n  const configurator = await player.getConfigurator();\n  if (!configurator) return;\n  const attrs = configurator.getDisplayAttributes();\n  const styleAttr = attrs.find((entry) => entry.name === "Style");\n  const styleConfigurator = configurator.getNestedConfigurator(styleAttr);\n  if (!styleConfigurator) return;\n  const styleAttrs = styleConfigurator.getDisplayAttributes();\n  const variantAttr = styleAttrs.find((entry) => entry.name === "_Variant");\n  if (!variantAttr) return;\n  const variantConfigurator =\n    styleConfigurator.getNestedConfigurator(variantAttr);\n  if (!variantConfigurator) return;\n  const { _UI_displayAttributesAs } = variantConfigurator.metadata;\n  if (!_UI_displayAttributesAs) return;\n\n  let attributeMetadata;\n  try {\n    attributeMetadata = JSON.parse(_UI_displayAttributesAs);\n  } catch (err) {\n    console.error(\n      `Could not parse _UI_displayAttributesAs metadata string\' ${_UI_displayAttributesAs}\'`\n    );\n    return;\n  }\n  console.log(attributeMetadata);\n  const materialObj = {};\n  const config = variantConfigurator.getFullConfiguration();\n  console.log(config);\n  Object.entries(attributeMetadata).forEach(([attribute, meta]) => {\n    console.log(attribute, meta);\n    if (meta.layer && config[attribute]) {\n      console.log();\n      materialObj[meta.layer] = getNestedValue(config[attribute]);\n    }\n  });\n  api.configurator.setConfiguration({ _material: JSON.stringify(materialObj) });\n})();',
                  enabled: false,
                  error: "",
                  name: "custom-script",
                },
              ],
              name: "Set Material",
              disabled: false,
            },
          ]),
            (currentProductFamily.attributes = [
              {
                type: "Asset",
                name: "Style",
                blacklist: [],
                assetType: "item",
                values: [
                  ["AND",
                  `${"catalog-version_" + currentCatalog.version}`,
                  "#type_product",
                  `${"#family_" + lowerCaseFamily.replace(/\s/g, "-")}`,
                ]],
                defaultValue: { assetId: "" },
              },
              {
                type: "String",
                name: "_OrderCode",
                blacklist: [],
                values: [],
                defaultValue: "",
              },
              {
                type: "String",
                name: "_visibility",
                blacklist: [],
                values: [],
                defaultValue: "",
              },
              {
                type: "String",
                name: "_material",
                blacklist: [],
                values: [],
                defaultValue: "",
              },
            ]);
          currentProductFamily.asset = {
            assetId: "",
            configuration: "",
            type: "model",
          };

          break;

        case "ITEM_GROUP":
          currentItemGroup = {};
          currentItemGroup.id = node.attributes.ID;
          currentItemGroup.optNo = node.attributes.OPTNO;
          break;
        case "LAYER":
          currentItemLayer = {};
          currentItemLayer.name = node.attributes.NAME;
          currentItemLayer.optCode = node.attributes.OPTCODE;
          currentItemLayer.optNo = node.attributes.OPTNO;
          break;
        case "GROUP":
          currentOptionGroup = {};
          currentOptionGroup.id = node.attributes.ID;
          currentOptionGroup.name = node.attributes.NAME;
          currentOptionGroup.options = [];
          currentOptionGroup.translations = [];
          currentContext = currentOptionGroup;
          break;
        case "PRODUCT":
          currentProductFamily.id = node.attributes.GROUP_CODE;
          break;
        case "OPTION":
          currentOption = {};
          currentOption.id = node.attributes.ID;
          currentOption.name = node.attributes.NAME;
          currentOption.im = node.attributes.IM;
          if (node.attributes.SUBGROUP_ID) {
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
    })
    .on("text", function (t) {
      setFromText(t);
    })
    .on("closetag", function (node) {
      nodes.pop();
      switch (node) {
        case "LANGUAGE":
          writeLanguage(currentLanguage);
          currentLanguage = null;
          setFromText = identFunc;
          break;
        case "CURRENCY":
          writeCurrency(currentCurrency);
          setFromText = identFunc;
          break;
        case "PRICE_ZONE":
          writePriceZone(currentPriceZone);
          setFromText = identFunc;
          break;
        case "CATALOG":
          currentCatalog = null;
          break;
        case "IMAGE":
          writeImage(currentImage);
          break;

        case "VISUALIZATION":
          currentContext = null;
          writeFamilyItem(currentProductFamily);
          break;
        case "ITEM":
          currentContext = null;
          writeItem(currentItem);
          break;
        case "TEXT":
          currentText = null;
          setFromText = identFunc;
          break;
        case "PRICE":
          setFromText = identFunc;
          break;
        case "CAD_FILE":
          setFromText = identFunc;
          break;
        case "ITEM_GROUP":
          currentItem.itemGroups.push(currentItemGroup);
          break;
        case "LAYER":
          currentItem.layers.push(currentItemLayer);
          break;
        case "GROUP":
          currentContext = null;
          writeOptionGroup(currentOptionGroup);
          break;
        case "OPTION":
          currentOptionGroup.options.push(currentOption);
          currentContext = currentOptionGroup;
          break;
        default:
          break;
      }
    })
    .on("error", function (err) {
      //TODO capture any errors that occur when writing data to the file
      console.error("Sax Stream:", err);
      logItemEvent(
        {
          event: "error",
          errorSource: "parse",
          objectType: "parse",
          error: JSON.stringify(err),
        },
        sourceKey,
        orgId
      );
      parseErrorsExist = true;
    })
    .on("close", function () {
      console.log("Done.");
    });

  const s3GetObjectStream = s3.getObject(s3Params);
  var s3Stream = s3GetObjectStream.createReadStream();

  var piped = s3Stream.pipe(saxStream);

  return new Promise((resolve, reject) => {
    piped.on("end", () => {
      postProcessParsedItems();
      console.log(itemsToWrite, " items to Write");
      console.log(familyToWrite, "familyToWries");
      resolve({
        family: familyToWrite,
        
        items: itemsToWrite,
        optionGroupsMap: optionGroupsMap,
        languageMap: languageMap,
        defaultLanguageId: defaultLanguageId,
        parseErrorsExist: parseErrorsExist,
        catalogCode: catalogCode,
      });
    });
  });
};

module.exports.parse = parse;