import {OAuth2Client} from 'google-auth-library';
import {parsePhoneNumberFromString, type CountryCode} from 'libphonenumber-js/max';
import {HttpError} from '../../http/errors';
export const providerConfig={
 googleEnabled:process.env.GOOGLE_AUTH_ENABLED==='true',
 googleAudiences:(process.env.GOOGLE_CLIENT_IDS??'').split(',').map(s=>s.trim()).filter(Boolean),
 phoneEnabled:process.env.PHONE_AUTH_ENABLED==='true',
 countries:(process.env.PHONE_AUTH_COUNTRIES??'').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean),
 phoneSecret:process.env.PHONE_IDENTITY_SECRET??'',
 account:process.env.TWILIO_ACCOUNT_SID??'',token:process.env.TWILIO_AUTH_TOKEN??'',service:process.env.TWILIO_VERIFY_SERVICE_SID??'',
 codeLength:Number(process.env.PHONE_OTP_CODE_LENGTH??6), dailyLimit:Number(process.env.PHONE_OTP_DAILY_LIMIT??100),
};
if(providerConfig.googleEnabled&&!providerConfig.googleAudiences.length)throw Error('Google sign-in requires configured backend client IDs.');
if(providerConfig.phoneEnabled&&(!providerConfig.countries.length||providerConfig.phoneSecret.length<32||!/^AC[a-f0-9]{32}$/i.test(providerConfig.account)||!/^VA[a-f0-9]{32}$/i.test(providerConfig.service)||!providerConfig.token||!Number.isInteger(providerConfig.codeLength)||providerConfig.codeLength<4||providerConfig.codeLength>10||!Number.isInteger(providerConfig.dailyLimit)||providerConfig.dailyLimit<1||providerConfig.dailyLimit>10000))throw Error('Phone authentication provider configuration is incomplete.');
export interface VerifiedGoogle {subject:string;email:string|null;displayName:string}
export interface ProviderGateway {
 google(idToken:string):Promise<VerifiedGoogle>;
 sendPhone(phone:string):Promise<string>;
 checkPhone(sid:string,code:string):Promise<boolean>;
}
const google=new OAuth2Client({transporterOptions:{timeout:5000}});
async function twilio(resource:string,body:Record<string,string>):Promise<Record<string,unknown>> {
 let response:Response;
 try {response=await fetch(`https://verify.twilio.com/v2/Services/${providerConfig.service}/${resource}`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(providerConfig.account+':'+providerConfig.token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(7000)});}catch{throw new HttpError(503,'Phone verification is unavailable. Try again later.');}
 if(!response.ok){if(response.status===404)return {status:'expired'};throw new HttpError(503,'Phone verification is unavailable. Try again later.');}
 return await response.json() as Record<string,unknown>;
}
export const liveProviders:ProviderGateway={
 async google(idToken){
  try {
   const ticket=await google.verifyIdToken({idToken,audience:providerConfig.googleAudiences});const p=ticket.getPayload();
   if(!p?.sub||!['accounts.google.com','https://accounts.google.com'].includes(p.iss))throw Error('Invalid identity');
   return {subject:p.sub,email:p.email_verified&&p.email?p.email:null,displayName:p.name?.slice(0,60)??''};
  }catch{throw new HttpError(401,'Google sign-in could not be verified. Try again.');}
 },
 async sendPhone(phone){const data=await twilio('Verifications',{To:phone,Channel:'sms'});if(typeof data.sid!=='string'||data.status!=='pending')throw new HttpError(503,'Unable to send a verification code.');return data.sid;},
 async checkPhone(sid,code){const data=await twilio('VerificationCheck',{VerificationSid:sid,Code:code});return data.status==='approved';},
};
export function normalizePhone(value:unknown,country:unknown):string {
 if(typeof value!=='string'||value.length>30||typeof country!=='string'||!providerConfig.countries.includes(country.toUpperCase()))throw new HttpError(422,'Choose a supported country and valid phone number.');
 const number=parsePhoneNumberFromString(value,country.toUpperCase() as CountryCode);
 if(!number?.isValid()||number.country!==country.toUpperCase())throw new HttpError(422,'Enter a valid mobile phone number.');
 return number.number;
}
