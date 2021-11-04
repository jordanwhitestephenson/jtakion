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
		sql: 'select job.nm, job.total_items, job.stat, count(DISTINCT job_item.object_id) FROM job LEFT JOIN job_item ON job.jid = job_item.jid WHERE job.nm = :jobname GROUP BY job.nm, job.total_items, job.stat;',
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
	if(data.length > 0) {
		//check stat column
		if(data[0]['stat'] == 'pending') {
			//no status yet, check counts
			if(data[0]['total_items'] === data[0]['count']) {
				//all have been processed, set stat = 'complete'
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
								'stringValue': 'complete'
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
				//delete job items
				let deletesqlParams = {
					secretArn: secretArn,
					resourceArn: dbArn,
					sql: 'DELETE FROM job_item WHERE jid = (SELECT jid FROM job WHERE nm = :jobname);',
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
				let deleteresp = await rdsDataService.executeStatement(deletesqlParams).promise();
				console.log('deleted job items', deleteresp);
				//delete asset lookup
				let deleteassetsqlParams = {
					secretArn: secretArn,
					resourceArn: dbArn,
					sql: 'DELETE FROM asset_lookup WHERE jid = (SELECT jid FROM job WHERE nm = :jobname);',
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
				let deleteassetresp = await rdsDataService.executeStatement(deleteassetsqlParams).promise();
				console.log('deleted asset lookup', deleteassetresp);				
			}
		} else if(data[0]['stat'] === 'cancelled') {
			//do nothing
		} else {
			//is complete, set count = total items
			data[0]['count'] = data[0]['total_items'];
		}
	}

	const response = {
		statusCode: 200,
		body: JSON.stringify(data)
	};
	console.log('returning response',response);
	return response;
};