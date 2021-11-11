import { Injectable } from '@angular/core';
import * as AWS from 'aws-sdk';
import { environment } from './../../environments/environment';
import { ParamsService } from './params.service';

@Injectable({
  providedIn: 'root'
})
export class AwsS3Service {

  constructor(private paramsService: ParamsService) { 
  }

  uploadFileToS3(file: File, fileName: string) {
      const bucket = new AWS.S3({
        apiVersion: 'latest',
        params: { Bucket: this.paramsService.bucketName},
		accessKeyId: this.paramsService.awsAccessToken,
		secretAccessKey: this.paramsService.awsSecretToken,
        httpOptions: {timeout: 300000},
		region: environment.region
      });
      
      const params: AWS.S3.PutObjectRequest = {
        Key:  `${fileName}.xml`,
        Bucket: this.paramsService.bucketName,
        Body: file,
        ACL: 'private',
        ContentType: file.type
      };
	  let orgId = this.paramsService.orgId;
	  let basePath = this.paramsService.apiBasePath;
	  let privateToken = this.paramsService.threekitPrivateToken;
	  let orgName = this.paramsService.orgName;
	  const metadata: AWS.S3.Metadata = {...params.Metadata, orgId, basePath, privateToken, orgName};
      params.Metadata = metadata;
  
      return bucket.putObject(params).promise();
  }
}
