import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { LocalStorageService } from 'src/app/services/localStorage.service';
import { AwsDbService } from 'src/app/services/aws-db.service';

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
	percentComplete: number = 0;
	isActive = false;

	constructor(private localStorageService: LocalStorageService, private dbService: AwsDbService) { }

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
		console.log('getting progress for job', this.importValue);
		this.dbService.getProgressForJob(this.importValue)
		.then(data => {
			if(data.length > 0) {
				let result = data[0];
				let total = 0;
				if(result['total_items']) {
					total = parseInt(result['total_items']);
				}
				let numLines = null;
				if(result['count']) {
					numLines = parseInt(result['count']);
				}
				console.log('total', total);
				console.log('numLines', numLines);
				if(numLines != null) {
					if(total === 0) {
						this.percentComplete = 0;
					} else {
						this.percentComplete = (numLines/total)*100;
					}
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
		}).catch(err => {
			console.log(err);
			if(this.isActive === true) {
				this.refreshProgressTimeout = setTimeout(() => this.refreshProgress(), 20000);
			}
		});
	}

	ngOnDestroy() {
		this.isActive = false;
		if(this.refreshProgressTimeout) {
			clearTimeout(this.refreshProgressTimeout);
		}
	}
}
