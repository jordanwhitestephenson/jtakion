import { Injectable } from '@angular/core';
import * as AWS from 'aws-sdk';
import { Auth } from 'aws-amplify';
import { environment } from './../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AwsS3Service {

  fileUploadBucketName: string = '';//'teknioninput';

  constructor() { 
	  this.fileUploadBucketName = environment.s3Bucket;
  }

  uploadFileToS3(file: File, fileName: string, destEnv: string) {
    return Auth.currentCredentials().then(cred => {
      const bucket = new AWS.S3({
        apiVersion: 'latest',
        params: { Bucket: this.fileUploadBucketName},
        credentials: Auth.essentialCredentials(cred),
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
      const metadata: AWS.S3.Metadata = {...params.Metadata,  destEnv };
      params.Metadata = metadata;
  
      return bucket.putObject(params).promise();
    });
  }
}
