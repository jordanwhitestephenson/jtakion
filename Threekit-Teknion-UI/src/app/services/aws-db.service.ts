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
		return this.http.get<any>(this.jobEndpoint+`/import/job/${logGroupName}`).toPromise();
	}

	cancelJob(logGroupName:string) {
		return this.http.get<any>(this.cancelEndpoint+`/cancel/import/${logGroupName}`).toPromise();
	}
}