import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ParamsService } from 'src/app/services/params.service';

@Component({
  selector: 'app-params',
  templateUrl: './params.component.html',
  styleUrls: ['./params.component.scss']
})
export class ParamsComponent implements OnInit {

  constructor(private route: ActivatedRoute, private router: Router, private paramsService: ParamsService) { }

  ngOnInit(): void {
	  console.log(this.route.snapshot.queryParamMap);
	  console.log(this.route.snapshot.paramMap);
	  if(this.route.snapshot.queryParamMap.has('orgId') && this.route.snapshot.queryParamMap.has('appid') && this.route.snapshot.paramMap.has('publicToken')) {
		this.paramsService.setOrigParams(this.route.snapshot.queryParamMap.get('orgId'), this.route.snapshot.queryParamMap.get('appid'), this.route.snapshot.paramMap.get('publicToken')).then(() => {
			this.router.navigate(['/import']);		
		}).catch(err => {
			console.error(err.message);
		});	
	  } else {
		console.error('Invalid parameters passed to application.');
	  }
  }
}
