import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {uploadPhoto,uploadVideo} from '../api/media';
import {publishStory,type PublishStoryInput} from '../api/stories';
import {storyPublished} from './storyChanges';
export type UploadJob={id:string;ownerId:string;kind:'photo'|'video';mimeType:string;payload:Omit<PublishStoryInput,'mediaId'|'requestId'>;createdAt:string;status:'queued'|'uploading'|'publishing'|'failed'|'published';mediaId?:string;storyId?:string;error?:string};
const PREFIX='katkee.upload.v1.',ROOT=RNFS.DocumentDirectoryPath+'/katkee-outbox';
const inFlight=new Map<string,Promise<void>>();
const removing=new Set<string>();
const listeners=new Set<()=>void>();
let mutations:Promise<unknown>=Promise.resolve();
function serial<T>(work:()=>Promise<T>):Promise<T>{const result=mutations.then(work,work);mutations=result.catch(()=>undefined);return result;}
function validate(owner:string,id:string){if(!/^[a-f0-9-]{36}$/i.test(owner)||!/^[A-Za-z0-9_-]{16,100}$/.test(id))throw Error('Invalid upload identifier.');}
function key(owner:string,id:string){validate(owner,id);return PREFIX+owner+'.'+id;}
function file(owner:string,id:string){validate(owner,id);return ROOT+'/'+owner+'-'+id;}
function notify(){listeners.forEach(fn=>fn());}
export function subscribeUploads(fn:()=>void){listeners.add(fn);return ()=>{listeners.delete(fn);};}
async function save(job:UploadJob){await AsyncStorage.setItem(key(job.ownerId,job.id),JSON.stringify(job));notify();}
export async function listUploads(ownerId:string):Promise<UploadJob[]>{
 const keys=(await AsyncStorage.getAllKeys()).filter(k=>k.startsWith(PREFIX+ownerId+'.'));
 const rows=await AsyncStorage.multiGet(keys);
 return rows.flatMap(([,raw])=>{try{const job=JSON.parse(raw||'null') as UploadJob;if(!job||job.ownerId!==ownerId)return [];validate(ownerId,job.id);return [job];}catch{return [];}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export function enqueueUpload(ownerId:string,uri:string,kind:UploadJob['kind'],mimeType:string,payload:UploadJob['payload']):Promise<UploadJob>{return serial(async()=>{
 const existing=await listUploads(ownerId);if(existing.filter(j=>j.status!=='published').length>=10)throw Error('Finish or remove a pending upload before adding another.');
 // This is an idempotency key, not an authentication secret. It is scoped by authenticated owner server-side.
 const id='story_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+'_'+Math.random().toString(36).slice(2);
 const target=file(ownerId,id);
 await RNFS.mkdir(ROOT,{NSURLIsExcludedFromBackupKey:true});
 try{
  await RNFS.copyFile(uri.startsWith('file://')?decodeURI(uri.slice(7)):uri,target);
  const stat=await RNFS.stat(target);const size=Number(stat.size);
  if(size<=0||size>(kind==='photo'?25:200)*1024*1024)throw Error('This media is empty or exceeds the upload limit.');
  const job:UploadJob={id,ownerId,kind,mimeType,payload:JSON.parse(JSON.stringify(payload)),status:'queued',createdAt:new Date().toISOString()};
  await save(job);return job;
 }catch(e){await RNFS.unlink(target).catch(()=>undefined);throw e;}
});}
export function runUpload(ownerId:string,id:string,session:()=>{ownerId:string;token:string}|null):Promise<void>{
 const storageKey=key(ownerId,id),running=inFlight.get(storageKey);if(running)return running;
 if(removing.has(storageKey))return Promise.reject(Error('This upload is being removed.'));
 const work=Promise.resolve().then(async()=>{
  const raw=await AsyncStorage.getItem(storageKey);if(!raw)throw Error('Upload not found.');let job=JSON.parse(raw) as UploadJob;
  if(job.ownerId!==ownerId||job.id!==id)throw Error('Upload owner mismatch.');
  if(job.status==='published')return;
  const token=()=>{const current=session();if(!current||current.ownerId!==ownerId)throw Error('Sign in to resume this upload.');return current.token;};
  try{
   if(!job.mediaId){
    const currentToken=token();if(!await RNFS.exists(file(ownerId,id)))throw Error('Saved media is unavailable. Remove this upload and select the original again.');
    job={...job,status:'uploading',error:undefined};await save(job);
    const media=await (job.kind==='photo'?uploadPhoto:uploadVideo)('file://'+file(ownerId,id),job.mimeType,currentToken);
    job={...job,mediaId:media.id};await save(job);
   }
   const currentToken=token();job={...job,status:'publishing',error:undefined};await save(job);
   const result=await publishStory({...job.payload,mediaId:job.mediaId!,requestId:job.id},currentToken);
   job={...job,status:'published',storyId:result.story.id,error:undefined};await save(job);
   storyPublished();
   await RNFS.unlink(file(ownerId,id)).catch(()=>undefined);
  }catch(e){
   job={...job,status:'failed',error:e instanceof Error?e.message:'Upload failed. Try again.'};await save(job);throw e;
  }
 }).finally(()=>{inFlight.delete(storageKey);notify();});
 inFlight.set(storageKey,work);return work;
}
export function uploadRunning(ownerId:string,id:string){return inFlight.has(key(ownerId,id));}
export function removeUpload(ownerId:string,id:string):Promise<void>{return serial(async()=>{
 if(uploadRunning(ownerId,id))throw Error('Wait for this upload to finish before removing it.');
 const storageKey=key(ownerId,id);removing.add(storageKey);
 try{if(await RNFS.exists(file(ownerId,id)))await RNFS.unlink(file(ownerId,id));await AsyncStorage.removeItem(storageKey);notify();}finally{removing.delete(storageKey);}
});}
