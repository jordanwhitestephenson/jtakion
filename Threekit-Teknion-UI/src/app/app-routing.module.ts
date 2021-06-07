import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { ResultsComponent } from './components/results/results.component';
import { ImportComponent } from './components/import/import.component';
import { SelectResultsComponent } from './components/select-results/select-results.component';
import { ParamsComponent } from './components/params/params.component';

const defaultPath = '/import';

const routes: Routes = [
  {
    path: '',
    //redirectTo: defaultPath,
	component: ParamsComponent,
    pathMatch: 'full'
  },
  {
    path: 'init/:publicToken',
    component: ParamsComponent
  },
  {
    path: 'import',
    component: ImportComponent
  },
  {
    path: 'results',
    children: [
      {
        path: '',
        component: SelectResultsComponent
      },{
        path: ':logName',
        component: ResultsComponent
      }
    ]
  },
  { path: '**', redirectTo: defaultPath, pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: false })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
