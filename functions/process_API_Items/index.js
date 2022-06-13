// dependencies
const fs = require("fs");
const AWS = require("aws-sdk");
const util = require("util");
const axios = require("axios");
const FormData = require("form-data");

const https = require("https");
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 25,
});
const sqs = new AWS.SQS({
  httpOptions: { agent },
});

const rdsDataService = new AWS.RDSDataService();

const logItemEvent = require("./itemEventLog.js").logItemEvent;
const finishLogEvents = require("./itemEventLog.js").finishLogEvents;
const events = require("./itemEventLog.js").events;

const maxQueueMessageSize = 262144 - 500;
var itemsToQueueBuffer = [];
var itemsToQueueBufferLength = 0;

const ruleContent = fs.readFileSync("nestedAttributesRule.txt", "utf8");

const DEFAULT_TIMEOUT = 1000 * 60 * 2; // 2 mins
const DEFAULT_FREQUENCY = 1000; // poll check every 1 second

exports.handler = async (event) => {
  const start = Date.now();

  const dbArn = process.env.dbArn;
  const secretArn = process.env.secretArn;

  async function checkIfJobCancelled(jobName) {
    let sqlParams = {
      secretArn: secretArn,
      resourceArn: dbArn,
      sql: "SELECT stat FROM job WHERE nm = :jobname;",
      database: "threekit",
      includeResultMetadata: true,
      parameters: [
        {
          name: "jobname",
          value: {
            stringValue: jobName,
          },
        },
      ],
    };
    let resp = await rdsDataService.executeStatement(sqlParams).promise();
    let columns = resp.columnMetadata.map((c) => c.name);
    let data = resp.records.map((r) => {
      let obj = {};
      r.map((v, i) => {
        obj[columns[i]] = Object.values(v)[0];
      });
      return obj;
    });
    console.log(data, jobName, "WHATS WRONG WITH THIS DATA");
    if (data.length > 0 && data[0]["stat"] === "cancelled") {
      return false;
    } else {
      return true;
    }
  }

  async function checkAssetExists(groupId, catalogCode, optionId, sourceKey) {
    let sqlParams = {
      secretArn: secretArn,
      resourceArn: dbArn,
      sql: "SELECT group_id, option_id FROM asset_lookup JOIN job ON job.jid = asset_lookup.jid WHERE job.nm = :jobname AND group_id = :groupId AND catalog_code = :catalogCode AND option_id = :optionId",
      database: "threekit",
      includeResultMetadata: true,
      parameters: [
        {
          name: "jobname",
          value: {
            stringValue: sourceKey,
          },
        },
        {
          name: "groupId",
          value: {
            stringValue: groupId,
          },
        },
        {
          name: "catalogCode",
          value: {
            stringValue: catalogCode,
          },
        },
        {
          name: "optionId",
          value: {
            stringValue: optionId,
          },
        },
      ],
    };
    let resp = await rdsDataService.executeStatement(sqlParams).promise();
    let columns = resp.columnMetadata.map((c) => c.name);
    let data = resp.records.map((r) => {
      let obj = {};
      r.map((v, i) => {
        obj[columns[i]] = Object.values(v)[0];
      });
      return obj;
    });
    if (data.length > 0) {
      return true;
    } else {
      return false;
    }
  }

  /* helper functions */

  function writeCompletedAndAssetToDatabase(
    id,
    type,
    sourceKey,
    assetId,
    groupId,
    catalogCode,
    optionId,
    nm,
    options = {}
  ) {
    const { timeout = DEFAULT_TIMEOUT, frequency = DEFAULT_FREQUENCY } =
      options;
    const startTime = Date.now();
    const prom = new Promise((resolve, reject) => {
      const check = async () => {
        try {
          let sqlParams = {
            secretArn: secretArn,
            resourceArn: dbArn,
            sql: "INSERT INTO job_item (jid, object_id, item_type) values ((SELECT jid FROM job WHERE nm = :jobname), :objectid, :itemtype);INSERT INTO asset_lookup (jid, group_id, catalog_code, asset_id, option_id, nm) values ((SELECT jid FROM job WHERE nm = :jobname), :groupId, :catalogCode, :assetId, :optionId, :nm);",
            database: "threekit",
            includeResultMetadata: true,
            parameters: [
              {
                name: "jobname",
                value: {
                  stringValue: sourceKey,
                },
              },
              {
                name: "objectid",
                value: {
                  stringValue: id,
                },
              },
              {
                name: "itemtype",
                value: {
                  stringValue: type,
                },
              },
              {
                name: "groupId",
                value: {
                  stringValue: groupId,
                },
              },
              {
                name: "catalogCode",
                value: {
                  stringValue: catalogCode,
                },
              },
              {
                name: "assetId",
                value: {
                  stringValue: assetId,
                },
              },
              {
                name: "optionId",
                value: {
                  stringValue: optionId,
                },
              },
              {
                name: "nm",
                value: {
                  stringValue: nm,
                },
              },
            ],
          };
          const res = await rdsDataService
            .executeStatement(sqlParams)
            .promise();
          return resolve({});
        } catch (err) {
          console.log(
            "error writing completed item and asset to db, retry ",
            id,
            err
          );
        }

        setTimeout(check, frequency);
      };

      check();
    });
    return prom;
  }

  function writeCompletedItemToDatabase(id, type, sourceKey, options = {}) {
    const { timeout = DEFAULT_TIMEOUT, frequency = DEFAULT_FREQUENCY } =
      options;
    const startTime = Date.now();
    const prom = new Promise((resolve, reject) => {
      const check = async () => {
        try {
          let sqlParams = {
            secretArn: secretArn,
            resourceArn: dbArn,
            sql: "INSERT INTO job_item (jid, object_id, item_type) values ((SELECT jid FROM job WHERE nm = :jobname), :objectid, :itemtype)",
            database: "threekit",
            includeResultMetadata: true,
            parameters: [
              {
                name: "jobname",
                value: {
                  stringValue: sourceKey,
                },
              },
              {
                name: "objectid",
                value: {
                  stringValue: id,
                },
              },
              {
                name: "itemtype",
                value: {
                  stringValue: type,
                },
              },
            ],
          };
          const res = await rdsDataService
            .executeStatement(sqlParams)
            .promise();
          return resolve({});
        } catch (err) {
          console.log("error writing to db, retry", id, err);
        }

        setTimeout(check, frequency);
      };

      check();
    });
    return prom;
  }

  function pollJob(jobId, apiUrl, apiToken, options = {}) {
    const { timeout = DEFAULT_TIMEOUT, frequency = DEFAULT_FREQUENCY } =
      options;
    const startTime = Date.now();
    const prom = new Promise((resolve, reject) => {
      const check = async () => {
        const jobUrl = `${apiUrl}/jobs/${jobId}`;
        try {
          const res = await axios.get(jobUrl, {
            headers: { Authorization: "Bearer " + apiToken },
          });
          if (
            res.data.status === "stopped" ||
            Date.now() - startTime > timeout
          ) {
            return resolve({
              status: res.data.status,
              success:
                res.data.status === "stopped" &&
                res.data.taskResultFailures === 0,
            });
          }
        } catch (err) {
          console.log("caught error from got job fetch", err);
          reject(err);
        }

        setTimeout(check, frequency);
      };

      check();
    });
    return prom;
  }

  //create a item and assets for a group
  function createOption(option) {
    const item = { m: { optionId: option.id }, product: {} };

    if (option.im && option.materialId) {
      item.product.asset = {
        assetId: option.materialId,
        configuration: "",
        type: "material",
      };
    }

    if (option.subGroupOptionIds) {
      const attrValues = option.subGroupOptionIds.map((id) => {
        return { assetId: id };
      });
      const defaultValue =
        attrValues.length === 1 ? attrValues[0] : { assetId: "" };
      item.product.attributes = [
        {
          type: "Asset",
          //"name": option.description,
          name: option.subGroupName,
          blacklist: [],
          assetType: "item",
          values: attrValues,
          defaultValue: defaultValue,
        },
      ];
    }
    item.product.tags = [option.groupTag];
    let uiLabel = option.description;
    if (option.im) {
      uiLabel = option.im;
    }
    item.product.metadata = [
      {
        type: "Number",
        name: "Price",
        blacklist: [],
        values: [],
        defaultValue: parseFloat(option.price),
      },
      {
        type: "String",
        name: "optionId",
        blacklist: [],
        values: [],
        defaultValue: option.id,
      },
      {
        type: "String",
        name: "groupId",
        blacklist: [],
        values: [],
        defaultValue: option.groupId,
      },
      {
        type: "String",
        name: "optionCode",
        blacklist: [],
        values: [],
        defaultValue: option.name,
      },
      {
        type: "String",
        name: "catalogCode",
        blacklist: [],
        values: [],
        defaultValue: option.catalog.code,
      },
      {
        type: "Number",
        name: "isOption",
        blacklist: [],
        values: [],
        defaultValue: 1,
      },
      {
        type: "String",
        name: "_UI_label",
        blacklist: [],
        values: [],
        defaultValue: uiLabel,
      },
      {
        type: "String",
        name: "source",
        defaultValue: option.sourceKey,
      },
    ];
    if (option.displayAttributesAs) {
      item.product.metadata.push({
        type: "String",
        name: "_UI_displayAttributesAs",
        blacklist: [],
        values: [],
        defaultValue: JSON.stringify(option.displayAttributesAs),
      });
    }
    if (option.thumbnailUrl) {
      item.product.metadata.push({
        type: "String",
        name: "_UI_thumbnailUrl",
        blacklist: [],
        values: [],
        defaultValue: option.thumbnailUrl,
      });
    }
    item.product.name = option.description;

    if (option.prices) {
      if (!item.product.attributes) {
        item.product.attributes = [];
      }
      let pricingObj = {
        type: "Pricing",
        name: "Pricing",
        values: [],
      };
      let pricebookToCurrencyMap = {};
      option.prices.forEach((price) => {
        if (!pricebookToCurrencyMap.hasOwnProperty(price.pricebookId)) {
          //not in the map yet
          let currencyArray = [
            { code: price.currencyCode, price: price.price },
          ];
          pricebookToCurrencyMap[price.pricebookId] = currencyArray;
        } else {
          //in the map already
          let currencyArray = pricebookToCurrencyMap[price.pricebookId];
          currencyArray.push({ code: price.currencyCode, price: price.price });
        }
      });
      Object.keys(pricebookToCurrencyMap).forEach((pricebookId) => {
        let priceObj = {
          pricebook: pricebookId,
          currencies: {},
        };
        let currencyArray = pricebookToCurrencyMap[pricebookId];
        currencyArray.forEach((curr) => {
          priceObj.currencies[curr.code] = parseFloat(curr.price);
        });

        pricingObj.values.push(priceObj);
      });
      item.product.attributes.push(pricingObj);
    }

    return item;
  }

  // create a item type product with optional id query
  function createItem(item) {
    console.log(item, "Create ITEM ITEM");

    let uploadItem = {
      m: { itemId: item.id },
      query: {
        metadata: {
          itemId: item.id,
          catalog_code: item.catalog.code,
        },
      },
    };
    let product = {};

    product = {
      name: item.pn,
      type: "item",
      orgId: item.orgId, //getOrgId(item.destEnv),
      description: item.description,

      tags: ["product", `${item.catalog.code}`],
      metadata: [
        {
          type: "String",
          name: "itemId",
          blacklist: [],
          values: [],
          defaultValue: item.id,
        },
        {
          type: "String",
          name: "catalog_code",
          blacklist: [],
          values: [],
          defaultValue: item.catalog.code,
        },
        {
          type: "String",
          name: "catalog_desc",
          blacklist: [],
          values: [],
          defaultValue: item.catalog.desc,
        },
        {
          type: "String",
          name: "catalog_year",
          blacklist: [],
          values: [],
          defaultValue: item.catalog.year,
        },
        {
          type: "String",
          name: "catalog_month",
          blacklist: [],
          values: [],
          defaultValue: item.catalog.month,
        },
        {
          type: "String",
          name: "catalog_day",
          blacklist: [],
          values: [],
          defaultValue: item.catalog.day,
        },
        {
          type: "String",
          name: "catalog_version",
          blacklist: [],
          values: [],
          defaultValue: item.catalog.version,
        },
        {
          type: "String",
          name: "_UI_displayAttributesAs",
          blacklist: [],
          values: [],
          defaultValue: JSON.stringify(item.displayAttributesAs),
        },
        {
          type: "String",
          name: "source",
          defaultValue: item.sourceKey,
        },
      ],
      rules: [],
    };
    if (item.itemGroups && !item.itemGroups.some((grp) => !grp.attributeIds)) {
      product.attributes = item.itemGroups.map((att) => {
        const defaultValue =
          att.attributeIds.length === 1 ? att.attributeIds[0] : { assetId: "" };

        return {
          type: "Asset",
          name: att.groupName,
          blacklist: [],
          assetType: "item",
          values: att.attributeIds,
          defaultValue: defaultValue,
        };
      });
    }

    let rule = {
      conditions: [],
      actions: [
        {
          type: "custom-script",
          name: "custom-script",
          content: ruleContent,
          enabled: false,
          error: "",
        },
      ],
      name: "Propagate Nested Attribute Values",
    };
    product.rules.push(rule);

    if (item.prices) {
      if (!product.attributes) {
        product.attributes = [];
      }
      let pricingObj = {
        type: "Pricing",
        name: "Pricing",
        values: [],
      };
      let pricebookToCurrencyMap = {};
      item.prices.forEach((price) => {
        if (!pricebookToCurrencyMap.hasOwnProperty(price.pricebookId)) {
          //not in the map yet
          let currencyArray = [
            { code: price.currencyCode, price: price.price },
          ];
          pricebookToCurrencyMap[price.pricebookId] = currencyArray;
        } else {
          //in the map already
          let currencyArray = pricebookToCurrencyMap[price.pricebookId];
          currencyArray.push({
            code: price.currencyCode,
            price: price.price,
          });
        }
      });
      Object.keys(pricebookToCurrencyMap).forEach((pricebookId) => {
        let priceObj = {
          pricebook: pricebookId,
          currencies: {},
        };
        let currencyArray = pricebookToCurrencyMap[pricebookId];
        currencyArray.forEach((curr) => {
          priceObj.currencies[curr.code] = parseFloat(curr.price);
        });

        pricingObj.values.push(priceObj);
      });
      product.attributes.push(pricingObj);
    }
    if (item.modelId) {
      product.asset = {
        assetId: item.modelId,
        configuration: "",
        type: "model",
      };
    }

    uploadItem.product = product;

    console.log(uploadItem, "uploadItem in createItem");
    return uploadItem;
  }
  function createFamily(item) {
    let uploadItem = {
      m: { itemId: item.id },
      query: {
        metadata: {
          itemId: item.id,
          catalog_code: item.catalogCode,
        },
      },
      product: {
        name: item.name,
        type: "item",
        orgId: item.orgId,
        tags: item.tags,
        metadata: item.metadata,
        proxyId: item.proxyId,
        rules: item.rules,
        attributes: item.attributes,
        asset: {
          assetId: "",
          configuration: "",
          type: "model",
        },
      },
    }
    if (item.modelId) {
      uploadItem.product.asset = {
        assetId: item.modelId,
        configuration: "",
        type: "model",
      };
    };
    console.log(uploadItem, "uploadItem in createNewFamily");
    return uploadItem;
  }
  function createNewProduct(item) {

    
    let uploadItem = {
      m: { itemId: item.id },
      query: {
        metadata: {
          itemId: item.id,
          catalog_code: item.catalogCode,
        },
      },
      product: {
        name: item.name,
        type: "item",
        metadata: item.metadata,
        tags: item.tags,
        rules: item.rules,
        attributes: item.attributes,
        forms: item.forms,
        script: item.script,
        orgId: item.orgId,
        // proxyId: item.proxyId,
        asset: item.asset,
      },
    };
    if (item.modelId) {
      uploadItem.product.asset = {
        assetId: item.modelId,
        configuration: "",
        type: "model",
      };
    };
    console.log(uploadItem, "uploadItem in createNewProduct");
    return uploadItem;
  }

  async function sendItemToQueue(item) {
    console.log("sentITemToQue fired", item);
    var itemLength = JSON.stringify(item).length;
    const sendPromise =
      itemsToQueueBuffer.length >= 10 ||
      itemsToQueueBufferLength + itemLength >= maxQueueMessageSize
        ? flushItemsToQueue()
        : null;

    itemsToQueueBuffer.push(item);
    itemsToQueueBufferLength += itemLength;

    return sendPromise;
  }

  // send array of items that need assets created or updated to asset queue
  //current empty array aka 0 length, so doesn't get to if statement
  function flushItemsToQueue() {
    console.log(
      "flushing ",
      itemsToQueueBuffer,
      "  items to queue right here right now"
    );
    if (itemsToQueueBuffer.length > 0) {
      var params = {
        Entries: itemsToQueueBuffer.map((it, i) => {
          console.log({
            event: "enqueue",
            queueType: "needAsset",
            objectType: it.type,
            id: it.id,
          });
          return {
            Id: it.id,
            MessageBody: JSON.stringify(it),
            MessageAttributes: {
              enqueueTime: {
                DataType: "Number",
                StringValue: Date.now().toString(),
              },
            },
          };
        }),
        QueueUrl: process.env.itemsNeedingAssetsQueue, //'https://sqs.us-east-1.amazonaws.com/890084055036/itemsNeedingAssets'
      };
      console.log(params.Entries, "PARAMS");

      console.log("sending to queue ", util.inspect(params, { depth: 5 }));

      itemsToQueueBuffer = [];
      itemsToQueueBufferLength = 0;

      const messageSendPromise = sqs.sendMessageBatch(params).promise();
      console.log("flush messageSendPromise: ", messageSendPromise);
      return messageSendPromise;
    } else {
      return Promise.resolve("flushed no items to queue");
    }
  }

  function requeueFailedJobItem(item) {
    var params = {
      Entries: [
        {
          Id: item.id,
          MessageBody: JSON.stringify(item),
          MessageAttributes: {
            enqueueTime: {
              DataType: "Number",
              StringValue: Date.now().toString(),
            },
          },
        },
      ],
      QueueUrl: process.env.parsedApiItemsQueue,
    };

    console.log(
      "sending failed job item to queue ",
      util.inspect(params, { depth: 5 })
    );

    const messageSendPromise = sqs.sendMessageBatch(params).promise();

    return messageSendPromise;
  }

  async function pushItemsForEnv(key) {
    const orgId = orgMap[key].orgId;
    const apiUrl = orgMap[key].apiUrl;
    const apiToken = orgMap[key].apiToken;
    const itemsToUploadEnv = itemsToUpload[key];
    if (itemsToUploadEnv.length > 0) {
      const itemsData = new FormData();

      console.log(
        "Uploading Ids: ",
        itemsToUploadEnv.map((i) => i.m)
      );
      itemsData.append("file", JSON.stringify(itemsToUploadEnv), "items.json");
      itemsData.append("sync", "false");
      const config = {
        headers: {
          Authorization: "Bearer " + apiToken,
          ...itemsData.getHeaders(),
        },
      };
      console.log({ event: "startApiCall" }, JSON.stringify(itemsToUploadEnv));
      const t = Date.now();
      const importStartTime = Date.now();
      return axios
        .post(apiUrl + "/products/import?orgId=" + orgId, itemsData, config)
        .catch((error) => {
          const importEndTime = Date.now();
          var importDuration = Math.abs(importStartTime - importEndTime) / 1000;
          const startDate = new Date(importStartTime);
          const endDate = new Date(importEndTime);
          let formattedStart = startDate.toISOString();
          let formattedEnd = endDate.toISOString();
          console.log(
            "erorr uploading ids " + itemsToUploadEnv.map((i) => i.m),
            error
          );

          itemsToUploadEnv.forEach((itm) => {
            let keyArray;
            if (itm.m.itemId) {
              keyArray = bodySourceKeys[itm.m.itemId];
            } else {
              keyArray = bodySourceKeys[itm.m.optionId];
            }
            console.log(keyArray, "keyArraykeyArraykeyArray jun7");
            if (error.response) {
              // The request was made and the server responded with a status code
              // that falls out of the range of 2xx
              keyArray.forEach((k) => {
                logItemEvent(
                  events.failedApiCall(
                    apiUrl +
                      "/products/import?orgId=" +
                      orgId +
                      " start: " +
                      formattedStart +
                      " end: " +
                      formattedEnd +
                      " duration: " +
                      importDuration +
                      " seconds",
                    JSON.stringify(itemsToUploadEnv),
                    error.response.data,
                    error.response.status,
                    error.response.headers
                  ),
                  k,
                  orgId
                );
              });
              console.log(error.response.data);
              console.log(error.response.status);
              console.log(error.response.headers);
            } else if (error.request) {
              // The request was made but no response was received
              // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
              // http.ClientRequest in node.js
              console.log(error.request);
              keyArray.forEach((k) => {
                logItemEvent(
                  events.noResponseApiCall(
                    apiUrl +
                      "/products/import?orgId=" +
                      orgId +
                      " start: " +
                      formattedStart +
                      " end: " +
                      formattedEnd +
                      " duration: " +
                      importDuration +
                      " seconds",
                    JSON.stringify(itemsToUploadEnv),
                    error
                  ),
                  k,
                  orgId
                );
              });
            } else {
              // Something happened in setting up the request that triggered an Error
              console.log("Error", error.message);
              keyArray.forEach((k) => {
                logItemEvent(
                  events.unknownErrorApiCall(
                    apiUrl +
                      "/products/import?orgId=" +
                      orgId +
                      " start: " +
                      formattedStart +
                      " end: " +
                      formattedEnd +
                      " duration: " +
                      importDuration +
                      " seconds",
                    JSON.stringify(itemsToUploadEnv),
                    "error, '!123123",
                    error.message
                  ),
                  k,
                  orgId
                );
              });
            }
          });
          throw error;
        })
        .then((res) => {
          console.log({ event: "Successful API call" });
          //get jobId based on result
          const jobId = res.data.jobId;
          //poll for job completion
          return pollJob(jobId, apiUrl, apiToken, {
            timeout: 1000 * 60 * 10,
            frequency: 2000,
          })
            .then((pollResult) => {
              let status = pollResult.status;
              let success = pollResult.success;
              if (status === "stopped" && success) {
                console.log("items import job stopped, calling job runs api");
                const runsUrl = `${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId}`;
                const runsStartTime = Date.now();
                return axios
                  .get(runsUrl, {
                    headers: { Authorization: "Bearer " + apiToken },
                  })
                  .then((res) => {
                    const { runs } = res.data;
                    const { results } = runs[0];
                    const fileId = results.files[0].id;
                    console.log("fileId ", fileId);
                    const filesStartTime = Date.now();
                    return axios
                      .get(`${apiUrl}/files/${fileId}/content`, {
                        headers: { Authorization: "Bearer " + apiToken },
                      })
                      .then((fileContent) => {
                        console.log(
                          "item import job run results: ",
                          fileContent
                        );
                        let promises = [];
                        if (fileContent && fileContent.data) {
                          const productsCreated = fileContent.data.map((p) => {
                            if (p.metadata.itemId) {
                              let sourceKeyArray =
                                bodySourceKeys[p.metadata.itemId];
                                console.log(bodySourceKeys, 'bodySourceKeys', bodySourceKeys[p.metadata.itemId], 'bodySourceKeys[p.metadata.itemId]', p.metadata.itemId, 'itemID' )
                              sourceKeyArray.forEach((sourceKey) => {
                                logItemEvent(
                                  events.createdItem(
                                    p.metadata.itemId,
                                    p.id,
                                    Date.now() - t
                                  ),
                                  sourceKey,
                                  orgId
                                );
                                let completedItemPromise =
                                  writeCompletedItemToDatabase(
                                    p.metadata.itemId,
                                    "item",
                                    sourceKey
                                  );
                                promises.push(completedItemPromise);
                              });
                              return p.metadata.itemId;
                            }
                            // if(p.metadata.optionId) {

                            // }
                            else {
                              let sourceKeyArray =
                                bodySourceKeys[p.metadata.optionId];
                              console.log(
                                "in else statement jun8",
                                p,
                                sourceKeyArray
                              );
                              sourceKeyArray.forEach((sourceKey) => {
                                logItemEvent(
                                  events.createdOption(
                                    p.metadata.optionId,
                                    p.id,
                                    Date.now() - t
                                  ),
                                  sourceKey,
                                  orgId
                                );
                                let completedItemPromise =
                                  writeCompletedAndAssetToDatabase(
                                    p.metadata.optionId,
                                    "option",
                                    sourceKey,
                                    p.id,
                                    p.metadata.groupId,
                                    p.metadata.catalogCode,
                                    p.metadata.optionId,
                                    p.name
                                  );
                                promises.push(completedItemPromise);
                              });
                              return p.metadata.optionId;
                            }
                          });
                          console.log(itemsToUploadEnv, "itemID is undefined");
                          const productsFailed = itemsToUploadEnv
                            .filter((p) => {
                              console.log(p);
                              const itemId = p.m.itemId
                                ? p.m.itemId
                                : p.m.optionId;
                              return !productsCreated.includes(itemId);
                            })
                            .map((p) => {
                              console.log(p.m);
                              if (p.m.itemId) {
                                let sourceKeyArray = bodySourceKeys[p.m.itemId];
                                console.log(
                                  sourceKeyArray,
                                  "undefined here jun71"
                                );
                                sourceKeyArray.forEach((sourceKey) => {
                                  logItemEvent(
                                    events.errorCreatingItem(p.m.itemId),
                                    sourceKey,
                                    orgId
                                  );
                                });
                                return p.m.itemId;
                              } else {
                                let sourceKeyArray =
                                  bodySourceKeys[p.m.optionId];
                                console.log(
                                  sourceKeyArray,
                                  "undefined here jun72"
                                );
                                sourceKeyArray.forEach((sourceKey) => {
                                  logItemEvent(
                                    events.errorCreatingOption(p.m.optionId),
                                    sourceKey,
                                    orgId
                                  );
                                });
                                return p.m.optionId;
                              }
                            });

                          if (productsFailed.length > 0) {
                            console.log("Items failed: ", productsFailed);
                          }
                        }
                        return Promise.all(promises).then((r) => {
                          console.log("completed all db promises for item ", r);
                          return fileContent.data;
                        });
                      })
                      .catch((error) => {
                        //NOT CHATCHING HERE
                        console.log(error, itemsToUploadEnv, "GETTINGHERE");
                        const filesEndTime = Date.now();
                        let filesDuration =
                          Math.abs(filesStartTime - filesEndTime) / 1000;
                        const startDate = new Date(filesStartTime);
                        const endDate = new Date(filesEndTime);
                        let formattedStart = startDate.toISOString();
                        let formattedEnd = endDate.toISOString();
                 
                        itemsToUploadEnv.forEach((itm) => {
                          let keyArray;
                          if (itm.m.itemId) {
                            keyArray = bodySourceKeys[itm.m.itemId];
                          } else {
                            keyArray = bodySourceKeys[itm.m.optionId];
                          }
                          if (error.response) {
                            // The request was made and the server responded with a status code
                            // that falls out of the range of 2xx
                            keyArray.forEach((k) => {
                              logItemEvent(
                                events.failedApiCall(
                                  `${apiUrl}/files/${fileId}/content start: ${formattedStart} end: ${formattedEnd} duration: ${filesDuration} seconds`,
                                  "this is here 3",
                                  error.response.data,
                                  error.response.status,
                                  error.response.headers
                                ),
                                k,
                                orgId
                              );
                            });
                            console.log(error.response.data);
                            console.log(error.response.status);
                            console.log(error.response.headers);
                          } else if (error.request) {
                            // The request was made but no response was received
                            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                            // http.ClientRequest in node.js
                            console.log(error.request);
                            keyArray.forEach((k) => {
                              logItemEvent(
                                events.noResponseApiCall(
                                  `${apiUrl}/files/${fileId}/content start: ${formattedStart} end: ${formattedEnd} duration: ${filesDuration} seconds`,
                                  "this is here 2",
                                  error
                                ),
                                k,
                                orgId
                              );
                            });
                          } else {
                            // Something happened in setting up the request that triggered an Error
                            console.log("Error", error.message);
                            keyArray.forEach((k) => {
                              logItemEvent(
                                events.unknownErrorApiCall(
                                  `${apiUrl}/files/${fileId}/content start: ${formattedStart} end: ${formattedEnd} duration: ${filesDuration} seconds`,
                                  "this is here 1",
                                  error.message
                                ),
                                k,
                                orgId
                              );
                            });
                          }
                        });
                        throw error;
                      });
                  })
                  .catch((error) => {
                    console.log("error during jobs runs", error);
                    const runsEndTime = Date.now();
                    let runsDuration =
                      Math.abs(runsStartTime - runsEndTime) / 1000;
                    const startDate = new Date(runsStartTime);
                    const endDate = new Date(runsEndTime);
                    let formattedStart = startDate.toISOString();
                    let formattedEnd = endDate.toISOString();
                    itemsToUploadEnv.forEach((itm) => {
                      let keyArray;
                      if (itm.m.itemId) {
                        keyArray = bodySourceKeys[itm.m.itemId];
                      } else {
                        keyArray = bodySourceKeys[itm.m.optionId];
                      }
                      if (error.response) {
                        // The request was made and the server responded with a status code
                        // that falls out of the range of 2xx
                        console.log(error, "ERROR3", keyArray);
                        keyArray.forEach((k) => {
                          logItemEvent(
                            events.failedApiCall(
                              `${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId} start: ${formattedStart} end: ${formattedEnd} duration: ${runsDuration} seconds`,
                              "",
                              error.response.data,
                              error.response.status,
                              error.response.headers
                            ),
                            k,
                            orgId
                          );
                        });
                        console.log(error.response.data);
                        console.log(error.response.status);
                        console.log(error.response.headers);
                      } else if (error.request) {
                        // The request was made but no response was received
                        // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                        // http.ClientRequest in node.js
                        console.log(error.request, "error2", keyArray);
                        keyArray.forEach((k) => {
                          logItemEvent(
                            events.noResponseApiCall(
                              `${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId} start: ${formattedStart} end: ${formattedEnd} duration: ${runsDuration} seconds`,
                              "",
                              error
                            ),
                            k,
                            orgId
                          );
                        });
                      } else {
                        // Something happened in setting up the request that triggered an Error
                        console.log("Error 1", error.message, keyArray);
                        keyArray.forEach((k) => {
                          logItemEvent(
                            events.unknownErrorApiCall(
                              `${apiUrl}/jobs/runs?orgId=${orgId}&jobId=${jobId} start: ${formattedStart} end: ${formattedEnd} duration: ${runsDuration} seconds`,
                              "",
                              error.message
                            ),
                            "Error 1111123",
                            k,
                            orgId
                          );
                        });
                      }
                    });
                    throw error;
                  });
              } else if (status === "pending") {
                console.log(
                  "item import job polling timed out for items " +
                    itemsToUploadEnv.map((i) => i.m)
                );
                // reached specified timeout to check for completion but job still not done
                // call api to cancel current job and put back on the queue for retry
                //https://${threekitEnvDomain}/api/jobs/${jobId}/cancel?orgId=${orgId}
                const config = {
                  headers: {
                    Authorization: "Bearer " + apiToken,
                  },
                };
                return axios
                  .post(
                    `${apiUrl}/jobs/${jobId}/cancel?orgId=${orgId}`,
                    {},
                    config
                  )
                  .then((res) => {
                    console.log("response from job cancel call", res);
                  })
                  .catch((err) => {
                    console.log("error calling cancel job api", err);
                  })
                  .finally(() => {
                    // track retries
                    itemsToUploadEnv.forEach((itm) => {
                      let bodyToRetry;
                      if (itm.m.itemId) {
                        bodyToRetry = itemToBodyMap[itm.m.itemId];
                      } else {
                        bodyToRetry = itemToBodyMap[itm.m.optionId];
                      }
                      bodyToRetry.jobTries = (bodyToRetry.jobTries || 0) + 1;
                      if (bodyToRetry.jobTries < process.env.jobRetryLimit) {
                        //requeue item/option
                        return requeueFailedJobItem(bodyToRetry);
                      } else {
                        //tried max number of times
                        //write to logs
                        let keyArray;
                        let idOfItem;
                        if (itm.m.itemId) {
                          idOfItem = itm.m.itemId;
                          keyArray = bodySourceKeys[itm.m.itemId];
                        } else {
                          idOfItem = itm.m.optionId;
                          keyArray = bodySourceKeys[itm.m.optionId];
                        }
                        keyArray.forEach((k) => {
                          logItemEvent(
                            events.unknownErrorApiCall(
                              `${apiUrl}/jobs/${jobId}`,
                              JSON.stringify(itemsToUploadEnv),
                              `Job timed out ${process.env.jobRetryLimit} times. Item ${idOfItem} failed to import.`
                            ),
                            'ERROR 5555',
                            k,
                            orgId
                          );
                        });
                        return "done";
                      }
                    });
                  });
                //throw new Error('item import job polling timed out for items '+itemsToUploadEnv.map(i => i.m));
              } else {
                // error - job failed
                console.log(
                  "item import job failed for items " +
                    itemsToUploadEnv.map((i) => i.m)
                );

                itemsToUploadEnv.forEach((itm) => {
                  let keyArray;
                  if (itm.m.itemId) {
                    keyArray = bodySourceKeys[itm.m.itemId];
                  } else {
                    keyArray = bodySourceKeys[itm.m.optionId];
                  }
                  keyArray.forEach((k) => {
                    logItemEvent(
                      events.unknownErrorApiCall(
                        apiUrl + "/products/import?orgId=" + orgId,
                        JSON.stringify(itemsToUploadEnv),
                        "job failed"
                      ),
                      "error112333",
                      k,
                      orgId
                    );
                  });
                });
                throw new Error(
                  "item import job failed for items " +
                    itemsToUploadEnv.map((i) => i.m)
                );
              }
            })
            .catch((error) => {
              console.log("polling error ", error);

              throw error;
            });
        });
    } else {
      console.log("no items to upload, skipping job api call");
    }
  }

  /* process event */

  let itemsToUpload = {};
  //appending to this object//
  console.log(util.inspect(event, { depth: 5 }));

  const bodySourceKeys = {};
  const orgMap = {};
  const itemToBodyMap = {};

  for (let i = 0; i < event.Records.length; i++) {
    let r = event.Records[i];
    const body = JSON.parse(r.body);
    console.log(body.type, "BODY RESPONSE");
    let notCancelled = await checkIfJobCancelled(body.sourceKey);
    if (notCancelled) {
      const getQueueTime =
        r.messageAttributes &&
        r.messageAttributes["enqueueTime"] &&
        r.messageAttributes["enqueueTime"].stringValue
          ? () =>
              Date.now() -
              Number.parseInt(r.messageAttributes["enqueueTime"].stringValue)
          : () => null;
      if (bodySourceKeys.hasOwnProperty(body.id)) {
        let sourceKeyArray = bodySourceKeys[body.id];
        sourceKeyArray.push(body.sourceKey);
      } else {
        bodySourceKeys[body.id] = [body.sourceKey];
      }
      if (!orgMap.hasOwnProperty(body.orgId)) {
        orgMap[body.orgId] = {
          apiUrl: body.apiUrl,
          apiToken: body.apiToken,
          orgId: body.orgId,
        };
      }
      if (body && body.type && body.type === "option") {
        const option = createOption(body);
        if (!itemsToUpload[body.orgId]) {
          itemsToUpload[body.orgId] = [];
        }
        if (
          (body.im && !body.materialId && !body.assetChecked) ||
          (body.subGroupOptions &&
            !body.subGroupOptionIds &&
            !body.assetChecked)
        ) {
          // option will get passed to asset queue
          sendItemToQueue(body);
        } else {
          let exists = await checkAssetExists(
            body.groupId,
            body.catalog.code,
            body.id,
            body.sourceKey
          );
          if (!exists) {
            itemToBodyMap[option.m.optionId] = body;
            itemsToUpload[body.orgId].push(option);
          }
        }

        //***give new type ==== "family"//*** */
      } else if 
      (body && body.type && body.type === "item") {
        console.log(
          "body Type is item, which we want!",
          body,
          body.modelId,
          body.newproduct,
          body.family
        );
        // const item;

        // const item = body.newproduct ? createNewProduct(body) : body.family ? createFamily(body) : createItem(body);
        const item = body.newproduct
          ? createNewProduct(body)
          : body.family
          ? createFamily(body)
          : createItem(body);

        console.log(item, "response from create item");

        if (!itemsToUpload[body.orgId]) {
          console.log("no items to update in bodyorgID");
          itemsToUpload[body.orgId] = [];
        }
        if(body.newproduct && !body.modelId) {
          itemsToUpload[body.orgId].push(item);
        }
        if (!body.modelId && !body.newproduct) {
          console.log("DO WE have a modelID");
          //switching to sending item vs body
          sendItemToQueue(body);
        } else {
          itemToBodyMap[item.m.itemId] = body;
          console.log(body, "else statement BODY BEING PUSHED");
          itemsToUpload[body.orgId].push(item);
        }
      }
    } else {
      console.log("job cancelled, skipping processing", body);
    }
  }

  return flushItemsToQueue().then((r) => {
    console.log("flush items to queue result1 ", r, itemsToUpload);
    if (r.Failed && r.Failed.length > 0) {
      console.log("num failed", r.Failed);
      throw new Error("failed sending to queue");
    }
    return Promise.all(
      Object.keys(itemsToUpload).map((key) => pushItemsForEnv(key))
    )
      .then((a) => {
        return finishLogEvents().then((_) => a);
      })
      .then((a) => {
        console.log("before flush items to queue2");
        return flushItemsToQueue().then((r) => {
          console.log("flush items to queue result at end ", r);
        });
      });
  });
};
