import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { ResultsComponent } from './components/results/results.component';
import { ImportComponent } from './components/import/import.component';
import { SelectResultsComponent } from './components/select-results/select-results.component';

const defaultPath = '/import';

const routes: Routes = [
  {
    path: '',
    redirectTo: defaultPath,
    pathMatch: 'full'
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
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
