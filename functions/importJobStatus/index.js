const AWS = require('aws-sdk');

const getParameter = require('./parameters.js').getParameter;
const getDbArn = (environmentName) => getParameter("db-arn")(environmentName);
const getSecretArn = (environmentName) => getParameter("secret-arn")(environmentName);
const rdsDataService = new AWS.RDSDataService();

exports.handler = async (event) => {
	const jobName = event.pathParameters.jobName;
	const dbArn = await getDbArn('default');
	const secretArn = await getSecretArn('default');
	console.log('getting status for '+jobName);
    let sqlParams = {
		secretArn: secretArn,
		resourceArn: dbArn,
		sql: 'select job.nm, job.total_items, count(DISTINCT job_item.object_id) FROM job, job_item WHERE job.jid = job_item.jid and job.nm = :jobname GROUP BY job.nm, job.total_items;',
		database: 'threekit',
		includeResultMetadata: true,
		parameters: [
			{
				'name': 'jobname',
				'value': {
					'stringValue': jobName
				}
			}
		]
	};
	let resp = await rdsDataService.executeStatement(sqlParams).promise();
	console.log(JSON.stringify(resp));
	let columns = resp.columnMetadata.map(c => c.name);
	let data = resp.records.map(r => {
        let obj = {};
        r.map((v, i) => {
            obj[columns[i]] = Object.values(v)[0];
        });
        return obj;
    });
	const response = {
		statusCode: 200,
		body: JSON.stringify(data)
	};
	console.log('returning response',response);
	return response;
};