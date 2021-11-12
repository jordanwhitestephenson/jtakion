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
        logGroupName: `${prefix}${this.logGroupPrefix}${logGroupName}`, /* required */
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
          logGroupName: `${prefix}${this.logGroupPrefix}${logGroupName}`
        };
        
        return cloudWatchLogs.deleteLogGroup(params).promise();
    }
  }

  /*startProgressQuery(logGroupName:string) {
		const cloudWatchLogs = new AWS.CloudWatchLogs({
		  region: this.paramsService.region,
		  accessKeyId: this.paramsService.awsAccessToken,
		  secretAccessKey: this.paramsService.awsSecretToken
		});

		let prefix = '';
		if(this.paramsService.logPrefix && this.paramsService.logPrefix !== "") {
			prefix = '/' + this.paramsService.logPrefix;
		}

		var params: any = {
			endTime: Date.now(), 
			queryString: this.progressQuery, 
			startTime: Date.now()-315569520000,
			logGroupName: `${prefix}${this.logGroupPrefix}${logGroupName}`
		};
		
		return cloudWatchLogs.startQuery(params).promise();
  }

  getQueryResults(queryId:string) {
		const cloudWatchLogs = new AWS.CloudWatchLogs({
		  region: this.paramsService.region,
		  accessKeyId: this.paramsService.awsAccessToken,
		  secretAccessKey: this.paramsService.awsSecretToken
		});

		var params = {
			queryId: queryId 
		};
		
		return cloudWatchLogs.getQueryResults(params).promise();
  }*/
}
