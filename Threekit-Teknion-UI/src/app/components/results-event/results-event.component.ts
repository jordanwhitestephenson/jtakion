import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

@Component({
  selector: 'app-results-event',
  templateUrl: './results-event.component.html',
  styleUrls: ['./results-event.component.scss']
})
export class ResultsEventComponent implements OnInit {
  @Input() message;
  @Input() timestamp;
  @Output() addFilter: EventEmitter<{type: string, value: string}> = new EventEmitter<{type: string, value: string}>();

  constructor() { }

  ngOnInit(): void {
    //console.log('Init');
  }

  envs = {
	  'dev': 'Develop',
	  'demo': 'Demo',
	  'default': 'Staging',
	  'prod': 'Production'
  };

  parseEnvironment() {
	  //let envLabel = this.envs[this.message.IMPORT_ENVIRONMENT];
	  let envLabel = this.message.IMPORT_ENVIRONMENT;
	  return `Importing to environment: ${envLabel}`;
  }

  parseEvent() {
    if (this.message) {
      switch(this.message.event) {
        case 'parse':
          return 'Parsed';
        case 'enqueue-processItem':
          return `Enqueued to processItem queue`;
        case 'dequeue-processItem':
          return `Dequeued from processItem queue`;
        case 'enqueue-processMissingReferences':
          return `Enqueued to processMissingReferences queue`;
        case 'dequeue-processMissingReferences':
          return `Dequeued from processMissingReferences queue`;
        case 'needsReferences':
          return 'Needs References';
        case 'checkingItemGroups':
          return 'Checking Groups';
        case 'checkingOptionSubGroups':
          return 'Checking Option Sub-Groups';
        case 'creatingItem':
          return 'Creating Item';
        case 'createdItem':
          return 'Item Created';
        case 'creatingModel':
          return 'Creating Item Model';
        case 'createdModel':
          return 'Item Model Created';
        case 'creatingOption':
          return 'Creating Option';
        case 'createdOption':
          return 'Item Option Created';
        case 'queryingMaterial':
          return 'Querying Material';
        case 'queriedMaterialFound':
          return 'Queried Material Found';
        case 'queriedMaterialNotFound':
          return 'Queried Material Not Found';
        case 'queryingMaterialImage':
          return 'Querying Material Image';
        case 'queriedMaterialImageFound':
          return 'Queried Material Image Found';
        case 'queriedMaterialImageNotFound':
          return 'Queried Material Image Not Found';
        case 'uploadingMaterialImportZip':
          return 'Uploading Material Import Zip';
        case 'uploadedMaterialImportZip':
          return 'Uploaded Material Import Zip';
        case 'startingMaterialImportJob':
          return 'Starting Material Import Job';
        case 'startedMaterialImportJob':
          return 'Started Material Import Job';
        case 'queryingMaterialImportJob':
          return 'Querying Material Import Job';
        case 'queriedMaterialImportJob':
          return 'Queried Material Import Job';
        case 'queryingSubGroups':
          return 'Querying Sub-Groups';
        case 'queriedSubGroups':
          return 'Queried Sub-Groups ';
        case 'queryingItemGroups':
          return 'Querying Item Groups';
        case 'queriedItemGroups':
          return 'Queried Item Groups ';
        case 'queryingGroup':
          return 'Querying Group';
        case 'queriedGroup':
          return 'Queried Group ';
		case 'enqueue-processReferences':
			return 'Enqueued to '+this.message.queueName+' queue';
		case 'dequeue-processReferences':
			return 'Dequeued from itemsNeedingAssets queue';
		case 'translations-added':
			return 'Translations loaded successfully';
		case 'notAllGroupOptionsComplete':
			return 'Not all group options are complete. Retry in 30 seconds.';
        default:
			console.log('unknown event',this.message);
          return 'Unknown Event';
      }
    }
  }

  parseOptionsCount() {
    return this.message.optionsCount ? `with ${this.message.optionsCount} options` : '';
  }

  parseAdditionalInfo() {
    let info = '';
    if (this.message.jobStatus) {
      info += ` - JobStatus is ${this.message.jobStatus}`;
    }
    if (this.message.count != null) {
      info += ` - ${this.message.count || 0} ${this.message.objectType === 'option' ? 'sub-groups': this.message.objectType === 'item' ? 'groups' : 'options'} found`;
    }
    if (this.message.groupResults) {
      const groupResults = Object.keys(this.message.groupResults) || [];
      if (groupResults.length > 0) {
        const foundGroupResults = groupResults.map(key => this.message.groupResults[key]).filter(grp => grp);
        info += ` - ${foundGroupResults.length} of ${groupResults.length} group results found`;
      }
    }
    if (this.message.subGroupResults) {
      const subGroupResults = Object.keys(this.message.subGroupResults) || [];
      if (subGroupResults.length > 0) {
        const foundSubGroupResults = subGroupResults.map(key => this.message.subGroupResults[key]).filter(grp => grp);
        info += ` - ${foundSubGroupResults.length} of ${subGroupResults.length} sub-group results found`;
      }
    }
    if (this.message.missing && this.message.missing.length > 0) {
      info += ` is missing ${this.message.missing.join(', ')}`;
    }
    if (this.message.attempts) {
      info += ` after ${this.message.attempts || 0} attempts`;
    }
	if(this.message.headers) {
		info += ` headers: ${this.message.headers}`;
	}
	if(this.message.status) {
		info += ` status: ${this.message.status}`;
	}
	if(this.message.data) {
		info += ` data: ${this.message.data}`;
	}
	if(this.message.request) {
		info += ` request: ${this.message.request}`;
	}
	if(this.message.message) {
		info += ` message: ${this.message.message}`;
	}
	if(this.message.url) {
		info += ` url: ${this.message.url}`;
	}
	if(this.message.body) {
		info += ` body: ${this.message.body}`;
	}
	if(this.message.errorStatus) {
		info += ` status: ${this.message.errorStatus}`;
	}
	if(this.message.errorData) {
		if(this.message.errorData.message) {
			info += ` message: ${this.message.errorData.message}`;
		}
		if(this.message.errorData.statuscode) {
			info += ` statuscode: ${this.message.errorData.statuscode}`;
		}
		if(!this.message.errorData.message && !this.message.errorData.statuscode) {
			info += ` error response: ${this.message.errorData}`;
		}
	}
	if(this.message.numberRetries) {
		info += ` number of retries: ${this.message.numberRetries}`;
	}
	if(this.message.key) {
		info += ` key: ${this.message.key}`;
	}
	if(this.message.priceZone) {
		info += ` - price zone: ${this.message.priceZone} not found in XML.`;
	}
	if(this.message.missingGroup) {
		info += ` - group ${this.message.missingGroup} not found in XML.`;
	}
	if(this.message.missingImage) {
		info += ` - image ${this.message.missingImage} not found in XML.`;
	}
	if(this.message.missingSubGroup) {
		info += ` - sub group ${this.message.missingSubGroup} not found in XML.`;
	}
	if(this.message.error) {
		info += ` - ${this.message.error}`;
	}
	
    return info;
  }

  parseError() {
    if (this.message) {
      switch(this.message.errorSource) {
        case 'creatingItem':
          return 'Error Creating Item';
        case 'creatingOption':
          return 'Error Creating Option';
        case 'referencesNotFound':
          return 'Error Finding References';
        case 'createOrGetMaterial':
          return 'Error Getting Material';
		case 'failedApiCall':
			return 'Failed API Call';
		case 'noResponseApiCall':
			return 'No response from API Call';
		case 'unknownErrorApiCall':
			return 'Error making API Call';
		case 'itemFailedGettingAssets':
			return 'Failed to get assets for item';
		case 'translation':
			return 'Error adding translations';
		case 'pricebook':
			return 'Error adding pricebook';
		case 'currencyCodeMap':
			return 'Error getting currency code map data from S3';
		case 'allPricebooks':
			return 'Error getting all pricebooks from the org';
		case 'priceZoneNotFound':
			return 'Price zone not found';
		case 'itemGroupMissing':
			return 'Item Group not found for Item';
		case 'optionImageMissing':
			return 'Option image not found';
		case 'optionSubgroupMissing':
			return 'Subgroup missing for option';
		case 'parseErrors':
			return 'Errors found parsing XML.  Check the error logs.';
		case 'parse':
			return 'Unexpected Error when parsing XML. Check the XML file format.';
        default:
          return 'Error';
      }
    }
  }

  emitAddFilter(type, value) {
    this.addFilter.emit({type, value});
  }
}
