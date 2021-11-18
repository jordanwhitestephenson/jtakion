import { Injectable } from '@angular/core';
import * as AWS from 'aws-sdk';
import { ParamsService } from './params.service';

@Injectable({
  providedIn: 'root'
})
export class AwsLogsService {

  logGroupPrefix = '/teknion/items/import/';

  progressQuery = 'fields @message,objectId,TOTAL_ITEMS | filter @message like /createdItem/ or @message like /createdOption/ or @message like /TOTAL_ITEMS/ | stats count(objectId) as cnt by objectId,TOTAL_ITEMS | sort TOTAL_ITEMS desc, objectId | limit 10000';

  constructor(private paramsService: ParamsService) { 
  }

  getLogEvents(logGroupName, filterPattern, nextToken) {
	  //replace non-valid characters from logGroupName with -
	  const cleanedLogGroupName = logGroupName.replace(/[^\\.\\-_/#A-Za-z0-9]+/g,'-');
      const cloudWatchLogs = new AWS.CloudWatchLogs({
        region: this.paramsService.region,
		accessKeyId: this.paramsService.awsAccessToken,
		secretAccessKey: this.paramsService.awsSecretToken
      });

	  let prefix = '';
	  if(this.paramsService.logPrefix && this.paramsService.logPrefix !== "") {
		  prefix = '/' + this.paramsService.logPrefix;
	  }

      const params: any = {
        logGroupName: `${prefix}${this.logGroupPrefix}${cleanedLogGroupName}`, /* required */
        interleaved: true,
        limit: 250
      };

      if (filterPattern) {
        params.filterPattern = filterPattern;
      }

      if (nextToken) {
        params.nextToken = nextToken;
      }

      return cloudWatchLogs.filterLogEvents(params).promise();
  }

  getLogGroupsList(nextToken, searchParam) {
      const cloudWatchLogs = new AWS.CloudWatchLogs({
        region: this.paramsService.region,
		accessKeyId: this.paramsService.awsAccessToken,
		secretAccessKey: this.paramsService.awsSecretToken
      });

	  let prefix = '';
	  if(this.paramsService.logPrefix && this.paramsService.logPrefix !== "") {
		  prefix = '/' + this.paramsService.logPrefix;
	  }

      const params: any = {
        logGroupNamePrefix: `${prefix}${this.logGroupPrefix}${searchParam ? searchParam : ''}`
     };

      if (nextToken) {
        params.nextToken = nextToken;
      }
      return cloudWatchLogs.describeLogGroups(params).promise();
  }

  deleteLogGroup(logGroupName: string) {
    if (logGroupName && logGroupName.length > 0) {
		//replace non-valid characters from logGroupName with -
		const cleanedLogGroupName = logGroupName.replace(/[^\\.\\-_/#A-Za-z0-9]+/g,'-');
        const cloudWatchLogs = new AWS.CloudWatchLogs({
          region: this.paramsService.region,
		  accessKeyId: this.paramsService.awsAccessToken,
		  secretAccessKey: this.paramsService.awsSecretToken
        });

		let prefix = '';
		if(this.paramsService.logPrefix && this.paramsService.logPrefix !== "") {
			prefix = '/' + this.paramsService.logPrefix;
		}
  
        const params: any = {
          logGroupName: `${prefix}${this.logGroupPrefix}${cleanedLogGroupName}`
        };
        
        return cloudWatchLogs.deleteLogGroup(params).promise();
    }
  }
}
