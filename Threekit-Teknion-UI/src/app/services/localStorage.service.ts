import { Injectable } from '@angular/core';

const STORAGE_NAME = 'ThreeKitTeknionImportStatus';

@Injectable({
	providedIn: 'root'
})
export class LocalStorageService {
	constructor() { }

	setStatusOfImport(importName:string, status:string) {
		let statuses = localStorage.getItem(STORAGE_NAME);
		let statusObj;
		if(!statuses) {
			statusObj = {};
		} else {
			statusObj = JSON.parse(statuses);
		}
		statusObj[importName] = status;
		localStorage.setItem(STORAGE_NAME, JSON.stringify(statusObj));
	}

	getImportStatuses() {
		let statuses = localStorage.getItem(STORAGE_NAME);
		let statusObj;
		if(!statuses) {
			statusObj = {};
		} else {
			statusObj = JSON.parse(statuses);
		}
		return statusObj;
	}
}