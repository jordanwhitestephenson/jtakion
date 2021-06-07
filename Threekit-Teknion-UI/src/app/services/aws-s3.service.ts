import { Injectable } from '@angular/core';
import * as AWS from 'aws-sdk';
//import { Auth } from 'aws-amplify';
import { environment } from './../../environments/environment';
import { ParamsService } from './params.service';

@Injectable({
  providedIn: 'root'
})
export class AwsS3Service {

  fileUploadBucketName: string = '';//'teknioninput';

  constructor(private paramsService: ParamsService) { 
	  this.fileUploadBucketName = environment.s3Bucket;
  }

  //uploadFileToS3(file: File, fileName: string, destEnv: string) {
  uploadFileToS3(file: File, fileName: string) {
    //return Auth.currentCredentials().then(cred => {
      const bucket = new AWS.S3({
        apiVersion: 'latest',
        params: { Bucket: this.fileUploadBucketName},
        //credentials: Auth.essentialCredentials(cred),
		accessKeyId: this.paramsService.awsAccessToken,
		secretAccessKey: this.paramsService.awsSecretToken,
        httpOptions: {timeout: 300000},
		region: environment.region
      });
      
      const params: AWS.S3.PutObjectRequest = {
        Key:  `${fileName}.xml`,
        Bucket: this.fileUploadBucketName,
        Body: file,
        ACL: 'private',
        ContentType: file.type
      };
      //const metadata: AWS.S3.Metadata = {...params.Metadata,  destEnv };
	  let orgId = this.paramsService.orgId;
	  let basePath = this.paramsService.apiBasePath;
	  let privateToken = this.paramsService.threekitPrivateToken;
	  let orgName = this.paramsService.orgName;
	  const metadata: AWS.S3.Metadata = {...params.Metadata, orgId, basePath, privateToken, orgName};
      params.Metadata = metadata;
  
      return bucket.putObject(params).promise();
    //});
  }
}
