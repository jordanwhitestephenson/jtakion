import { Injectable } from '@angular/core';
import { environment } from './../../environments/environment';
import { HttpClient } from '@angular/common/http';

@Injectable({
	providedIn: 'root'
})
export class AwsDbService {
	jobEndpoint = '';

	constructor(private http: HttpClient) { 
		this.jobEndpoint = environment.jobEndpoint;
	}

	getProgressForJob(logGroupName:string) {
		return this.http.get<any>(this.jobEndpoint+`/import/job/${logGroupName}`).toPromise();
	}
}