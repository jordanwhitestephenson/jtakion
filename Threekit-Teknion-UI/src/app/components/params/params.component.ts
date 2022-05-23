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

		this.paramsService.setOrigParams('', '', '', '').then(() => {
			this.router.navigate(['/import']);		
		}).catch(err => {
			console.error(err.message);
		});	
  }
}
