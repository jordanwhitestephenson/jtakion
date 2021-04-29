import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { AwsS3Service } from 'src/app/services/aws-s3.service';

@Component({
  selector: 'app-import',
  templateUrl: './import.component.html',
  styleUrls: ['./import.component.scss']
})
export class ImportComponent implements OnInit {
  @ViewChild('fileUploadInput', { static: false }) fileUploadInput: ElementRef;
  fileUpload: File;
  fileUploadName: string;
  fileErrorMessage: string;
  destEnv: string = 'default';
  envOptions = [
    {name: 'Develop', value: 'dev'},
    {name: 'Demo', value: 'demo'},
    {name: 'Staging', value: 'default'},
    {name: 'Production', value: 'prod'}
  ];
  isUploading = false;
  uploadComplete = false;

  constructor(
    private s3Service: AwsS3Service
  ) { 
    console.log("In constructor");
  }

  ngOnInit(): void {
    console.log("Initializing");
  }

  get fileName(): string {
    if (this.fileUpload) {
      return this.fileUpload.name;
    }
    return '';
  }

  get fileAttached(): boolean {
    return !!this.fileUpload;
  }

  get resultsRoute(): string {
    return `/#/results/${this.fileUploadName}`;
  }

  changeEnvironment(e) {
    this.destEnv = e.target.value;
  }

  updateFile(e) {
    this.fileErrorMessage = undefined;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      this.fileUpload = e.dataTransfer.files[0];
    }
    else if (e.target && e.target.files && e.target.files.length > 0) {
      this.fileUpload = e.target.files[0];
    }
    else {
      this.fileUpload = undefined;
    }
    if (!this.isFileXML()) {
      this.removeFile();
      this.fileErrorMessage = 'Only files of type XML are supported.';
    }
    this.uploadComplete = false;
  }

  removeFile() {
    if (this.fileUploadInput && this.fileUploadInput.nativeElement) {
      this.fileUploadInput.nativeElement.value = '';
    }
    this.fileUpload = undefined;
  }

  isFileXML() {
    if (this.fileUpload && this.fileUpload.name) {
      return this.fileUpload.name.endsWith('.xml');
    }
    return false;
  }

  importFile() {
    this.isUploading = true;
    this.fileUploadName = `${this.fileUpload.name.substring(0, this.fileUpload.name.length - 4)}-${Date.now()}`;
    this.s3Service.uploadFileToS3(this.fileUpload, this.fileUploadName, this.destEnv)
    .then(res => {
      this.removeFile();
      this.uploadComplete = true;
      console.log('Response: ', res);
    })
    .catch(err => {
      console.log('Error: ', err);
      this.fileErrorMessage = 'Error uploading file.';
    })
    .finally(() => {
      this.isUploading = false;
    });
  }

}
