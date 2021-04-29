const logProgressEvent = require('./progressEventLog.js').logProgressEvent;
const finishProgressLogEvents = require('./progressEventLog.js').finishLogEvents;
const progressEvents = require('./progressEventLog.js').events;

exports.handler = async (event) => {
	event.Records.forEach(r => {
		const body = JSON.parse(r.body);
		logProgressEvent(progressEvents.itemCompleted(body.id), body.sourceKey);
	});

	return finishProgressLogEvents().then( _ => {});
};
