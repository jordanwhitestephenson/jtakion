import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ParamsService } from './params.service';

@Injectable({
	providedIn: 'root'
})
export class AwsDbService {


	constructor(private http: HttpClient, private paramsService: ParamsService) { 
	}

	getProgressForJob(logGroupName:string) {
		return this.http.get<any>(this.paramsService.jobEndpoint+`/import/job/${logGroupName}`).toPromise();
	}

	cancelJob(logGroupName:string) {
		return this.http.get<any>(this.paramsService.cancelEndpoint+`/cancel/import/${logGroupName}`).toPromise();
	}
}