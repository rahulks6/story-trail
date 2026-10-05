const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../backend/node_modules/typescript');
const root=path.resolve(__dirname,'..');
function load(file,mocks={}) {
 const filename=path.join(root,file),module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(name in mocks)return mocks[name];throw Error('Unexpected '+name);},console},{filename});
 return module.exports;
}
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
class DatabaseError extends Error {constructor(detail){super(detail);this.detail=detail;}}
test('draft restore, count and deletion are isolated across accounts and legacy keys',async()=>{
 const data=new Map(),storage={getItem:async k=>data.get(k)??null,setItem:async(k,v)=>data.set(k,v),removeItem:async k=>data.delete(k),getAllKeys:async()=>[...data.keys()],removeMany:async keys=>keys.forEach(k=>data.delete(k))};
 const validator=load('mobile/src/state/validateSavedDraft.ts');
 const d=load('mobile/src/state/draftStorage.ts',{'@react-native-async-storage/async-storage':{default:storage},'./validateSavedDraft':validator});
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',uri='file:///same.jpg';
 data.set('katkee.draft.'+uri,JSON.stringify({draft:{caption:'legacy'}}));
 assert.equal(await d.loadPendingDraft(a,uri),null);
 const saved=caption=>({audience:'public',mimeType:'image/jpeg',savedAt:'2026-10-03T00:00:00Z',draft:{sourceMedia:{uri,kind:'photo',width:null,height:null},filter:'Original',overlays:[],drawing:[],caption,audioMuted:false,crop:{zoom:1,offsetX:0,offsetY:0}}});
 await d.savePendingDraft(a,uri,saved('A'));await d.savePendingDraft(b,uri,saved('B'));
 assert.equal((await d.loadPendingDraft(a,uri)).draft.caption,'A');assert.equal((await d.loadPendingDraft(b,uri)).draft.caption,'B');
 assert.equal(await d.countPendingDrafts(a),1);await d.clearAllPendingDrafts(a);assert.equal(await d.countPendingDrafts(a),0);assert.equal(await d.countPendingDrafts(b),1);
});
test('corrupted and mismatched saved drafts cannot enter the editor',()=>{
 const {isSavedDraft}=load('mobile/src/state/validateSavedDraft.ts');
 const good={audience:'public',mimeType:'image/jpeg',savedAt:'2026-10-03T00:00:00Z',draft:{sourceMedia:{uri:'file:///photo.jpg',kind:'photo',width:null,height:null},filter:'Original',overlays:[],drawing:[],caption:'hello',audioMuted:false,crop:{zoom:1,offsetX:0,offsetY:0}}};
 assert.equal(isSavedDraft(good,'file:///photo.jpg'),true);
 assert.equal(isSavedDraft(good,'file:///other.jpg'),false);
 for(const broken of [null,{}, {...good,draft:{caption:'missing fields'}}, {...good,draft:{...good.draft,overlays:[{type:'text',properties:null}]}}, {...good,draft:{...good.draft,drawing:[{points:[null]}]}}, {...good,draft:{...good.draft,crop:{zoom:NaN,offsetX:0,offsetY:0}}}])assert.equal(isSavedDraft(broken,'file:///photo.jpg'),false);
});
function service({media,taken=false,failure}={}) {
 const writes=[];
 const s=load('backend/src/modules/users/profiles.service.ts',{
  '../../http/errors':{HttpError},'../../db/psql':{DatabaseError},
  '../users/users.repository':{findUserById:async()=>({id:'owner',username:'old'}),usernameTaken:async()=>taken,setProfile:async(id,input)=>{if(failure)throw failure;writes.push({id,input});return input;}},
  '../media/media.repository':{findMediaById:async(id,excludeModerated)=>{assert.equal(excludeModerated,true);return media;}},
  '../social/social.repository':{},'../recommendations/events.repository':{},'../stories/stories.repository':{},'../stories/stories.service':{},'../auth/refresh-tokens.repository':{},'../auth/password':{}
 });return {s,writes};
}
test('avatar ownership, kind and readiness failures never write profile fields',async()=>{
 for(const media of [null,{ownerId:'other',kind:'photo',status:'ready'},{ownerId:'owner',kind:'video',status:'ready'},{ownerId:'owner',kind:'photo',status:'processing'}]) {
  const {s,writes}=service({media});await assert.rejects(s.updateMyProfile('owner',{avatarMediaId:'m',displayName:'New'}),e=>e.status===400);assert.equal(writes.length,0);
 }
});
test('valid profile and avatar commit together; explicit null removes avatar',async()=>{
 const {s,writes}=service({media:{ownerId:'owner',kind:'photo',status:'ready'}});
 await s.updateMyProfile('owner',{avatarMediaId:'m',displayName:'New'});assert.equal(writes.length,1);assert.equal(writes[0].input.displayName,'New');
 await s.updateMyProfile('owner',{avatarMediaId:null});assert.equal(writes[1].input.avatarMediaId,null);
});
test('username conflicts are controlled without hiding unrelated database failures',async()=>{
 let {s,writes}=service({taken:true});await assert.rejects(s.updateMyProfile('owner',{username:'new'}),e=>e.status===409);assert.equal(writes.length,0);
 s=service({failure:new DatabaseError('users_username_unique')}).s;await assert.rejects(s.updateMyProfile('owner',{username:'new'}),e=>e.status===409);
 const failure=new DatabaseError('unrelated_unique_index');s=service({failure}).s;await assert.rejects(s.updateMyProfile('owner',{bio:'new'}),e=>e===failure);
});
test('malformed route escaping returns 400',()=>{
 const {Router}=load('backend/src/http/router.ts',{'./errors':{HttpError}});const r=new Router();r.add('GET','/users/:id',()=>{});
 assert.throws(()=>r.match('GET','/users/%E0%A4%A'),e=>e.status===400);
});
test('profile link parser accepts only valid profile paths',()=>{
 const {profileUsernameFromPath:parse}=load('mobile/src/navigation/profileLinks.ts');assert.equal(parse('user/Rahul'),'rahul');
 for(const p of ['user/a','user/a%2fb','admin/reset','user/rahul?token=x','user/../admin','user/rahul/extra'])assert.equal(parse(p),null);
});
test('email signup reserves official-looking usernames',()=>{
 const d=load('backend/src/modules/auth/dto.ts',{'../../shared/validation':{EMAIL_RE:/^[^@]+@[^@]+\.[^@]+$/,USERNAME_RE:/^[a-z0-9_.]{3,30}$/}});
 for(const username of ['ADMIN','katkee','support','moderator','superadmin'])assert.throws(()=>d.parseSignupInput({username,email:'u@site.com',password:'12345678',displayName:'User'}),e=>!!e.fieldErrors.username);
});
