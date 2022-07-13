const AWS = require("aws-sdk");
const sax = require("sax");
const s3 = new AWS.S3();
const http = require("https");
const axios = require("axios");

AWS.config.setPromisesDependency(require("bluebird"));

const logItemEvent = require("./itemEventLog.js").logItemEvent;

const parse = (s3Params, sourceKey, apiUrl, orgId, apiToken) => {
  const optionGroupsMap = {};
  const itemsToWrite = [];
  const familyToWrite = [];
  const productsToWrite = [];
  const PGOsToWrite = [];
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
  async function writeProductItem(item) {
    item.newproduct = "true";
    productsToWrite.push(item);
  }
  async function writePGO(item) {
    PGOsToWrite.push(item);
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
    priceZones.forEach((zone) => {
      let curr;
      currencies.forEach((currency) => {
        if (currency.currencyId === zone.currencyId) {
          curr = currency;
        }
      });
      priceZoneMap[zone.zoneId] = { priceZone: zone, currency: curr };
    });
    familyToWrite.forEach((item) => {
      item.sourceKey = sourceKey;
      item.apiToken = apiToken;
      item.apiUrl = apiUrl;
      item.orgId = orgId;
      return item;
    });
    productsToWrite.forEach((item) => {
      item.sourceKey = sourceKey;
      item.apiToken = apiToken;
      item.apiUrl = apiUrl;
      item.orgId = orgId;
      return item;
    });

    PGOsToWrite.forEach((item) => {
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
          console.log("GROUP WHATS WRONGE", group);
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
  var currentPGO = null;
  var currentItemLayer = null;
  var currentItemGroup = null;
  var currentProductFamily = null;
  var currentSingleProduct = null;
  var currentImage = null;
  var setFromText = function (t) {};
  var currentOptionGroup = null;
  var currentOption = null;

  var currentCurrency = null;
  var currentPriceZone = null;
  var currentLanguage = null;
  var currentText = null;
  var currentVisualizationItem = null;
  var currentVisualizationPGO = null;
  var variantVisualInfo = null;
  var currentVisualizationLayer = null;

  var nodes = [];

  var textPropertyToWrite = null;

  var insideVisualizationSetion = false;
  let catalogVersion = {};
  var insideProductTag = false;
  var insidePGOTag = false;
  var insideGROUPTag = false;
  var insideOPTIONSTag = false;
  var insideOPTIONTag = false;
  var currentGROUPpgoID = null;
  var optionName = null;

  // let variantVisualInfo = {NSBYYYN: {pgos: {pgo_1: "A", pgo_2: "B", ...}, layers: {X: true, Y: false, ...}}, NSBYYNN: {pgos: {pgo_1: "A", pgo_2: "B", ...}, layers: {X: true, Y: false, ...}}, ...};

  function createMetaData(name, defaultValue) {
    let metaDataObject = {
      type: "String",
      name: name,
      blacklist: [],
      values: [],
      defaultValue: defaultValue,
    };

    return metaDataObject;
  }

  function createItemDatainMemory(currentVisualizationItem) {
    let itemPGOData = {
      [currentVisualizationItem.name]: {
        pgos: currentVisualizationItem.pgoObject,
        layers: currentVisualizationItem.layerObject,
      },
    };
    console.log(itemPGOData, "itemPGOData");
    return itemPGOData;
  }
  saxStream
    .on("opentag", function (node) {
      nodes.push(node);

      if (node.name === "VISUALIZATION") {
        insideVisualizationSetion = true;
        variantVisualInfo = {};
      }
      if (node.name === "CATALOG") {
        catalogVersion.version = node.attributes.VERSION;
        catalogVersion.desc = node.attributes.DESC;
        catalogVersion.year = node.attributes.YEAR;
        catalogVersion.month = node.attributes.MONTH;
        catalogVersion.day = node.attributes.DAY;
        catalogVersion.code = node.attributes.CODE;
      }
      if (insideVisualizationSetion === true) {
        switch (node.name) {
          case "PGOS":
            insidePGOTag = true;

            break;
          case "OPTIONS":
            insideOPTIONSTag = true;
            break;
          case "OPTION":
            insideOPTIONTag = true;
            currentPGO = {};
            optionName = node.attributes.NAME;

            currentPGO.id = `${
              optionName +
              "_" +
              currentGROUPpgoID +
              "_" +
              currentSingleProduct.id
            }`;
            let pgoMetaData1 = {
              type: "String",
              name: "catalog-version",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.version,
            };

            let pgoMetaData2 = {
              type: "String",
              name: "family",
              blacklist: [],
              values: [],
              defaultValue: `${currentProductFamily.name
                .toLowerCase()
                .replace(/\s/g, "-")}`,
            };
            let pgoMetaData3 = {
              type: "String",
              name: "name",
              blacklist: [],
              values: [],
              defaultValue: optionName,
            };

            let pgoMetaData4 = {
              type: "String",
              name: "description",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.desc,
            };
            let pgoMetaData5 = {
              type: "String",
              name: "year",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.year,
            };

            let pgoMetaData6 = {
              type: "String",
              name: "month",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.month,
            };

            let pgoMetaData7 = {
              type: "String",
              name: "day",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.day,
            };
            let pgoMetaData8 = {
              type: "String",
              name: "type",
              blacklist: [],
              values: [],
              defaultValue: "pgo",
            };
            let pgoMetaData9 = {
              type: "String",
              name: "product",
              blacklist: [],
              values: [],
              defaultValue: currentSingleProduct.id,
            };
            let pgoMetaData10 = {
              type: "String",
              name: "itemId",
              blacklist: [],
              values: [],
              defaultValue: `${
                optionName +
                "_" +
                currentGROUPpgoID +
                "_" +
                currentSingleProduct.id
              }`,
            };

            currentPGO.type = "pgo";
            currentPGO.metadata = [
              pgoMetaData1,
              pgoMetaData2,
              pgoMetaData3,
              pgoMetaData4,
              pgoMetaData5,
              pgoMetaData6,
              pgoMetaData7,
              pgoMetaData8,
              pgoMetaData9,
              pgoMetaData10,
            ];
            currentPGO.tags = [
              "type_pgo",
              `${
                "family_" +
                currentProductFamily.name.toLowerCase().replace(/\s/g, "-")
              }`,

              `${"catalog-version_" + catalogVersion.version}`,
              `${currentGROUPpgoID}`,
              `${"product_" + currentSingleProduct.id}`,
            ];
            break;
          case "GROUP":
            insideGROUPTag = true;
            currentGROUPpgoID = node.attributes.PGOID;

            break;

          case "PRODUCT_FAMILY":
            const pdpmodelname = node.attributes.PDP_3D_MODEL;
            const nameWithSpaces = pdpmodelname.replace(".fbx", "");
            currentProductFamily = {};
            currentProductFamily.modelName = nameWithSpaces;
            currentProductFamily.name = node.attributes.NAME;
            currentProductFamily.type = "family";

            currentProductFamily.catalogVersion = "";
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
              defaultValue: catalogVersion.version,
            };

            let metadata4 = {
              type: "String",
              name: "itemId",
              blacklist: [],
              values: [],
              defaultValue: node.attributes.NAME,
            };

            let metadata5 = {
              type: "String",
              name: "description",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.desc,
            };
            let metadata6 = {
              type: "String",
              name: "year",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.year,
            };

            let metadata7 = {
              type: "String",
              name: "month",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.month,
            };

            let metadata8 = {
              type: "String",
              name: "day",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.day,
            };

            let metadata9 = {
              type: "String",
              name: "version",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.version,
            };
            currentProductFamily.catalogCode = catalogVersion.code;
            currentProductFamily.metadata = [
              metadata1,
              metadata2,
              metadata3,
              metadata4,
              metadata5,
              metadata6,
              metadata7,
              metadata8,
              metadata9,
            ];
            const familyName = node.attributes.NAME;
            const lowerCaseFamily = familyName.toLocaleLowerCase();
            currentProductFamily.tags = [
              `${"catalog-version_" + catalogVersion.version}`,
              "type_family",
              `${"family_" + lowerCaseFamily.replace(/\s/g, "-")}`,
            ];
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
                    [
                      "AND",
                      `${"#catalog-version_" + catalogVersion.version}`,
                      "#type_product",
                      `${"#family_" + lowerCaseFamily.replace(/\s/g, "-")}`,
                    ],
                  ],
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
          case "ITEM":
            currentVisualizationItem = {};
            currentVisualizationItem.name = node.attributes.PN;
            currentVisualizationItem.metadata = [];
            currentVisualizationItem.tags = [
              "type_variant",
              `${
                "family_" +
                currentProductFamily.name.toLowerCase().replace(/\s/g, "-")
              }`,

              `${"product_" + currentSingleProduct.id}`,
              `${"variant_" + node.attributes.PN}`,
            ];
            break;
          case "PGO_VALUES":
            currentVisualizationItem.pgoObject = {};
            break;
          case "PGO_VALUE":
            currentVisualizationItem.pgoObject[node.attributes.PGOID] =
              node.attributes.VALUE;
            console.log(currentVisualizationItem.pgoObject, "CONSOLE LOOGGG");
            var visualizationitempgo = new createMetaData(
              node.attributes.PGOID,
              node.attributes.VALUE
            );
            currentVisualizationItem.metadata.push(visualizationitempgo);
            break;
          case "LAYERS":
            currentVisualizationItem.layerObject = {};
            currentVisualizationItem.layers = [];
            break;
          case "LAYER":
            currentVisualizationLayer = {};
            currentVisualizationItem.layerObject[node.attributes.NAME] =
              JSON.parse(node.attributes.VISIBLE);
            currentVisualizationLayer[node.attributes.NAME] = JSON.parse(
              node.attributes.VISIBLE
            );

            currentVisualizationItem.layers.push(currentVisualizationLayer);
            break;

          case "PRODUCT":
            insideProductTag = true;
            currentSingleProduct = {};
            currentSingleProduct.type = "product";
            currentSingleProduct.attributes = [];
            currentSingleProduct.catalogCode = catalogVersion.code;
            currentSingleProduct.id = node.attributes.GROUP_CODE;

            const metadata1a = {
              type: "String",
              name: "group_code",
              blacklist: [],
              values: [],
              defaultValue: node.attributes.GROUP_CODE,
            };

            const metadata2a = {
              type: "String",
              name: "catalog-version",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.version,
            };
            const metadata3a = {
              type: "String",
              name: "family",
              blacklist: [],
              values: [],
              defaultValue: currentProductFamily.name
                .toLowerCase()
                .replace(/\s/g, "-"),
            };
            const metadata4a = {
              type: "String",
              name: "type",
              blacklist: [],
              values: [],
              defaultValue: "product",
            };

            const metadata5a = {
              type: "String",
              name: "itemId",
              blacklist: [],
              values: [],
              defaultValue: node.attributes.GROUP_CODE,
            };
            const metadata6a = {
              type: "String",
              name: "product",
              blacklist: [],
              values: [],
              defaultValue: node.attributes.GROUP_CODE,
            };

            let metadata7a = {
              type: "String",
              name: "description",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.desc,
            };
            let metadata8a = {
              type: "String",
              name: "year",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.year,
            };

            let metadata9a = {
              type: "String",
              name: "month",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.month,
            };

            let metadata10a = {
              type: "String",
              name: "day",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.day,
            };

            let metadata11a = {
              type: "String",
              name: "version",
              blacklist: [],
              values: [],
              defaultValue: catalogVersion.version,
            };

            currentSingleProduct.metadata = [
              metadata1a,
              metadata2a,
              metadata3a,
              metadata4a,
              metadata5a,
              metadata6a,
              metadata7a,
              metadata8a,
              metadata9a,
              metadata10a,
              metadata11a,
            ];

            currentSingleProduct.tags = [
              "type_product",
              `${
                "family_" +
                currentProductFamily.name.toLowerCase().replace(/\s/g, "-")
              }`,
              `${"catalog-version_" + catalogVersion.version}`,
              `${"product_" + node.attributes.GROUP_CODE}`,
            ];
            currentSingleProduct.rules = [
              {
                "conditions": [],
                "actions": [
                    {
                        "type": "custom-script",
                        "content": "const CONFIGURATOR = api.getConfigurator();\nconst ATTRS = CONFIGURATOR.getDisplayAttributes();\n\nlet UNSET_VALS = false;\nlet PGO_MAP = new Map();\n\nlet VARIANT_ATTR = {};\n\nATTRS.forEach(attr=>{\n    if(attr.type !== \"Asset\" || UNSET_VALS) return;\n\n    if(attr.name === \"_Variant\"){\n        VARIANT_ATTR = attr;\n        return;\n    }\n\n    if(!attr.value.assetId){\n        UNSET_VALS = true;\n        return;\n    }\n\n    let valAssetId = attr.value.assetId;\n    let VAL_PGO = \"\";\n    let i=0;\n    while(VAL_PGO === \"\" && i < attr.values.length){\n        if(attr.values[i].assetId === valAssetId){\n            attr.values[i].tags.forEach(tag=>{\n                if(VAL_PGO) return;\n\n                const regex = new RegExp('^pgo_[0-9]{1,}$');\n                if(regex.test(tag)){\n                    if(!attr.values[i].metadata || !attr.values[i].metadata.name) throw \"Name metadata not present on option\";\n\n                    PGO_MAP.set(tag, attr.values[i].metadata.name)\n                }\n            })\n        }\n        i++;\n    }\n\n});\n\nif(UNSET_VALS) {\n    console.log('unset values present');\n    return;\n}\nlet variantVal = {};\nlet j = 0\nwhile(!variantVal.assetId && j < VARIANT_ATTR.values.length){\n    let val = VARIANT_ATTR.values[j];\n    let REJECT = false;\n    PGO_MAP.forEach((pgoVal, pgoTagNum)=>{\n        if(REJECT) return;\n        if(val.metadata[pgoTagNum] === pgoVal) return;\n        if(!val.metadata[pgoTagNum] || val.metadata[pgoTagNum] !== pgoVal){\n            REJECT = true;\n            return;\n        }\n    });\n    if(!REJECT){\n        variantVal = {assetId: val.assetId};\n    }\n    j++;\n}\n\nif(!variantVal.assetId){\n    console.log(PGO_MAP);\n    throw \"No matching pgo for user selections\";\n} else if(VARIANT_ATTR.value.assetId !== variantVal.assetId){\n    CONFIGURATOR.setConfiguration({\"_Variant\": variantVal});\n}\n",
                        "enabled": false,
                        "error": "",
                        "name": "custom-script"
                    }
                ],
                "name": "PGO Matching",
                "disabled": false
            }
            ];
            currentSingleProduct.forms = [];
            currentSingleProduct.script = "";
            currentSingleProduct.asset = { assetId: "" };
            let productVariantObj = {
              type: "Asset",
              name: "_Variant",
              blacklist: [],
              assetType: "item",
              values: [
                [
                  "AND",
                  "#type_variant",
                  `${
                    "#family_" +
                    currentProductFamily.name.toLowerCase().replace(/\s/g, "-")
                  }`,
                  `${"#catalog-version_" + catalogVersion.version}`,
                  `${"#product_" + currentSingleProduct.id}`,
                ],
              ],
              defaultValue: { assetId: "" },
            };
            currentSingleProduct.attributes.push(productVariantObj)
            console.log( JSON.stringify(productVariantObj), 'productVariantObj1', currentSingleProduct.attributes )

            break;
        }
      }
    })

    .on("error", function (err) {
      //TODO capture any errors that occur when writing data to the file
      console.error("Sax Stream in open:", err);
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
    .on("text", function (t) {
      if (insideProductTag === true && insidePGOTag === false) {
        currentSingleProduct.name = t;
      }
      if (
        insideProductTag === true &&
        insidePGOTag === true &&
        insideGROUPTag === true &&
        insideOPTIONSTag === true &&
        insideOPTIONTag === true
      ) {
        currentPGO.name = t;
      }
      if (
        insideProductTag === true &&
        insidePGOTag === true &&
        insideGROUPTag === true &&
        insideOPTIONSTag === false
      ) {
        let productAttributeObj = {
          type: "Asset",
          name: t,
          blacklist: [],
          assetType: "item",
          values: [
            [
              "AND",
              "#type_pgo",
              `${
                "#family_" +
                currentProductFamily.name.toLowerCase().replace(/\s/g, "-")
              }`,
              `${"#catalog-version_" + catalogVersion.version}`,
              `${"#product_" + currentSingleProduct.id}`,
              `${"#" + currentGROUPpgoID}`,
            ],
          ],
          defaultValue: { assetId: "" },
        };
        currentSingleProduct.attributes.push(productAttributeObj);
      }
    })
    .on("closetag", function (node) {
      nodes.pop();
      if (insideVisualizationSetion === true) {
        switch (node) {
          case "VISUALIZATION":
            insideVisualizationSetion = false;
            break;
          case "LAYERS":
            var visualizationitempgo = new createMetaData(
              "visualization",
              currentVisualizationItem.layers
            );
            currentVisualizationItem.metadata.push(visualizationitempgo);

            break;
          case "PRODUCT_FAMILY":
            writeFamilyItem(currentProductFamily);

            break;
          case "ITEM":
            var currentItemObject = new createItemDatainMemory(
              currentVisualizationItem
            );
            variantVisualInfo = { ...variantVisualInfo, ...currentItemObject };
            break;
          case "PRODUCT_FAMILIES":
            insideVisualizationSetion = false;
            break;
          case "GROUP":
            insideGROUPTag = false;
            currentGROUPpgoID = null;

            break;
          case "OPTIONS":
            insideOPTIONSTag = false;
            break;
          case "OPTION":
            insideOPTIONTag = false;
            writePGO(currentPGO);
            break;
          case "PRODUCT":
            insideProductTag = false;
            writeProductItem(currentSingleProduct);
            console.log(variantVisualInfo, 'variantVisualInfo')
            break;
          case "PRODUCTS":
            break;
          case "PGOS":
            insidePGOTag = false;
            // writePGO(currentPGO);
            break;
          default:
            break;
        }
      }
    })
    .on("close", function () {
      console.log("Done.");
    });

  saxStream
    .on("opentag", function (node) {
      nodes.push(node);
      if (node.name === "VISUALIZATION") {
        insideVisualizationSetion = true;
      }
      //Test if your in insideVisualizationSetion
      if (insideVisualizationSetion === false) {
        console.log("not inside visualization");
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
            break;
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
            currentItem.id = node.attributes.ID
              ? node.attributes.ID
              : node.attributes.PN;
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
            console.log("IN GROUP, ", node.attributes);
            currentOptionGroup = {};
            currentOptionGroup.id = node.attributes.ID
              ? node.attributes.ID
              : node.attributes.PGOID;
            currentOptionGroup.name = node.attributes.NAME
              ? node.attributes.NAME
              : node.attributes.PGOID;
            currentOptionGroup.options = [];
            currentOptionGroup.translations = [];
            currentContext = currentOptionGroup;
            break;
          case "OPTION":
            currentOption = {};
            currentOption.id = node.attributes.ID
              ? node.attributes.ID
              : `${"productOption" + node.attributes.NAME}`;
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
      }
    })
    .on("text", function (t) {
      if (insideVisualizationSetion === false) {
        setFromText(t);
      }
    })
    .on("error", function (err) {
      //TODO capture any errors that occur when writing data to the file
      console.error("Sax Stream error in close:", err);
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
    .on("closetag", function (node) {
      if (insideVisualizationSetion === false) {
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
      }
    });

  const s3GetObjectStream = s3.getObject(s3Params);
  var s3Stream = s3GetObjectStream.createReadStream();

  var piped = s3Stream.pipe(saxStream);

  return new Promise((resolve, reject) => {
    piped.on("end", () => {
      postProcessParsedItems();
      console.log(productsToWrite, "productsToWrite s");
      console.log(familyToWrite, "familyToWries");
      console.log(itemsToWrite, "itemsToWrite");
      console.log(PGOsToWrite, "PGOsToWrite");
      console.log(
        currentVisualizationItem,
        "currentVisualizationItem",
        currentVisualizationItem.metadata.filter(
          (item) => item.name === "visualization"
        )
      );
      resolve({
        pgos: PGOsToWrite,
        family: familyToWrite,
        products: productsToWrite,
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
