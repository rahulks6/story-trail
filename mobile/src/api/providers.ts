import {apiGet,apiPost,type PublicUser,type TokenPair} from './client';
export interface ProviderSession {user:PublicUser;tokens:TokenPair}
export interface ProviderPending {onboardingRequired:true;proof:string;expiresIn:number}
export interface ProviderProof {proof:string;expiresIn:number}
export type ProviderResult=ProviderSession|ProviderPending|ProviderProof;
export interface AuthMethods {google:boolean;phone:boolean;countries:string[];codeLength:number}
export const methods=()=>apiGet<AuthMethods>('/api/v1/auth/methods');
export const google=(idToken:string,proofOnly=false)=>apiPost<ProviderResult>('/api/v1/auth/google',{idToken,proofOnly});
export const complete=(proof:string,username:string,displayName:string)=>apiPost<ProviderSession>('/api/v1/auth/provider/complete',{proof,username,displayName});
export interface PhoneChallenge {challenge:string;maskedDestination:string;resendAfter:number;expiresIn:number;codeLength:number}
export const requestPhone=(phone:string,country:string)=>apiPost<PhoneChallenge>('/api/v1/auth/phone/request',{phone,country});
export const verifyPhone=(challenge:string,code:string,proofOnly=false)=>apiPost<ProviderResult>('/api/v1/auth/phone/verify',{challenge,code,proofOnly});
