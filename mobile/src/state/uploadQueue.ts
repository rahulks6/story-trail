import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {ApiError} from '../api/client';
import {abortUploadSession,completeUploadSession,createUploadSession,getUploadSession,PartUploadError,retryMediaProcessing,uploadPart,type UploadSessionResponse} from '../api/media';
import {deleteStory,getPublishRequest,publishStory,type PublishStoryInput} from '../api/stories';
import {base64ToBytes} from '../utils/base64';
import {storyPublished} from './storyChanges';
import {track} from '../analytics/analytics';

/**
 * The Story outbox. Each Story is copied into app storage, then:
 *   preparing -> uploading (resumable, part by part, straight to storage) -> publishing
 *   -> processing (server prepares the media and publishes it by itself) -> published
 * Any failure keeps the saved copy and the edits so "Retry" can continue where it
 * stopped: finished parts are never sent twice, and a temporary processing failure
 * is retried on the server without uploading again.
 */
export type UploadStatus='queued'|'preparing'|'uploading'|'processing'|'publishing'|'published'|'failed';
export type UploadJob={id:string;ownerId:string;kind:'photo'|'video';mimeType:string;payload:Omit<PublishStoryInput,'mediaId'|'requestId'>;createdAt:string;status:UploadStatus;
 /** 2 = resumable direct upload. Older outbox items (uploaded in one request) have no version. */
 uploadVersion?:2;
 /** A server-side effect made while processing the video (Boomerang). */
 effect?:'boomerang';mediaId?:string;storyId?:string;error?:string;
 /** For a processing failure: whether Retry can help (true) or the file itself is unusable (false). */
 retryable?:boolean;byteSize?:number;
 /** Stopped while the server was already processing it: deleted as soon as it posts. */
 cancelAfterPublish?:boolean;
 /** Failed only because the connection dropped: the outbox tries again by itself (autoResumeDue). */
 networkFailure?:boolean;autoRetries?:number;
 /** Date.now() of that failure, on this phone (not a server time). */
 failedAt?:number};
const PREFIX='katkee.upload.v1.',ROOT=RNFS.DocumentDirectoryPath+'/katkee-outbox';
const PART_ATTEMPTS=3,RETRY_DELAYS=[1000,3000];
const POLL_DELAYS=[1500,2000,3000,5000,8000,13000,15000];
const POLL_BUDGET_MS=10*60*1000;
/** Automatic retries of a Story that failed because the connection dropped, before it waits for Retry. */
export const AUTO_RETRY_LIMIT=5;
const AUTO_RETRY_DELAYS=[5000,15000,30000,60000,120000];
const inFlight=new Map<string,Promise<void>>();
const progress=new Map<string,number>();
const removing=new Set<string>();
/** Uploads being cancelled: the run stops at its next step and leaves nothing behind. */
const cancelling=new Set<string>();
class UploadCancelled extends Error{constructor(){super('Upload cancelled.');}}
function checkCancelled(storageKey:string){if(cancelling.has(storageKey))throw new UploadCancelled();}
const listeners=new Set<()=>void>();
let mutations:Promise<unknown>=Promise.resolve();
let lastProgressNotify=0;
function serial<T>(work:()=>Promise<T>):Promise<T>{const result=mutations.then(work,work);mutations=result.catch(()=>undefined);return result;}
function validate(owner:string,id:string){if(!/^[a-f0-9-]{36}$/i.test(owner)||!/^[A-Za-z0-9_-]{16,100}$/.test(id))throw Error('Invalid upload identifier.');}
function key(owner:string,id:string){validate(owner,id);return PREFIX+owner+'.'+id;}
function file(owner:string,id:string){validate(owner,id);return ROOT+'/'+owner+'-'+id;}
function notify(){listeners.forEach(fn=>fn());}
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export function subscribeUploads(fn:()=>void){listeners.add(fn);return ()=>{listeners.delete(fn);};}
/** 0..1 while bytes are being sent; undefined otherwise. Not persisted. */
export function uploadProgress(ownerId:string,id:string):number|undefined{return progress.get(key(ownerId,id));}
function setProgress(storageKey:string,value:number){progress.set(storageKey,Math.max(0,Math.min(1,value)));const now=Date.now();if(now-lastProgressNotify>250){lastProgressNotify=now;notify();}}
async function save(job:UploadJob){await AsyncStorage.setItem(key(job.ownerId,job.id),JSON.stringify(job));notify();}
export async function listUploads(ownerId:string):Promise<UploadJob[]>{
 const keys=(await AsyncStorage.getAllKeys()).filter(k=>k.startsWith(PREFIX+ownerId+'.'));
 const rows=Object.values(await AsyncStorage.getMany(keys));
 return rows.flatMap(raw=>{try{const job=JSON.parse(raw||'null') as UploadJob;if(!job||job.ownerId!==ownerId)return [];validate(ownerId,job.id);return [job];}catch{return [];}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export function enqueueUpload(ownerId:string,uri:string,kind:UploadJob['kind'],mimeType:string,payload:UploadJob['payload'],effect?:'boomerang'):Promise<UploadJob>{return serial(async()=>{
 const existing=await listUploads(ownerId);if(existing.filter(j=>j.status!=='published').length>=10)throw Error('Finish or remove a pending upload before adding another.');
 // This is an idempotency key, not an authentication secret. It is scoped by authenticated owner server-side.
 const id='story_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+'_'+Math.random().toString(36).slice(2);
 const target=file(ownerId,id);
 await RNFS.mkdir(ROOT,{NSURLIsExcludedFromBackupKey:true});
 try{
  await RNFS.copyFile(uri.startsWith('file://')?decodeURI(uri.slice(7)):uri,target);
  const stat=await RNFS.stat(target);const size=Number(stat.size);
  if(size<=0||size>(kind==='photo'?25:200)*1024*1024)throw Error('This media is empty or exceeds the upload limit.');
  const job:UploadJob={id,ownerId,kind,mimeType,payload:JSON.parse(JSON.stringify(payload)),status:'queued',createdAt:new Date().toISOString(),uploadVersion:2,byteSize:size,...(effect==='boomerang'&&kind==='video'?{effect}:{})};
  await save(job);return job;
 }catch(e){await RNFS.unlink(target).catch(()=>undefined);throw e;}
});}

/** Sends every part the server doesn't have yet, then completes the upload. */
async function sendBytes(job:UploadJob,path:string,storageKey:string,token:()=>string,persist:(next:UploadJob)=>Promise<UploadJob>):Promise<UploadJob>{
 const size=Number((await RNFS.stat(path)).size);
 // The Story filter travels with the upload: the server applies it while processing the media.
 let session:UploadSessionResponse=await createUploadSession({clientUploadId:job.id,kind:job.kind,mimeType:job.mimeType,byteSize:size,filter:job.payload.filter||'original',...(job.effect?{effect:job.effect}:{})},token());
 job=await persist({...job,mediaId:session.media.id,byteSize:size});
 for(let round=0;session.upload;round++){
  if(round>=4)throw Error('Upload could not be completed. Try again.');
  if(job.status!=='uploading')job=await persist({...job,status:'uploading'});
  const plan=session.upload;
  let sent=plan.parts.filter(p=>p.uploaded).reduce((n,p)=>n+p.byteLength,0);
  setProgress(storageKey,sent/size);
  let refresh=false;
  for(const part of plan.parts){
   if(part.uploaded||!part.url)continue;
   checkCancelled(storageKey);
   const chunk=base64ToBytes(await RNFS.read(path,part.byteLength,(part.partNumber-1)*plan.partSize,'base64'));
   if(chunk.byteLength!==part.byteLength)throw Error('The saved media changed. Remove this upload and choose the photo or video again.');
   for(let attempt=1;;attempt++){
    try{await uploadPart(part.url,chunk.buffer as ArrayBuffer,loaded=>setProgress(storageKey,(sent+loaded)/size));break;}
    catch(e){
     if(e instanceof PartUploadError&&e.urlExpired){refresh=true;break;}
     const transient=!(e instanceof PartUploadError)||e.status===0||e.status>=500;
     if(!transient||attempt>=PART_ATTEMPTS)throw e;
     await sleep(RETRY_DELAYS[attempt-1]??3000);
    }
   }
   if(refresh)break;
   sent+=part.byteLength;setProgress(storageKey,sent/size);
  }
  if(refresh){session=await getUploadSession(job.mediaId!,token());continue;}
  try{session={media:(await completeUploadSession(job.mediaId!,token())).media,upload:null};}
  catch(e){
   // 409: the server is missing parts (e.g. one was lost); fetch the plan and send them.
   if(e instanceof ApiError&&e.status===409){session=await getUploadSession(job.mediaId!,token());continue;}
   throw e;
  }
 }
 progress.delete(storageKey);
 return job;
}

/** A dropped connection, a timeout or a server hiccup: worth trying again by itself. */
export function isTransientError(e:unknown):boolean{
 if(e instanceof PartUploadError)return e.status===0||e.status>=500;
 if(e instanceof ApiError)return e.status===408||e.status===429||e.status>=500; // 0 is a cancel, not a failure
 return e instanceof TypeError; // fetch's "Network request failed"
}
/** Polls a publish request while the server processes the media. Returns the job as it stands. */
async function awaitPublish(job:UploadJob,token:()=>string,persist:(next:UploadJob)=>Promise<UploadJob>):Promise<UploadJob>{
 const started=Date.now();
 for(let i=0;Date.now()-started<POLL_BUDGET_MS;i++){
  await sleep(POLL_DELAYS[Math.min(i,POLL_DELAYS.length-1)]!);
  let publish:Awaited<ReturnType<typeof getPublishRequest>>['publish'];
  // The server keeps processing whatever the phone's connection does: keep checking.
  try{({publish}=await getPublishRequest(job.id,token()));}
  catch(e){if(isTransientError(e))continue;throw e;}
  if(publish.state==='published')return persist({...job,status:'published',storyId:publish.storyId??undefined,error:undefined,retryable:undefined});
  if(publish.state==='failed')return persist({...job,status:'failed',error:publish.error??'This media could not be processed.',retryable:publish.retryable});
 }
 return job; // still processing: the server publishes it by itself; the outbox checks again later
}

/** For Admin analytics: where an attempt failed and a coarse reason; never the message or the file. */
function failureOf(job:UploadJob,e:unknown):{stage:'upload'|'processing'|'publish';reason:'network'|'server'|'rejected'|'timeout'|'unknown'}|null{
 if(e instanceof ApiError&&e.status===0)return null; // cancelled (removed or signed out), not a failure
 if(e instanceof Error&&e.message==='Sign in to resume this upload.')return null;
 const mediaFailed=e instanceof ApiError&&e.details?.error==='media_failed';
 const stage=mediaFailed||job.status==='processing'?'processing':job.status==='publishing'?'publish':'upload';
 if(mediaFailed)return {stage,reason:(e as ApiError).details?.retryable===true?'server':'rejected'};
 const status=e instanceof ApiError||e instanceof PartUploadError?e.status:undefined;
 const reason=status===undefined?(e instanceof TypeError?'network':'unknown'):status===0?'network':status===408?'timeout':status>=500?'server':status>=400?'rejected':'unknown';
 return {stage,reason};
}
export function runUpload(ownerId:string,id:string,session:()=>{ownerId:string;token:string}|null):Promise<void>{
 const storageKey=key(ownerId,id),running=inFlight.get(storageKey);if(running)return running;
 if(removing.has(storageKey)||cancelling.has(storageKey))return Promise.reject(Error('This upload is being removed.'));
 const attemptStarted=Date.now();
 const work=Promise.resolve().then(async()=>{
  const raw=await AsyncStorage.getItem(storageKey);if(!raw)throw Error('Upload not found.');let job=JSON.parse(raw) as UploadJob;
  if(job.ownerId!==ownerId||job.id!==id)throw Error('Upload owner mismatch.');
  if(job.status==='published')return;
  const token=()=>{const current=session();if(!current||current.ownerId!==ownerId)throw Error('Sign in to resume this upload.');return current.token;};
  const persist=async(next:UploadJob)=>{
   // Keep a Stop that arrived while this was running.
   const current=JSON.parse((await AsyncStorage.getItem(storageKey))??'{}') as Partial<UploadJob>;
   if(current.cancelAfterPublish)next={...next,cancelAfterPublish:true};
   job=next;await save(next);return next;
  };
  try{
   const wasRetryableFailure=job.status==='failed'&&job.retryable===true&&!!job.mediaId;
   if(job.status!=='processing'){
    if(job.uploadVersion===2||!job.mediaId){
     if(!await RNFS.exists(file(ownerId,id)))throw Error('Saved media is unavailable. Remove this upload and select the original again.');
     job=await persist({...job,status:'preparing',error:undefined});
     job=await sendBytes(job,file(ownerId,id),storageKey,token,persist);
    }
    if(wasRetryableFailure){
     // A temporary processing failure: ask the server to process the stored file again.
     try{await retryMediaProcessing(job.mediaId!,token());}
     catch(e){if(!(e instanceof ApiError&&e.status===409))throw e;}
    }
    checkCancelled(storageKey);
    job=await persist({...job,status:'publishing',error:undefined,retryable:undefined});
    const result=await publishStory({...job.payload,mediaId:job.mediaId!,requestId:job.id},token());
    if('story' in result)job=await persist({...job,status:'published',storyId:result.story.id});
    else job=await persist({...job,status:'processing'});
   }
   if(job.status==='processing')job=await awaitPublish(job,token,persist);
   // The server reported a processing failure (no exception): counted like a thrown one.
   if(job.status==='failed')track('upload_failed',{mediaKind:job.kind,stage:'processing',reason:job.retryable===true?'server':'rejected'});
   if(job.status==='published'){
    // Stopped while processing: take it down straight away and leave nothing behind.
    if(job.cancelAfterPublish&&job.storyId){
     await deleteStory(job.storyId,token()).catch(()=>undefined);
     await RNFS.unlink(file(ownerId,id)).catch(()=>undefined);
     await AsyncStorage.removeItem(storageKey);progress.delete(storageKey);storyPublished();
     return;
    }
    if(job.networkFailure||job.autoRetries)job=await persist({...job,networkFailure:undefined,autoRetries:undefined,failedAt:undefined});
    track('upload_succeeded',{mediaKind:job.kind,durationMs:Math.min(3_600_000,Date.now()-attemptStarted)});
    storyPublished();
    await RNFS.unlink(file(ownerId,id)).catch(()=>undefined);
   }
  }catch(e){
   progress.delete(storageKey);
   if(e instanceof UploadCancelled)return;
   const failure=failureOf(job,e);if(failure)track('upload_failed',{mediaKind:job.kind,...failure});
   const transient=isTransientError(e);
   if(e instanceof ApiError&&e.details?.error==='media_failed'){
    await persist({...job,status:'failed',error:e.message,retryable:e.details.retryable===true,networkFailure:undefined});
   }else if(transient&&job.status==='processing'){
    // The server already has it and posts it by itself: a dropped connection doesn't fail it.
    await persist({...job,error:undefined});
   }else{
    await persist({...job,status:'failed',error:e instanceof Error?e.message:'Upload failed. Try again.',retryable:job.retryable,
     networkFailure:transient||undefined,failedAt:Date.now(),autoRetries:transient?(job.autoRetries??0)+(job.networkFailure?1:0):undefined});
   }
   throw e;
  }
 }).finally(()=>{inFlight.delete(storageKey);notify();});
 inFlight.set(storageKey,work);return work;
}

/**
 * Stops sharing a Story that hasn't posted yet, wherever it is: the upload stops at its next step,
 * the half-sent file is dropped on the server, and the saved copy is removed. Returns false once
 * it has already posted (delete the Story instead).
 */
export async function cancelUpload(ownerId:string,id:string,token:string|null):Promise<boolean>{
 const storageKey=key(ownerId,id);
 const raw=await AsyncStorage.getItem(storageKey);if(!raw)return true;
 const job=JSON.parse(raw) as UploadJob;
 if(job.status==='published')return false;
 // The server is finishing it and will post it by itself: delete it the moment it posts.
 if(job.status==='processing'){await save({...job,cancelAfterPublish:true});return true;}
 cancelling.add(storageKey);
 try{
  await inFlight.get(storageKey)?.catch(()=>undefined);
  const latest=JSON.parse((await AsyncStorage.getItem(storageKey))??raw) as UploadJob;
  if(latest.status==='published'||latest.status==='processing')return false;
  if(latest.mediaId&&token)await abortUploadSession(latest.mediaId,token).catch(()=>undefined);
  await removeUpload(ownerId,id);
  return true;
 }finally{cancelling.delete(storageKey);}
}
export function uploadRunning(ownerId:string,id:string){return inFlight.has(key(ownerId,id));}
/** Stopped part-way (the app was closed or put away mid-upload): continues where it stopped. */
export function wasInterrupted(job:UploadJob){return (job.status==='preparing'||job.status==='uploading'||job.status==='publishing')&&!uploadRunning(job.ownerId,job.id);}
/**
 * A Story that failed only because the connection dropped, and whose next automatic try is due
 * (backing off; after AUTO_RETRY_LIMIT tries it waits for Retry). `ignoreBackoff` on return to the app.
 */
export function autoResumeDue(job:UploadJob,now=Date.now(),ignoreBackoff=false):boolean{
 if(job.status!=='failed'||!job.networkFailure||uploadRunning(job.ownerId,job.id))return false;
 const tries=job.autoRetries??0;if(tries>=AUTO_RETRY_LIMIT)return false;
 if(ignoreBackoff)return true;
 const failedAt=typeof job.failedAt==='number'?job.failedAt:0;
 return now-failedAt>=AUTO_RETRY_DELAYS[Math.min(tries,AUTO_RETRY_DELAYS.length-1)]!;
}
/** When the next automatic try of a connection-failed Story is due, or null if none will be made. */
export function nextAutoResumeAt(job:UploadJob):number|null{
 if(job.status!=='failed'||!job.networkFailure)return null;
 const tries=job.autoRetries??0;if(tries>=AUTO_RETRY_LIMIT)return null;
 return (typeof job.failedAt==='number'?job.failedAt:0)+AUTO_RETRY_DELAYS[Math.min(tries,AUTO_RETRY_DELAYS.length-1)]!;
}
/** Waiting on the person: failed for good, or interrupted (not running). */
export function needsAttention(job:UploadJob){return (job.status==='failed'&&!autoResumeDue(job,Number.POSITIVE_INFINITY))||wasInterrupted(job);}
/** The saved copy of a photo being shared, for a thumbnail while it uploads. */
export function uploadPreviewUri(job:UploadJob):string|null{return job.kind==='photo'?'file://'+file(job.ownerId,job.id):null;}
/** A failure Retry can't fix: the file itself was rejected by processing. */
export function needsNewFile(job:UploadJob){return job.status==='failed'&&job.retryable===false;}
export function removeUpload(ownerId:string,id:string):Promise<void>{return serial(async()=>{
 if(uploadRunning(ownerId,id))throw Error('Wait for this upload to finish before removing it.');
 const storageKey=key(ownerId,id);removing.add(storageKey);
 try{if(await RNFS.exists(file(ownerId,id)))await RNFS.unlink(file(ownerId,id));await AsyncStorage.removeItem(storageKey);progress.delete(storageKey);notify();}finally{removing.delete(storageKey);}
});}
