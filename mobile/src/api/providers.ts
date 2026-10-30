import {apiGet,apiPost,type PublicUser,type TokenPair} from './client';
export interface ProviderSession {user:PublicUser;tokens:TokenPair}
export interface ProviderPending {onboardingRequired:true;proof:string;expiresIn:number}
export interface ProviderProof {proof:string;expiresIn:number}
export type ProviderResult=ProviderSession|ProviderPending|ProviderProof;
/** `apple` is missing from servers older than Sign in with Apple. */
export interface AuthMethods {google:boolean;apple?:boolean;phone:boolean;countries:string[];codeLength:number}
export const methods=()=>apiGet<AuthMethods>('/api/v1/auth/methods');
export const google=(idToken:string,proofOnly=false)=>apiPost<ProviderResult>('/api/v1/auth/google',{idToken,proofOnly});
/** A single-use nonce for Apple to sign into its identity token (backend/src/modules/auth/apple.ts). */
export const appleNonce=()=>apiPost<{nonce:string;expiresIn:number}>('/api/v1/auth/apple/nonce',{});
export const apple=(identityToken:string,authorizationCode:string,proofOnly=false)=>apiPost<ProviderResult>('/api/v1/auth/apple',{identityToken,authorizationCode,proofOnly});
/** Finishes a new Google, Apple or phone account; birthDate is YYYY-MM-DD (utils/birthDate.ts). */
export const complete=(proof:string,username:string,displayName:string,birthDate:string)=>apiPost<ProviderSession>('/api/v1/auth/provider/complete',{proof,username,displayName,birthDate});
export interface PhoneChallenge {challenge:string;maskedDestination:string;resendAfter:number;expiresIn:number;codeLength:number}
export const requestPhone=(phone:string,country:string)=>apiPost<PhoneChallenge>('/api/v1/auth/phone/request',{phone,country});
export const verifyPhone=(challenge:string,code:string,proofOnly=false)=>apiPost<ProviderResult>('/api/v1/auth/phone/verify',{challenge,code,proofOnly});
