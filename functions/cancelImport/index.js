const AWS = require('aws-sdk');

const getParameter = require('./parameters.js').getParameter;
const getDbArn = (environmentName) => getParameter("db-arn")(environmentName);
const getSecretArn = (environmentName) => getParameter("secret-arn")(environmentName);
const rdsDataService = new AWS.RDSDataService();

exports.handler = async (event) => {
	const jobName = event.pathParameters.jobName;
	const dbArn = await getDbArn('default');
	const secretArn = await getSecretArn('default');
	console.log('cancelling job '+jobName);
	//set stat to cancelled
	let updatesqlParams = {
		secretArn: secretArn,
		resourceArn: dbArn,
		sql: 'UPDATE job SET stat = :s WHERE job.nm = :jobname;',
		database: 'threekit',
		includeResultMetadata: true,
		parameters: [
			{
				'name': 's',
				'value': {
					'stringValue': 'cancelled'
				}
			},
			{
				'name': 'jobname',
				'value': {
					'stringValue': jobName
				}
			}
		]
	};
	let updateresp = await rdsDataService.executeStatement(updatesqlParams).promise();
	console.log('updated job status', updateresp);		
	let data = {
		'success': true
	};
	const response = {
		statusCode: 200,
		body: JSON.stringify(data)
	};
	console.log('returning response',response);
	return response;
};