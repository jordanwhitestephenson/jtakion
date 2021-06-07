import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from './../../environments/environment';
import { Observable } from 'rxjs';


@Injectable({
	providedIn: 'root'
})
export class ParamsService {
	private _orgId:string;
	private _appId:string;
	private _awsAccessToken:string;
	private _awsSecretToken:string;
	private _apiBasePath:string;
	private _threekitPublicToken;
	private _threekitPrivateToken;
	private _orgName;

	constructor(private http: HttpClient) { 
		this._apiBasePath = environment.baseUrl;
	}

	public get orgId() {
        return this._orgId;
    }

	public get appId() {
        return this._appId;
    }

	public get awsAccessToken() {
        return this._awsAccessToken;
    }

	public get awsSecretToken() {
        return this._awsSecretToken;
    }

	public get apiBasePath() {
        return this._apiBasePath;
    }

	public get threekitPublicToken() {
        return this._threekitPublicToken;
    }

	public get threekitPrivateToken() {
		return this._threekitPrivateToken;
	}

	public get orgName() {
		return this._orgName;
	}

	public async setOrigParams(oid:string, aid:string, tk:string) {
		this._orgId = oid;
		this._appId = aid;
		this._threekitPublicToken = tk;
		const data = await this.http.get<any>(this._apiBasePath+`/apps/${this._appId}?orgId=${this._orgId}&bearer_token=${this._threekitPublicToken}`).toPromise();
		console.log('response', data, this);
		this._awsAccessToken = data.configuration.at;
		this._awsSecretToken = data.configuration.st;
		this._threekitPrivateToken = data.configuration.pt;
		this._orgName = data.configuration.orgName;
		return Promise.resolve();
	}
}