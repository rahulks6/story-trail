const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function fixture(){
 const store=new Map(),files=new Map([['/original',1234]]);let uploads=0,publishes=0,failResponse=true,session={ownerId:owner,token:'private-token'},duringUpload;
 const storage={getAllKeys:async()=>[...store.keys()],multiGet:async keys=>keys.map(k=>[k,store.get(k)??null]),getItem:async k=>store.get(k)??null,setItem:async(k,v)=>store.set(k,v),removeItem:async k=>store.delete(k)};
 const native={DocumentDirectoryPath:'/private',mkdir:async()=>{},copyFile:async(src,dest)=>{if(!files.has(src))throw Error('missing');files.set(dest,files.get(src));},stat:async p=>({size:files.get(p)}),exists:async p=>files.has(p),unlink:async p=>files.delete(p)};
 const media={uploadPhoto:async()=>{uploads++;await Promise.resolve();duringUpload?.();return {id:'owned-media'};}};media.uploadVideo=media.uploadPhoto;
 const story={publishStory:async input=>{publishes++;assert.ok(input.requestId);if(failResponse){failResponse=false;throw Error('Response lost after server commit');}return {story:{id:'same-story'}};}};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../mobile/src/state/uploadQueue.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 function load(){const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:n=>({'@react-native-async-storage/async-storage':storage,'react-native-fs':native,'../api/media':media,'../api/stories':story,'./storyChanges':{storyPublished(){}}}[n])});return module.exports;}
 return {load,store,files,get uploads(){return uploads;},get publishes(){return publishes;},session:()=>session,logoutDuringUpload(){duringUpload=()=>{session=null;};},succeed(){failResponse=false;}};
}
test('retains media and request identity across restart, retries publish without uploading twice',async()=>{
 const f=fixture();let api=f.load();const job=await api.enqueueUpload(owner,'file:///original','photo','image/png',{caption:'saved',audience:'followers'});
 assert.equal((await api.listUploads(other)).length,0);assert.equal([...f.files.keys()].filter(k=>k.startsWith('/private/')).length,1);
 await assert.rejects(api.runUpload(owner,job.id,f.session),/Response lost/);
 api=f.load();const saved=(await api.listUploads(owner))[0];assert.equal(saved.mediaId,'owned-media');assert.equal(saved.payload.audience,'followers');
 await api.runUpload(owner,job.id,f.session);assert.equal(f.uploads,1);assert.equal(f.publishes,2);assert.equal((await api.listUploads(owner))[0].storyId,'same-story');
 assert.equal([...f.files.keys()].filter(k=>k.startsWith('/private/')).length,0);assert.ok(f.files.has('/original'));
 assert.ok(!JSON.stringify([...f.store.values()]).includes('private-token'));
});
test('double taps share one in-flight upload and publication',async()=>{
 const f=fixture();f.succeed();const api=f.load(),job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await Promise.all([api.runUpload(owner,job.id,f.session),api.runUpload(owner,job.id,f.session)]);assert.equal(f.uploads,1);assert.equal(f.publishes,1);
});
test('account change between upload and publish stops publication and preserves retry metadata',async()=>{
 const f=fixture();f.succeed();f.logoutDuringUpload();const api=f.load(),job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await assert.rejects(api.runUpload(owner,job.id,f.session),/Sign in/);assert.equal(f.publishes,0);assert.equal((await api.listUploads(owner))[0].mediaId,'owned-media');
});
test('removing a queued upload leaves the original file intact and rejects unsafe file identifiers',async()=>{
 const f=fixture(),api=f.load(),job=await api.enqueueUpload(owner,'/original','photo','image/png',{});
 await api.removeUpload(owner,job.id);assert.equal((await api.listUploads(owner)).length,0);assert.ok(f.files.has('/original'));
 await assert.rejects(api.removeUpload(owner,'../../escape'),/Invalid upload/);
});
