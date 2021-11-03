import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AwsLogsService } from 'src/app/services/aws-logs.service';
import { LocalStorageService } from 'src/app/services/localStorage.service';
import { AwsDbService } from 'src/app/services/aws-db.service';

@Component({
	selector: 'app-results',
	templateUrl: './results.component.html',
	styleUrls: ['./results.component.scss']
})
export class ResultsComponent implements OnInit {
	logStreamName: string;
	logEvents = [];
	errorsOnly = false;
	isLoading = false;
	isGettingNext = false;
	filters: {item: string, group: string, option: string} = {
		item: null,
		group: null,
		option: null
	};
	nextToken: string;

	queryId:string;
	hasCheckedStatus:boolean = false;
	percentComplete: number = 0;
	refreshProgressTimeout;

	hasErrors = false;
	hasErrorsTimeout;

	isActive = false;

	isCanceled = false;

	constructor(
		private logsService: AwsLogsService,
		private route: ActivatedRoute,
		private localStorageService: LocalStorageService,
		private dbService: AwsDbService
	) { }

	ngOnInit(): void {		
		this.route.params.subscribe(params => {
			this.isActive = true;
			this.logStreamName = params.logName;
			this.hasCheckedStatus = false;
			this.refreshLogs(false);
			this.refreshProgress();
			this.checkIfErrors();
		});
	}

	refreshLogs(useNextToken: boolean) {
		if (this.logStreamName) {
			if (useNextToken) {
				this.isGettingNext = this.logEvents.length !== 0;
				this.isLoading = this.logEvents.length === 0;
			} else {
				this.isLoading = true;
				this.nextToken = undefined;
			}
			this.logsService.getLogEvents(this.logStreamName, this.createFilterPattern(this.filters), this.nextToken)
			.then(log => {
				if (log) {
					let events;
					if (this.nextToken) {
						events = this.logEvents.concat(log.events);
					} else {
						events = log.events;
					}
					events.sort((a,b) => a.timestamp - b.timestamp);

					this.logEvents = events;
					this.nextToken = log.nextToken || undefined;

					if (this.nextToken && this.logEvents.length < 250) {
						if (this.logEvents.length === 0) {
							this.isGettingNext = false;
							this.isLoading = true;
						} else {
							this.isGettingNext = true;
							this.isLoading = false;
						}
						this.refreshLogs(true);
					} else {
						this.isGettingNext = false;
						this.isLoading = false;
					}
				}
			})
			.catch(err => {
				this.logEvents = [];
				this.isLoading = false;
				this.isGettingNext = false;
			});
		}
	}

	getEventTimestamp(event) {
		const datetime = new Date(event.timestamp);
		return datetime.toLocaleString();
	}

	getEventMessage(event) {
		return JSON.parse(event.message);
	}

	errorsOnlyClicked(e) {
		this.errorsOnly = e.target.checked;
	}
	
	updateFilters(e) {
		this.filters[e.type] = e.value;
		this.refreshLogs(false);
	}

	removeFilter(filterName: string) {
		this.filters[filterName] = null;
		this.refreshLogs(false);
	}

	createFilterPattern(filters) {
		let filterArray = Object.keys(filters).map(key => filters[key] ? `$.objectType = ${key} && $.objectId = "${filters[key]}"` : null).filter(f => f);
		if (this.errorsOnly) {
			filterArray.push('$.event = "error"');
		}
		return filterArray.length > 0 ? `{${filterArray.join(' && ')}}` : undefined;
	}
	get logGroupDisplayName(): string {
		if (this.logStreamName) {
			const nameArray = this.logStreamName.split('-');
			const timestamp = nameArray.length > 1 ? +nameArray.splice(-1) : undefined;
			const name = nameArray.join('-');
			return `${name} (${timestamp ? (new Date(timestamp)).toUTCString() : ''})`;
		}
		return '';
	}

	checkIfErrors() {
		let filterArray = [];
		filterArray.push('$.event = "error"');
		this.logsService.getLogEvents(this.logStreamName, filterArray.length > 0 ? `{${filterArray.join(' && ')}}` : undefined, undefined)
		.then(log => {
			if(log && log.events && log.events.length > 0) {
				this.hasErrors = true;
			} else {
				if(this.percentComplete < 100 && this.isActive === true) {
					this.hasErrorsTimeout = setTimeout(() => this.checkIfErrors(), 5000);
				}
			}
		}).catch(err => {
			console.log('error checking for errors', err);
			if(this.isActive === true) {
				this.hasErrorsTimeout = setTimeout(() => this.checkIfErrors(), 5000);
			}
		});
	}

	refreshProgress() {
		let importStatuses = this.localStorageService.getImportStatuses();
		if(importStatuses.hasOwnProperty(this.logStreamName) && importStatuses[this.logStreamName] === 'Complete') {
			this.hasCheckedStatus = true;
			this.percentComplete = 100;
		} else {
			this.dbService.getProgressForJob(this.logStreamName)
			.then(data => {
				if(data.length > 0) {
					let result = data[0];
					let total = 0;
					let stat = result.stat;
					if(stat === 'cancelled') {
						this.isCanceled = true;
					}
					if(result['total_items']) {
						total = parseInt(result['total_items']);
					}
					let numLines = null;
					if(result['count']) {
						numLines = parseInt(result['count']);
					}
					if(numLines === null) {
						numLines = 0;
					}
					if(total === 0) {
						this.percentComplete = 0;
					} else {
						this.percentComplete = (numLines/total)*100;
					}
					this.hasCheckedStatus = true;
				}
				if(this.percentComplete < 100) {
					if(this.isActive === true && !this.isCanceled) {
						this.refreshProgressTimeout = setTimeout(() => this.refreshProgress(), 20000);
					}
					if(this.isCanceled === true) {
						this.localStorageService.setStatusOfImport(this.logStreamName, 'Cancelled');
					}
				} else {
					this.localStorageService.setStatusOfImport(this.logStreamName, 'Complete');
				}
			}).catch(err => {
				console.log(err);
				if(this.isActive === true) {
					this.refreshProgressTimeout = setTimeout(() => this.refreshProgress(), 20000);
				}
			});
		}
	}

	ngOnDestroy() {
		this.isActive = false;
		if(this.refreshProgressTimeout) {
			clearTimeout(this.refreshProgressTimeout);
		}
		if(this.hasErrorsTimeout) {
			clearTimeout(this.hasErrorsTimeout);
		}
	}

}
