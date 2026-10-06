// Mobile analytics client (mobile/src/analytics/analytics.ts) with storage, AppState, the API
// client and time mocked: batching, stable ids, retries, sessions, crash notes and privacy.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../mobile/src/analytics/analytics.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const plain=v=>JSON.parse(JSON.stringify(v));
const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const settle=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));};

function fixture({storage=new Map(),os='android',start=Date.parse('2026-10-06T10:00:00Z'),appVersion='1.4.0'}={}){
 let now=start,seq=0;const timers=new Map(),calls=[],failures=[];let appStateHandler=null;
 class FakeDate extends Date{constructor(...a){if(a.length)super(...a);else super(now);}static now(){return now;}}
 class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
 const asyncStorage={getItem:async k=>storage.has(k)?storage.get(k):null,setItem:async(k,v)=>{storage.set(k,v);},removeItem:async k=>{storage.delete(k);}};
 const client={ApiError,apiPost:async(p,body,token)=>{calls.push({path:p,body:plain(body),token});const fail=failures.shift();if(fail)throw fail();return {accepted:body.events.length};}};
 const rn={Platform:{OS:os},AppState:{addEventListener:(type,fn)=>{appStateHandler=fn;return {remove(){appStateHandler=null;}};}}};
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,Date:FakeDate,JSON,Math,Promise,Set,Map,
  setTimeout:(fn,ms=0)=>{const id=++seq;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>{timers.delete(id);},
  require:n=>({'@react-native-async-storage/async-storage':asyncStorage,'react-native':rn,'../api/client':client,'../config/env':{appEnv:{appVersion}}}[n])},{filename:'analytics.ts'});
 return {analytics:module.exports,calls,storage,ApiError,
  failNext(...errors){failures.push(...errors);},
  appState(state){appStateHandler?.(state);},
  sent(){return calls.flatMap(c=>c.body.events);},
  async advance(ms){const end=now+ms;await settle();for(;;){const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);now=Math.max(now,next[1].at);next[1].fn();await settle();}now=end;await settle();}};
}

test('events leave in background batches with stable ids, and a lost response resends the same ids',async()=>{
 const f=fixture(),a=f.analytics;
 const stop=a.startAnalytics(USER,()=>'token-1');
 a.track('profile_viewed');a.track('search_performed');
 assert.equal(f.calls.length,0,'tracking never waits for the network');
 f.failNext(()=>new TypeError('Network request failed'));
 await f.advance(1000);
 assert.equal(f.calls.length,1);
 const first=f.calls[0].body;
 assert.equal(f.calls[0].path,'/api/v1/analytics/events');
 assert.equal(first.platform,'android');
 assert.equal(first.appVersion,'1.4.0','the release version from build-config.json');
 assert.deepEqual(first.events.map(e=>e.name),['app_session_started','profile_viewed','search_performed']);
 assert.deepEqual(first.events[0].properties,{coldStart:true});
 assert.ok(first.events.every(e=>UUID.test(e.id)&&e.sessionId===first.events[0].sessionId&&UUID.test(e.sessionId)));
 assert.ok(first.events.every(e=>Object.keys(e).sort().join()==='id,name,occurredAt,properties,sessionId'),'only the event shape leaves the phone');
 await f.advance(10_000);
 assert.equal(f.calls.length,2,'retried after a delay');
 assert.deepEqual(f.calls[1].body.events.map(e=>e.id),first.events.map(e=>e.id),'the retry resends the same ids, so nothing is counted twice');
 await f.advance(600_000);
 assert.equal(f.calls.length,2,'nothing left to send');
 stop();
});

test('nothing is collected while signed out, and each person\'s unsent events stay theirs',async()=>{
 const f=fixture(),a=f.analytics;
 a.track('profile_viewed');
 const stopA=a.startAnalytics(USER,()=>null);
 a.track('search_performed');
 await f.advance(2000);
 assert.equal(f.calls.length,0,'no token, nothing sent');
 stopA();
 assert.deepEqual(JSON.parse(f.storage.get('katkee.analytics.v1.'+USER)).map(e=>e.name),['app_session_started','search_performed'],'kept on the phone for their next sign-in');
 const stopB=a.startAnalytics(OTHER,()=>'token-b');
 await f.advance(2000);
 assert.deepEqual(f.calls.map(c=>[c.token,c.body.events.map(e=>[e.name,e.properties.coldStart])]),[['token-b',[['app_session_started',false]]]],'another person never sends them');
 stopB();
 a.startAnalytics(USER,()=>'token-a');
 await f.advance(2000);
 assert.equal(f.calls[1].token,'token-a');
 assert.deepEqual(f.calls[1].body.events.map(e=>e.name),['app_session_started','search_performed','app_session_started']);
});

test('a batch the server refuses is dropped; offline, rate limits and server errors are retried with backoff',async()=>{
 const f=fixture(),a=f.analytics;
 a.startAnalytics(USER,()=>'token');
 f.failNext(()=>new f.ApiError(422,'invalid'));
 await f.advance(1000);
 await f.advance(3_600_000);
 assert.equal(f.calls.length,1,'a refused batch is not retried forever');
 a.track('highlight_viewed');
 f.failNext(()=>new f.ApiError(503,'down'),()=>new f.ApiError(429,'slow down'));
 await f.advance(10_000);
 assert.equal(f.calls.length,2);
 await f.advance(9_000);
 assert.equal(f.calls.length,2,'waits before retrying');
 await f.advance(1_000);
 assert.equal(f.calls.length,3);
 await f.advance(30_000);
 assert.equal(f.calls.length,4,'longer wait after the second failure');
 assert.deepEqual(f.calls.slice(1).map(c=>c.body.events.map(e=>e.name)),[['highlight_viewed'],['highlight_viewed'],['highlight_viewed']]);
 await f.advance(3_600_000);
 assert.equal(f.calls.length,4);
});

test('a new session starts only after 30 minutes away from the app',async()=>{
 const f=fixture(),a=f.analytics;
 a.startAnalytics(USER,()=>'token');
 await f.advance(1000);
 f.appState('background');await f.advance(10*60_000);f.appState('active');
 a.track('profile_viewed');
 f.appState('inactive');await f.advance(31*60_000);f.appState('active');
 a.track('search_performed');
 await f.advance(60_000);
 const events=f.sent();
 const starts=events.filter(e=>e.name==='app_session_started');
 assert.deepEqual(starts.map(e=>e.properties.coldStart),[true,false],'one new session, after the long break only');
 assert.notEqual(starts[0].sessionId,starts[1].sessionId);
 assert.equal(events.find(e=>e.name==='profile_viewed').sessionId,starts[0].sessionId);
 assert.equal(events.find(e=>e.name==='search_performed').sessionId,starts[1].sessionId);
});

test('a fatal crash is noted before the app closes and reported once, by the same person, on the next launch',async()=>{
 const storage=new Map();let f=fixture({storage});
 let handedOver=0;const errorUtils={handler:null,getGlobalHandler:()=>()=>{handedOver++;},setGlobalHandler(h){this.handler=h;}};
 f.analytics.recordFatalErrors(errorUtils);
 f.analytics.startAnalytics(USER,()=>null);
 await f.advance(1000);
 errorUtils.handler(new Error('render failed: private text'),false);
 assert.equal(handedOver,1,'non-fatal errors pass straight through');
 assert.equal(storage.has('katkee.analytics.crash.v1'),false);
 errorUtils.handler(new Error('render failed: private text'),true);
 await f.advance(0);
 assert.equal(handedOver,2,'the default crash handling still runs');
 const note=JSON.parse(storage.get('katkee.analytics.crash.v1'));
 assert.equal(note.userId,USER);
 assert.ok(UUID.test(note.id)&&UUID.test(note.sessionId));
 assert.ok(!JSON.stringify(note).includes('private text'),'no message or stack is kept');

 f=fixture({storage}); // next launch: same phone storage, fresh app
 f.analytics.startAnalytics(OTHER,()=>'token-other');
 await f.advance(2000);
 assert.ok(!f.sent().some(e=>e.name==='app_crash'),'another person signing in does not report it');
 assert.ok(storage.has('katkee.analytics.crash.v1'));
 f.analytics.startAnalytics(USER,()=>'token');
 await f.advance(2000);
 const crash=f.sent().filter(e=>e.name==='app_crash');
 assert.deepEqual(crash.map(e=>[e.id,e.sessionId,e.properties]),[[note.id,note.sessionId,{fatal:true}]]);
 assert.equal(storage.has('katkee.analytics.crash.v1'),false,'reported once');
});

test('events older than the server accepts are dropped, and the phone keeps at most 300',async()=>{
 const storage=new Map(),start=Date.parse('2026-10-06T10:00:00Z');
 const old={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'profile_viewed',occurredAt:new Date(start-8*86_400_000).toISOString(),sessionId:null,properties:{}};
 const recent={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'profile_viewed',occurredAt:new Date(start-86_400_000).toISOString(),sessionId:null,properties:{}};
 storage.set('katkee.analytics.v1.'+USER,JSON.stringify([old,recent,{nonsense:true}]));
 let f=fixture({storage,start});
 f.analytics.startAnalytics(USER,()=>'token');
 await f.advance(2000);
 assert.deepEqual(f.sent().map(e=>e.id).filter(id=>id===old.id||id===recent.id),[recent.id]);

 f=fixture({storage:new Map()});
 const stop=f.analytics.startAnalytics(USER,()=>null);
 await f.advance(1000);
 for(let i=0;i<400;i++)f.analytics.track('search_performed');
 await f.advance(1000);
 stop();
 assert.equal(JSON.parse(f.storage.get('katkee.analytics.v1.'+USER)).length,300);
});

test('iOS batches say so; a refused or invalid person id never starts collection',async()=>{
 const f=fixture({os:'ios'});
 assert.equal(typeof f.analytics.startAnalytics('not-a-user',()=>'t'),'function');
 f.analytics.track('profile_viewed');
 await f.advance(20_000);
 assert.equal(f.calls.length,0);
 f.analytics.startAnalytics(USER,()=>'t');
 await f.advance(2000);
 assert.equal(f.calls[0].body.platform,'ios');
});

test('a missing or malformed version is left out rather than sent',async()=>{
 for(const appVersion of ['','not a version!']){
  const f=fixture({appVersion});f.analytics.startAnalytics(USER,()=>'t');await f.advance(2000);
  assert.equal('appVersion' in f.calls[0].body,false,JSON.stringify(appVersion));
 }
});
