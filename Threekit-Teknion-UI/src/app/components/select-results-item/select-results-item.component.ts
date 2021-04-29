import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LocalStorageService } from 'src/app/services/localStorage.service';
import { AwsLogsService } from 'src/app/services/aws-logs.service';

@Component({
	selector: 'app-select-results-item',
	templateUrl: './select-results-item.component.html',
	styleUrls: ['./select-results-item.component.scss']
})
export class SelectResultsItemComponent implements OnInit {
	@Input() importName: string;
	@Input() timestamp: string;
	@Input() importValue: string;
	@Output() selectImport: EventEmitter<void> = new EventEmitter<void>();
	@Output() deleteImport: EventEmitter<void> = new EventEmitter<void>();

	importStatus:string = 'Checking...';
	queryId:string;
	refreshProgressTimeout;
	queryResultTimeout;
	percentComplete: number = 0;
	isActive = false;

	constructor(private localStorageService: LocalStorageService, private logsService: AwsLogsService) { }

	ngOnInit(): void {
		this.isActive = true;
		this.checkStatus();
	}

	emitSelectImport() {
		this.selectImport.emit();
	}

	emitDeleteImport(e) {
		e.stopPropagation();
		this.deleteImport.emit();
	}

	checkStatus() {
		//check if in localStorage
		let importStatuses = this.localStorageService.getImportStatuses();
		if(importStatuses.hasOwnProperty(this.importValue)) {
			this.importStatus = importStatuses[this.importValue];
		} else {
			//query logs
			if(this.isActive === true) {
				this.refreshProgressTimeout = setTimeout(() => this.refreshProgress(), 2000);
			}
		}
	}

	refreshProgress() {
		this.logsService.startProgressQuery(this.importValue)
		.then(log => {
			console.log('progress', log);
			this.queryId = log.queryId;
			if(this.isActive === true) {
				this.queryResultTimeout = setTimeout(() => this.waitForQueryResult(), 5000);
			}
		}).catch(error => {
			if(this.isActive === true) {
				this.refreshProgressTimeout = setTimeout(() => this.refreshProgress(), 20000);
			}
		});
	}

	waitForQueryResult() {
		this.logsService.getQueryResults(this.queryId).then(res => {
			console.log('res', res);
			if(res.status === 'Running' || res.status === 'Scheduled') {
				if(this.isActive === true) {
					this.queryResultTimeout = setTimeout(() => this.waitForQueryResult(), 5000);
				}
			} else if(res.status === 'Complete') {
				let total = 0;
				let totalObj = res.results[0];
				if(totalObj) {
					console.log(totalObj);
					let i=0;
					for(i;i<totalObj.length;i++) {
						if(totalObj[i].field === "TOTAL_ITEMS") {
							total = parseInt(totalObj[i].value);
							break;
						}
					}
					console.log('total',total);
					console.log('num lines', res.results.length-1);
					if(total === 0) {
						this.percentComplete = 0;
					} else {
						this.percentComplete = ((res.results.length-1)/total)*100;
					}
				}
				if(this.percentComplete < 100) {
					this.importStatus = 'In Progress';
					if(this.isActive === true) {
						this.refreshProgressTimeout = setTimeout(() => this.refreshProgress(), 20000);
					}
				} else {
					this.importStatus = 'Complete';
					this.localStorageService.setStatusOfImport(this.importValue, 'Complete');
				}
			}
		});
	}

	ngOnDestroy() {
		this.isActive = false;
		if(this.queryResultTimeout) {
			clearTimeout(this.queryResultTimeout);
		}
		if(this.refreshProgressTimeout) {
			clearTimeout(this.refreshProgressTimeout);
		}
	}
}
