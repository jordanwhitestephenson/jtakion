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
		//replace non-valid characters from logGroupName with -
		const cleanedLogGroupName = logGroupName.replace(/[^\\.\\-_/#A-Za-z0-9]+/g,'-');
		return this.http.get<any>(this.paramsService.jobEndpoint+`/import/job/${cleanedLogGroupName}`).toPromise();
	}

	cancelJob(logGroupName:string) {
		//replace non-valid characters from logGroupName with -
		const cleanedLogGroupName = logGroupName.replace(/[^\\.\\-_/#A-Za-z0-9]+/g,'-');
		return this.http.get<any>(this.paramsService.cancelEndpoint+`/cancel/import/${cleanedLogGroupName}`).toPromise();
	}
}