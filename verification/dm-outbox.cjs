// DM outbox (mobile/src/state/dmOutbox.ts) against a model of the server's idempotent send.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../mobile/src/state/dmOutbox.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const me='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const X='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',Y='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const plain=v=>JSON.parse(JSON.stringify(v));
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};

function clock(){
 let t=1_800_000_000_000,seq=0;const timers=new Map();
 class FakeDate extends Date{constructor(...a){super(...(a.length?a:[t]));}static now(){return t;}}
 return {Date:FakeDate,now:()=>t,
  setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{at:t+Math.max(0,ms||0),fn});return id;},
  clearTimeout:id=>{timers.delete(id);},
  delays:()=>[...timers.values()].map(x=>x.at-t).sort((a,b)=>a-b),
  async advance(ms){const end=t+ms;for(;;){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;t=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}t=end;await settle();}};
}

/** The server: one stored message per (conversation, clientMessageId); failures are scripted per call. */
function fixture(){
 const store=new Map(),c=clock(),server={messages:[],script:[],calls:[]};let ids=0;
 const storage={getItem:async k=>store.has(k)?store.get(k):null,setItem:async(k,v)=>{store.set(k,v);},removeItem:async k=>{store.delete(k);}};
 const api={MAX_MESSAGE_LENGTH:2000,newClientMessageId:()=>'m_test_'+String(++ids).padStart(12,'0'),
  sendMessage:async(conversationId,input,token)=>{
   assert.equal(token,'token');server.calls.push({conversationId,...input});
   const step=server.script.shift();
   if(step==='offline')throw new ApiError(0,'Network request failed');
   if(step==='blocked')throw new ApiError(404,'User not found.');
   if(step==='busy')throw new ApiError(503,'Unavailable');
   let message=server.messages.find(m=>m.conversationId===conversationId&&m.clientMessageId===input.clientMessageId);
   if(!message){message={id:'msg-'+(server.messages.length+1),conversationId,senderId:me,body:input.body??null,sharedStoryId:input.storyId??null,createdAt:new Date(c.now()).toISOString(),clientMessageId:input.clientMessageId};server.messages.push(message);}
   if(step==='lost')throw new ApiError(0,'Response lost');
   return {message};}};
 const load=()=>{const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:n=>({'@react-native-async-storage/async-storage':storage,'../api/client':{ApiError},'../api/conversations':api})[n],
  setTimeout:c.setTimeout,clearTimeout:c.clearTimeout,Date:c.Date},{filename:'dmOutbox.ts'});return module.exports;};
 return {load,store,server,clock:c};
}
const token=()=>'token';

test('a message is saved before sending and is stored once even when the response is lost',async()=>{
 const f=fixture();const outbox=f.load();const sent=[];outbox.onOutboxSent((u,entry,message)=>sent.push([u,entry.clientMessageId,message.id]));
 f.server.script.push('lost');
 const entry=await outbox.enqueueMessage(me,X,{body:'  see you at 7  '});
 assert.equal(entry.body,'see you at 7');
 assert.match(f.store.get('katkee.dmOutbox.v1.'+me),/see you at 7/,'persisted before any network call');
 await outbox.flushOutbox(me,token);
 assert.equal(outbox.pendingMessages(me,X)[0].status,'waiting');assert.equal(f.server.messages.length,1);
 await f.clock.advance(2000);
 assert.equal(f.server.calls.length,2);assert.equal(f.server.calls[1].clientMessageId,entry.clientMessageId,'the retry reuses the id');
 assert.equal(f.server.messages.length,1,'one message on the server');
 assert.deepEqual(sent,[[me,entry.clientMessageId,'msg-1']]);
 assert.equal(outbox.pendingMessages(me,X).length,0);assert.equal(f.store.has('katkee.dmOutbox.v1.'+me),false,'storage emptied');
});

test('a message survives the app being killed mid-send and goes out once after restart',async()=>{
 const f=fixture();let outbox=f.load();
 const entry=await outbox.enqueueMessage(me,X,{body:'hello'});
 // Simulate a kill while the request was in flight: storage holds status "sending".
 const saved=JSON.parse(f.store.get('katkee.dmOutbox.v1.'+me));saved[0].status='sending';f.store.set('katkee.dmOutbox.v1.'+me,JSON.stringify(saved));
 f.server.messages.push({id:'msg-1',conversationId:X,senderId:me,body:'hello',sharedStoryId:null,createdAt:'',clientMessageId:entry.clientMessageId});
 outbox=f.load();await outbox.loadOutbox(me);
 assert.equal(outbox.pendingMessages(me,X)[0].status,'waiting');
 await outbox.flushOutbox(me,token);
 assert.equal(f.server.messages.length,1,'the server answered with the stored message');
 assert.equal(outbox.pendingMessages(me,X).length,0);
});

test('messages keep their order in a conversation; other conversations are not held up',async()=>{
 const f=fixture();const outbox=f.load();
 await outbox.enqueueMessage(me,X,{body:'first'});await outbox.enqueueMessage(me,X,{body:'second'});await outbox.enqueueMessage(me,Y,{body:'elsewhere'});
 f.server.script.push('offline');
 await outbox.flushOutbox(me,token);
 assert.deepEqual(f.server.calls.map(c=>c.body),['first','elsewhere'],'"second" waits behind "first"');
 assert.deepEqual(plain(outbox.pendingMessages(me,X).map(m=>[m.body,m.status])),[['first','waiting'],['second','waiting']]);
 assert.deepEqual(f.clock.delays(),[2000],'one retry timer, at the first message\'s backoff');
 await f.clock.advance(2000);
 assert.deepEqual(f.server.messages.map(m=>m.body),['elsewhere','first','second']);
 assert.equal(f.clock.delays().length,0);
});

test('a refused message waits for the person, and can be retried or deleted',async()=>{
 const f=fixture();const outbox=f.load();
 await outbox.enqueueMessage(me,X,{body:'are you there?'});await outbox.enqueueMessage(me,X,{body:'later one'});
 f.server.script.push('blocked');
 await outbox.flushOutbox(me,token);
 const [refused]=outbox.pendingMessages(me,X);
 assert.deepEqual([refused.status,refused.error],['failed','User not found.']);
 assert.deepEqual(f.server.messages.map(m=>m.body),['later one'],'a refusal doesn\'t hold later messages');
 assert.equal(f.clock.delays().length,0,'no automatic retry of a refusal');
 await outbox.retryMessage(me,refused.clientMessageId,token);
 assert.equal(outbox.pendingMessages(me,X).length,0);assert.equal(f.server.messages.length,2);
 await outbox.enqueueMessage(me,X,{body:'oops'});f.server.script.push('blocked');await outbox.flushOutbox(me,token);
 await outbox.discardMessage(me,outbox.pendingMessages(me,X)[0].clientMessageId);
 assert.equal(outbox.pendingMessages(me,X).length,0);
});

test('backoff grows on repeated outages and a forced flush (app back online) skips it',async()=>{
 const f=fixture();const outbox=f.load();
 await outbox.enqueueMessage(me,X,{body:'hi'});
 f.server.script.push('busy','offline','offline');
 await outbox.flushOutbox(me,token);assert.deepEqual(f.clock.delays(),[2000]);
 await f.clock.advance(2000);assert.deepEqual(f.clock.delays(),[5000]);
 await f.clock.advance(5000);assert.deepEqual(f.clock.delays(),[15000]);
 await outbox.flushOutbox(me,token,{force:true});
 assert.equal(f.server.messages.length,1);assert.equal(outbox.pendingMessages(me,X).length,0);
});

test('nothing is sent, and nothing spins, while signed out',async()=>{
 const f=fixture();const outbox=f.load();
 await outbox.enqueueMessage(me,X,{body:'hi'});
 await outbox.flushOutbox(me,()=>null);
 assert.equal(f.server.calls.length,0);assert.equal(f.clock.delays().length,0,'no retry timer without a session');
});

test('sign-out clears unsent messages from memory and disk, and in-flight work can\'t write them back',async()=>{
 const f=fixture();const outbox=f.load();
 await outbox.enqueueMessage(me,X,{body:'private'});
 f.server.script.push('offline');await outbox.flushOutbox(me,token);
 await outbox.clearOutbox(me);
 assert.equal(outbox.pendingMessages(me,X).length,0);assert.equal(f.store.has('katkee.dmOutbox.v1.'+me),false);
 await f.clock.advance(60000);
 assert.equal(f.server.calls.length,1,'no retry after sign-out');
 assert.equal(f.store.has('katkee.dmOutbox.v1.'+me),false);
 assert.ok(![...f.store.values()].some(v=>v.includes('private')));
});

test('accounts are kept apart and input is validated',async()=>{
 const f=fixture();const outbox=f.load();
 await outbox.enqueueMessage(me,X,{body:'mine'});
 assert.equal(outbox.pendingMessages(other,X).length,0);
 await assert.rejects(outbox.enqueueMessage(me,X,{body:'   '}),/Write a message/);
 await assert.rejects(outbox.enqueueMessage(me,X,{body:'x'.repeat(2001)}),/up to 2000/);
 await assert.rejects(outbox.enqueueMessage('../escape',X,{body:'x'}),/Invalid user/);
 const story=await outbox.enqueueMessage(me,Y,{storyId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});
 assert.equal(story.storyId,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 for(let i=0;i<198;i++)await outbox.enqueueMessage(me,X,{body:'m'+i});
 await assert.rejects(outbox.enqueueMessage(me,X,{body:'one too many'}),/Too many messages/);
});
