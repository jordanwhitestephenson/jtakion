import { Injectable } from '@angular/core';
import * as AWS from 'aws-sdk';
//import { Auth } from 'aws-amplify';
import { environment } from './../../environments/environment';
import { ParamsService } from './params.service';

@Injectable({
  providedIn: 'root'
})
export class AwsLogsService {

  logGroupPrefix = '/teknion/items/import/';
  region = '';//'us-east-1';

  progressQuery = 'fields @message,objectId,TOTAL_ITEMS | filter @message like /createdItem/ or @message like /createdOption/ or @message like /TOTAL_ITEMS/ | stats count(objectId) as cnt by objectId,TOTAL_ITEMS | sort TOTAL_ITEMS desc, objectId | limit 10000';

  constructor(private paramsService: ParamsService) { 
	  this.region = environment.region;
  }

  getLogEvents(logGroupName, filterPattern, nextToken) {
	//replace non-valid characters from logGroupName with -
	const cleanedLogGroupName = logGroupName.replace(/[^\\.\\-_/#A-Za-z0-9]+/g,'-');

      const cloudWatchLogs = new AWS.CloudWatchLogs({
        region: this.region,
		accessKeyId: this.paramsService.awsAccessToken,
		secretAccessKey: this.paramsService.awsSecretToken
      });

      const params: any = {
        logGroupName: `${this.logGroupPrefix}${cleanedLogGroupName}`, 
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
        region: this.region,
		accessKeyId: this.paramsService.awsAccessToken,
		secretAccessKey: this.paramsService.awsSecretToken
      });

      const params: any = {
        logGroupNamePrefix: `${this.logGroupPrefix}${searchParam ? searchParam : ''}`
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
          region: this.region,
		  accessKeyId: this.paramsService.awsAccessToken,
		  secretAccessKey: this.paramsService.awsSecretToken
        });
  
        const params: any = {
          logGroupName: `${this.logGroupPrefix}${cleanedLogGroupName}`
        };
        
        return cloudWatchLogs.deleteLogGroup(params).promise();
    }
  }

  startProgressQuery(logGroupName:string) {
	//return Auth.currentCredentials().then(cred => {
		const cloudWatchLogs = new AWS.CloudWatchLogs({
		  region: this.region,
		  //credentials: cred
		  accessKeyId: this.paramsService.awsAccessToken,
		  secretAccessKey: this.paramsService.awsSecretToken
		});

		var params: any = {
			endTime: Date.now(), /* required */
			queryString: this.progressQuery, /* required */
			startTime: Date.now()-315569520000, /* required = 10 years */
			logGroupName: `${this.logGroupPrefix}${logGroupName}`
		};
		
		return cloudWatchLogs.startQuery(params).promise();
	  //});
  }

  getQueryResults(queryId:string) {
	//return Auth.currentCredentials().then(cred => {
		const cloudWatchLogs = new AWS.CloudWatchLogs({
		  region: this.region,
		  //credentials: cred
		  accessKeyId: this.paramsService.awsAccessToken,
		  secretAccessKey: this.paramsService.awsSecretToken
		});

		var params = {
			queryId: queryId /* required */
		};
		
		return cloudWatchLogs.getQueryResults(params).promise();
	  //});
  }
}
