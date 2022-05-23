import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';


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
	private _bucketName;
	private _region;
	private _jobEndpoint;
	private _cancelEndpoint;
	private _logPrefix;

	constructor(private http: HttpClient) {
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

	public get bucketName() {
		return this._bucketName;
	}

	public get region() {
		return this._region;
	}

	public get jobEndpoint() {
		return this._jobEndpoint;
	}

	public get cancelEndpoint() {
		return this._cancelEndpoint;
	}

	public get logPrefix() {
		return this._logPrefix;
	}

	public async setOrigParams(oid:string, aid:string, tk:string, bu:string) {
		this._apiBasePath = 'https://preview.threekit.com/api';
		this._orgId = '23de016e-e813-4e8c-a417-583fb95e63c9';
		this._appId = 'c9c5fa53-9c25-4946-9560-117f3f9e71b6';
		this._threekitPublicToken = 'd7cb9823-5adf-46db-aa6c-dd89938d54cc';
		const data = await this.http.get<any>(this._apiBasePath+`/apps/${this._appId}?orgId=${this._orgId}&bearer_token=${this._threekitPublicToken}`).toPromise();
		console.log('response', data, this);
		this._awsAccessToken = data.configuration.at;
		this._awsSecretToken = data.configuration.st;
		this._threekitPrivateToken = data.configuration.pt;
		this._orgName = data.configuration.orgName;
		this._bucketName = data.configuration.bucket;
		this._region = data.configuration.region;
		this._jobEndpoint = data.configuration.jobEndpoint;
		this._cancelEndpoint = data.configuration.cancelEndpoint;
		this._logPrefix = data.configuration.logPrefix;
		return Promise.resolve();
	}
}
