import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AwsLogsService } from 'src/app/services/aws-logs.service';
import { LocalStorageService } from 'src/app/services/localStorage.service';

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
	queryResultTimeout;

	hasErrors = false;
	hasErrorsTimeout;

	isActive = false;

	constructor(
		private logsService: AwsLogsService,
		private route: ActivatedRoute,
		private localStorageService: LocalStorageService
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
			console.log('checkIfErrors', log);
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
		if(importStatuses.hasOwnProperty(this.logStreamName)) {
			this.hasCheckedStatus = true;
			this.percentComplete = 100;
		} else {
			this.logsService.startProgressQuery(this.logStreamName)
			.then(log => {
				console.log('progress', log);
				this.queryId = log.queryId;
				if(this.isActive === true) {
					this.queryResultTimeout = setTimeout(() => this.waitForQueryResult(), 5000);
				}
			}).catch(error => {
				if(this.isActive === true) {
					this.refreshProgressTimeout = setTimeout(() => this.refreshProgress(), 5000);
				}
			});
		}
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
					this.hasCheckedStatus = true;
				}
				if(this.percentComplete < 100) {
					if(this.isActive === true) {
						this.queryResultTimeout = setTimeout(() => this.refreshProgress(), 5000);
					}
				} else {
					this.localStorageService.setStatusOfImport(this.logStreamName, 'Complete');
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
		if(this.hasErrorsTimeout) {
			clearTimeout(this.hasErrorsTimeout);
		}
	}

}
