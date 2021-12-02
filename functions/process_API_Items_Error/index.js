const AWS = require('aws-sdk');

const logProgressEvent = require('./progressEventLog.js').logProgressEvent;
const finishProgressLogEvents = require('./progressEventLog.js').finishLogEvents;
const progressEvents = require('./progressEventLog.js').events;
//const getParameter = require('./parameters.js').getParameter;
//const getDbArn = (environmentName) => getParameter("db-arn")(environmentName);
//const getSecretArn = (environmentName) => getParameter("secret-arn")(environmentName);
const rdsDataService = new AWS.RDSDataService();

exports.handler = async (event) => {
	const dbArn = process.env.dbArn;//await getDbArn('default');
	const secretArn = process.env.secretArn;//await getSecretArn('default');

	for(let i=0; i<event.Records.length; i++) {
    	let r = event.Records[i];
		const body = JSON.parse(r.body);
		console.log('writing conpleted error item to db ', body.type, body.sourceKey);
		let sqlParams = {
			secretArn: secretArn,
			resourceArn: dbArn,
			sql: 'INSERT INTO job_item (jid, object_id, item_type) values ((SELECT jid FROM job WHERE nm = :jobname), :objectid, :itemtype)',
			database: 'threekit',
			includeResultMetadata: true,
			parameters: [
				{
					'name': 'jobname',
					'value': {
						'stringValue': body.sourceKey
					}
				},
				{
					'name': 'objectid',
					'value': {
						'stringValue': ''
					}
				},
				{
					'name': 'itemtype',
					'value': {
						'stringValue': body.type
					}
				}
			]
		};
		let resp = await rdsDataService.executeStatement(sqlParams).promise();
		console.log(resp);		
	}
	event.Records.forEach(r => {
		const body = JSON.parse(r.body);
		logProgressEvent(progressEvents.itemCompleted(body.id), body.sourceKey, body.orgId);
	});

	return finishProgressLogEvents().then( _ => {});
};
