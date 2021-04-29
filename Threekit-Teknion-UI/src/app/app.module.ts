import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { ImportComponent } from './components/import/import.component';
import { AppRoutingModule } from './app-routing.module';
import { ResultsComponent } from './components/results/results.component';
import { DragAndDropDirective } from './directives/drag-and-drop.directive';
import { AmplifyUIAngularModule } from '@aws-amplify/ui-angular';
import { Amplify } from 'aws-amplify';
import awsconfig from '../aws-exports';
import { HeaderComponent } from './components/header/header.component';
import { SelectResultsComponent } from './components/select-results/select-results.component';
import { ResultsEventComponent } from './components/results-event/results-event.component';
import { SelectResultsItemComponent } from './components/select-results-item/select-results-item.component';

Amplify.configure(awsconfig);

@NgModule({
  declarations: [
    AppComponent,
    ImportComponent,
    ResultsComponent,
    SelectResultsComponent,
    DragAndDropDirective,
    HeaderComponent,
    ResultsEventComponent,
    SelectResultsItemComponent
  ],
  imports: [
    AppRoutingModule,
    BrowserModule,
    AmplifyUIAngularModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
