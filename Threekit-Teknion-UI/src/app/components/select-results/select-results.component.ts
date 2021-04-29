import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AwsLogsService } from 'src/app/services/aws-logs.service';

@Component({
  selector: 'app-select-results',
  templateUrl: './select-results.component.html',
  styleUrls: ['./select-results.component.scss']
})
export class SelectResultsComponent implements OnInit {
  @ViewChild('searchPrefixInput', { static: false }) searchPrefixInput: ElementRef;
  imports = [];
  nextToken: string;
  isLoading = false;
  isGettingNext = false;
  isDeleting = false;
  confirmDeleteImportName: string;
  confirmDeleteImportValue: string;
  showConfirmDeleteModal = false;

  constructor(
    private logsService: AwsLogsService,
    private router: Router,
    private route: ActivatedRoute) { }

  ngOnInit(): void {
    this.getLogGroups(false);
  }

  get searchPrefixValue(): string {
    if (this.searchPrefixInput && this.searchPrefixInput.nativeElement) {
      return this.searchPrefixInput.nativeElement.value || '';
    }
    return '';
  }

  getLogGroups(useNextToken) {
    if (useNextToken) {
      this.isGettingNext = this.imports.length !== 0;
      this.isLoading = this.imports.length === 0;
    } else {
      this.isLoading = true;
      this.nextToken = undefined;
    }
    this.logsService.getLogGroupsList(this.nextToken, this.searchPrefixInput ? this.searchPrefixInput.nativeElement.value : '')
    .then(res => {
      if (res.logGroups) {
        let imports = res.logGroups.map(grp => {
          const importName = grp.logGroupName.split('/').splice(-1)[0];
          const displayNameArray = importName.split('-');
          let timestamp = displayNameArray.length > 1 ? displayNameArray.splice(-1)[0] : undefined;
          const displayName = displayNameArray.join('-');
		  const compareValue = timestamp;
          timestamp = timestamp ? (new Date(+timestamp)).toLocaleString('default', {hour12: false, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'}) : undefined;
          return {name: displayName, value: importName, timestamp, compareValue};
        });
        if (this.nextToken) {
          imports = this.imports.concat(imports);
        }
        this.imports = imports;
		this.imports = this.imports.sort((a, b) => {
			if (a.compareValue > b.compareValue) {
			  return -1;
			}
			if (a.compareValue < b.compareValue) {
			  return 1;
			}
			// a must be equal to b
			return 0;
		  });
      }
      this.nextToken = res.nextToken || undefined;

      if (this.nextToken) {
        if (this.imports.length === 0) {
          this.isGettingNext = false;
          this.isLoading = true;
        } else {
          this.isGettingNext = true;
          this.isLoading = false;
        }
        this.getLogGroups(true);
      } else {
        this.isGettingNext = false;
        this.isLoading = false;
      }
    })
    .catch(err => {
      const error = err;
      this.isLoading = false;
      this.isGettingNext = false;
    });
  }

  selectImport(selectedImport: string) {
    this.router.navigate([selectedImport], {relativeTo: this.route});
  }

  deleteImport(importObject) {
    this.confirmDeleteImportName = importObject.name;
    this.confirmDeleteImportValue = importObject.value;
    this.showConfirmDeleteModal = true;
  }

  closeModal() {
    this.confirmDeleteImportName = undefined;
    this.confirmDeleteImportValue = undefined;
    this.showConfirmDeleteModal = false;
  }

  confirmDeleteImport() {
    if (this.confirmDeleteImportValue && this.confirmDeleteImportValue.length > 0) {
      this.isDeleting = true;
      this.logsService.deleteLogGroup(this.confirmDeleteImportValue)
      .then(res => {
        this.closeModal();
        this.getLogGroups(false);
      })
      .finally(() => {
        this.isDeleting = false;
      });
    }
  }

}
