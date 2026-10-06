const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const transpile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const queueCode=transpile('mobile/src/state/uploadQueue.ts'),base64Code=transpile('mobile/src/utils/base64.ts');
function loadModule(code,requireMap,globals={}){const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:n=>requireMap[n],Uint8Array,Int16Array,...globals});return module.exports;}
const base64=loadModule(base64Code,{});
class ApiError extends Error{constructor(status,message,fieldErrors,details){super(message);this.status=status;this.fieldErrors=fieldErrors;this.details=details;}}
class PartUploadError extends Error{constructor(status,message){super(message);this.status=status;}get urlExpired(){return this.status===403;}}

/**
 * A model of the server's resumable-upload protocol: parts are recorded per part
 * number, completion requires every part, and the outbox id makes "create" idempotent.
 */
function fixture(opts={}){
 const store=new Map(),bytes=Buffer.from(Array.from({length:opts.size??2500},(_,i)=>i%251)),files=new Map([['/original',bytes]]);
 const partSize=opts.partSize??1000,partCount=Math.ceil(bytes.length/partSize);
 const server={received:new Map(),completed:false,urlVersion:1,mediaStatus:'processing'};
 let session={ownerId:owner,token:'private-token'},duringUpload,failResponse=opts.failFirstPublish??true,storyChanges=0;const events=[];
 const calls={puts:[],publishes:0,creates:0,refreshes:0,retries:0,polls:0};
 const failPart=new Map(Object.entries(opts.failPart??{}).map(([k,v])=>[Number(k),v]));
 const plan=()=>server.completed?null:{partSize,partCount,urlsExpireAt:'',sessionExpiresAt:'',parts:Array.from({length:partCount},(_,i)=>{
  const n=i+1,len=Math.min(partSize,bytes.length-i*partSize),done=server.received.get(n)===len;
  return {partNumber:n,byteLength:len,uploaded:done,url:done?null:`https://storage.test/m/owned-media/original?partNumber=${n}&v=${server.urlVersion}`};})};
 const mediaRow=()=>({id:'owned-media',kind:'photo',status:server.completed?server.mediaStatus:'uploading'});
 const storage={getAllKeys:async()=>[...store.keys()],getMany:async keys=>Object.fromEntries(keys.map(k=>[k,store.get(k)??null])),getItem:async k=>store.get(k)??null,setItem:async(k,v)=>store.set(k,v),removeItem:async k=>store.delete(k)};
 const native={DocumentDirectoryPath:'/private',mkdir:async()=>{},copyFile:async(src,dest)=>{if(!files.has(src))throw Error('missing');files.set(dest,files.get(src));},
  stat:async p=>({size:files.get(p)?.length}),exists:async p=>files.has(p),unlink:async p=>files.delete(p),
  read:async(p,length,position,encoding)=>{assert.equal(encoding,'base64');return files.get(p).subarray(position,position+length).toString('base64');}};
 const media={PartUploadError,
  createUploadSession:async input=>{calls.creates++;assert.match(input.clientUploadId,/^story_/);assert.equal(input.byteSize,bytes.length);
   const answer={media:mediaRow(),upload:plan()};if(opts.expireUrlsAfterCreate)server.urlVersion++;return answer;},
  getUploadSession:async()=>{calls.refreshes++;return {media:mediaRow(),upload:plan()};},
  completeUploadSession:async()=>{for(const p of plan()?.parts??[])if(!p.uploaded)throw new ApiError(409,'Upload incomplete.');server.completed=true;return {media:mediaRow()};},
  uploadPart:async(url,body,onProgress)=>{
   const n=Number(/partNumber=(\d+)/.exec(url)[1]),v=Number(/v=(\d+)/.exec(url)[1]);calls.puts.push({n,v});duringUpload?.();
   if(v!==server.urlVersion)throw new PartUploadError(403,'expired');
   const failures=failPart.get(n);if(failures){failPart.set(n,failures===Infinity?Infinity:failures-1);throw new PartUploadError(failures===403?403:0,'network');}
   const expected=bytes.subarray((n-1)*partSize,(n-1)*partSize+partSize);assert.ok(Buffer.from(body).equals(expected),'part bytes match the file');
   server.received.set(n,body.byteLength);onProgress?.(body.byteLength);},
  retryMediaProcessing:async()=>{calls.retries++;server.mediaStatus='processing';return {media:mediaRow()};}};
 const pollAnswers=[...(opts.polls??[])];
 const story={
  publishStory:async input=>{calls.publishes++;assert.equal(input.mediaId,'owned-media');assert.ok(input.requestId);
   if(opts.publishError)throw opts.publishError;
   if(failResponse){failResponse=false;throw Error('Response lost after server commit');}
   return opts.processing?{publish:{state:'processing',requestId:input.requestId,mediaId:input.mediaId}}:{story:{id:'same-story'}};},
  getPublishRequest:async()=>{calls.polls++;return {publish:pollAnswers.shift()??{state:'processing'}};}};
 const fastTimers={setTimeout:fn=>setTimeout(fn,0),clearTimeout};
 function load(){return loadModule(queueCode,{'@react-native-async-storage/async-storage':storage,'@dr.pogodin/react-native-fs':native,'../api/client':{ApiError},'../api/media':media,'../api/stories':story,'../utils/base64':base64,'./storyChanges':{storyPublished(){storyChanges++;}},'../analytics/analytics':{track(name,properties){events.push({name,...properties});}}},fastTimers);}
 return {load,store,files,calls,server,partCount,events,session:()=>session,logoutDuringUpload(){duringUpload=()=>{session=null;};},get storyChanges(){return storyChanges;},
  succeedPublish(){failResponse=false;},setPolls(list){pollAnswers.splice(0,pollAnswers.length,...list);},setPublishError(e){opts.publishError=e;},
  clearFailures(){failPart.clear();}};
}

test('retains media and request identity across restart, retries publish without uploading twice',async()=>{
 const f=fixture();let api=f.load();const job=await api.enqueueUpload(owner,'file:///original','photo','image/png',{caption:'saved',audience:'followers'});
 assert.equal((await api.listUploads(other)).length,0);assert.equal([...f.files.keys()].filter(k=>k.startsWith('/private/')).length,1);
 await assert.rejects(api.runUpload(owner,job.id,f.session),/Response lost/);
 api=f.load();const saved=(await api.listUploads(owner))[0];assert.equal(saved.mediaId,'owned-media');assert.equal(saved.payload.audience,'followers');assert.equal(saved.status,'failed');
 await api.runUpload(owner,job.id,f.session);
 assert.equal(f.calls.puts.length,f.partCount,'every part sent exactly once');assert.equal(f.calls.publishes,2);
 assert.equal((await api.listUploads(owner))[0].storyId,'same-story');assert.equal(f.storyChanges,1);
 assert.equal([...f.files.keys()].filter(k=>k.startsWith('/private/')).length,0);assert.ok(f.files.has('/original'));
 assert.ok(!JSON.stringify([...f.store.values()]).includes('private-token'));
 // Admin analytics: one failed attempt (publish, reason unknown), then one success; no file names or captions.
 assert.deepEqual(f.events.map(e=>[e.name,e.stage,e.reason,e.mediaKind]),[['upload_failed','publish','unknown','photo'],['upload_succeeded',undefined,undefined,'photo']]);
 assert.ok(f.events[1].durationMs>=0&&!JSON.stringify(f.events).includes('saved')&&!JSON.stringify(f.events).includes('original'));
});
test('double taps share one in-flight upload and publication',async()=>{
 const f=fixture();f.succeedPublish();const api=f.load(),job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await Promise.all([api.runUpload(owner,job.id,f.session),api.runUpload(owner,job.id,f.session)]);
 assert.equal(f.calls.puts.length,f.partCount);assert.equal(f.calls.creates,1);assert.equal(f.calls.publishes,1);
});
test('account change between upload and publish stops publication and preserves retry metadata',async()=>{
 const f=fixture();f.succeedPublish();f.logoutDuringUpload();const api=f.load(),job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await assert.rejects(api.runUpload(owner,job.id,f.session),/Sign in/);assert.equal(f.calls.publishes,0);assert.equal((await api.listUploads(owner))[0].mediaId,'owned-media');
});
test('removing a queued upload leaves the original file intact and rejects unsafe file identifiers',async()=>{
 const f=fixture(),api=f.load(),job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await api.removeUpload(owner,job.id);assert.equal((await api.listUploads(owner)).length,0);assert.ok(f.files.has('/original'));
 await assert.rejects(api.removeUpload(owner,'../../escape'),/Invalid upload/);
});
test('resumes an interrupted upload without re-sending finished parts',async()=>{
 const f=fixture({failPart:{2:Infinity}});f.succeedPublish();let api=f.load();const job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await assert.rejects(api.runUpload(owner,job.id,f.session),/network/);
 assert.deepEqual(f.calls.puts.map(p=>p.n),[1,2,2,2],'part 2 tried three times');assert.equal((await api.listUploads(owner))[0].status,'failed');
 f.clearFailures();api=f.load();await api.runUpload(owner,job.id,f.session);
 assert.deepEqual(f.calls.puts.map(p=>p.n),[1,2,2,2,2,3],'only the missing parts on resume');assert.equal((await api.listUploads(owner))[0].status,'published');
});
test('fetches fresh part URLs when a signed URL has expired',async()=>{
 const f=fixture({expireUrlsAfterCreate:true});f.succeedPublish();const api=f.load(),job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await api.runUpload(owner,job.id,f.session); // the first plan's URLs are stale by the time they're used
 assert.equal(f.calls.refreshes,1);assert.deepEqual(f.calls.puts.map(p=>p.v),[1,...Array(f.partCount).fill(2)]);
 assert.equal((await api.listUploads(owner))[0].status,'published');
});
test('waits while the server processes the media, then reports the published Story',async()=>{
 const f=fixture({processing:true,polls:[{state:'processing'},{state:'published',storyId:'later-story'}]});f.succeedPublish();
 const api=f.load(),job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await api.runUpload(owner,job.id,f.session);
 const saved=(await api.listUploads(owner))[0];assert.deepEqual([saved.status,saved.storyId],['published','later-story']);
 assert.equal(f.calls.polls,2);assert.equal(f.storyChanges,1);assert.equal(f.files.has(`/private/katkee-outbox/${owner}-${job.id}`),false);
});
test('a file the server rejects fails with its reason and asks for a new file instead of a retry',async()=>{
 const f=fixture({publishError:new ApiError(422,'Videos can be up to 60 seconds. Trim it and try again.',undefined,{error:'media_failed',retryable:false})});
 const api=f.load(),job=await api.enqueueUpload(owner,'/original','video','video/mp4',{});
 await assert.rejects(api.runUpload(owner,job.id,f.session),/60 seconds/);
 const saved=(await api.listUploads(owner))[0];assert.deepEqual([saved.status,saved.retryable],['failed',false]);assert.equal(api.needsNewFile(saved),true);
 assert.deepEqual(f.events,[{name:'upload_failed',mediaKind:'video',stage:'processing',reason:'rejected'}]);
});
test('a temporary processing failure is retried on the server without uploading again',async()=>{
 const f=fixture({processing:true,polls:[{state:'failed',error:"We couldn't process this media. Try again.",retryable:true}]});f.succeedPublish();
 let api=f.load();const job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await api.runUpload(owner,job.id,f.session);
 let saved=(await api.listUploads(owner))[0];assert.deepEqual([saved.status,saved.retryable],['failed',true]);assert.equal(api.needsNewFile(saved),false);
 const sent=f.calls.puts.length;f.setPolls([{state:'published',storyId:'retried-story'}]);api=f.load();
 await api.runUpload(owner,job.id,f.session);
 saved=(await api.listUploads(owner))[0];assert.deepEqual([saved.status,saved.storyId],['published','retried-story']);
 assert.equal(f.calls.retries,1);assert.equal(f.calls.puts.length,sent,'nothing re-uploaded');
 assert.deepEqual(f.events.map(e=>[e.name,e.stage??null,e.reason??null]),[['upload_failed','processing','server'],['upload_succeeded',null,null]]);
});
test('base64 decoding matches Node for every padding case',()=>{
 for(const n of [0,1,2,3,4,255,1000]){const b=Buffer.from(Array.from({length:n},(_,i)=>(i*37)%256));assert.ok(Buffer.from(base64.base64ToBytes(b.toString('base64'))).equals(b),String(n));}
 assert.throws(()=>base64.base64ToBytes('abc'),/length/);assert.throws(()=>base64.base64ToBytes('ab*d'),/character/);
});
