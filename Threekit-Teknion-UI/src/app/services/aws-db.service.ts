import { Injectable } from '@angular/core';
import { environment } from './../../environments/environment';
import { HttpClient } from '@angular/common/http';

@Injectable({
	providedIn: 'root'
})
export class AwsDbService {
	jobEndpoint = '';
	cancelEndpoint = '';


	constructor(private http: HttpClient) { 
		this.jobEndpoint = environment.jobEndpoint;
		this.cancelEndpoint = environment.cancelEndpoint;
	}

	getProgressForJob(logGroupName:string) {
		//replace non-valid characters from logGroupName with -
		const cleanedLogGroupName = logGroupName.replace(/[^\\.\\-_/#A-Za-z0-9]+/g,'-');
		return this.http.get<any>(this.jobEndpoint+`/import/job/${cleanedLogGroupName}`).toPromise();
	}

	cancelJob(logGroupName:string) {
		//replace non-valid characters from logGroupName with -
		const cleanedLogGroupName = logGroupName.replace(/[^\\.\\-_/#A-Za-z0-9]+/g,'-');
		return this.http.get<any>(this.cancelEndpoint+`/cancel/import/${cleanedLogGroupName}`).toPromise();
	}
}