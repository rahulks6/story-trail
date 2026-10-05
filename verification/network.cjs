const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('../backend/node_modules/typescript');
function client(fetch=async()=>{throw Error('Unexpected fetch');}) {
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(require.resolve('../mobile/src/api/client.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:()=>({appEnv:{apiBaseUrl:'https://unit.invalid/'}}),fetch,Headers,AbortController,setTimeout,clearTimeout});
 return module.exports;
}
test('deadline aborts native work even when transport ignores cancellation',async()=>{
 const api=client();let signal;
 await assert.rejects(api.withRequestTimeout(s=>{signal=s;return new Promise(()=>{});},10),e=>e.status===408);
 assert.equal(signal.aborted,true);
});
test('already cancelled request never starts work',async()=>{
 const api=client(),c=new AbortController();c.abort();let started=false;
 await assert.rejects(api.withRequestTimeout(async()=>{started=true;},20,c.signal),e=>e.status===0);
 assert.equal(started,false);
});
test('external cancellation interrupts an active request',async()=>{
 const api=client(),c=new AbortController();let signal;
 const pending=api.withRequestTimeout(s=>{signal=s;return new Promise(()=>{});},1000,c.signal);
 await Promise.resolve();c.abort();await assert.rejects(pending,e=>e.status===0);assert.equal(signal.aborted,true);
});
test('HTML gateway failure preserves HTTP status and hides response contents',async()=>{
 const api=client(async()=>new Response('<html>internal proxy configuration</html>',{status:502}));
 await assert.rejects(api.apiGet('/feed'),e=>e.status===502&&!e.message.includes('proxy configuration'));
});
test('empty and malformed successes cannot be treated as valid API data',async()=>{
 for(const body of ['', 'null', '<html>login</html>']) {
  const api=client(async()=>new Response(body,{status:200}));
  await assert.rejects(api.apiGet('/feed'),e=>e instanceof api.ApiError);
 }
});
test('valid 204 remains supported',async()=>{
 const api=client(async()=>new Response(null,{status:204}));assert.equal(await api.apiDelete('/account'),undefined);
});
test('validation errors retain field details',async()=>{
 const api=client(async()=>new Response(JSON.stringify({error:'validation_error',fields:{bio:'Too long'}}),{status:400}));
 await assert.rejects(api.apiPatch('/profile',{bio:'x'}),e=>e.status===400&&e.fieldErrors.bio==='Too long');
});
test('server failures do not automatically replay a write',async()=>{
 let calls=0;const api=client(async()=>{calls++;return new Response('{}',{status:503});});
 await assert.rejects(api.apiPost('/stories',{caption:'once'}),e=>e.status===503);assert.equal(calls,1);
});
test('Headers and lowercase authorization are refreshed correctly',async()=>{
 let calls=0;const api=client(async(_,init)=>{calls++;if(calls===2)assert.equal(new Headers(init.headers).get('authorization'),'Bearer new');return new Response('{}',{status:calls===1?401:200});});
 api.setSessionHandler(async t=>{assert.equal(t,'old');return 'new';});
 await api.authenticatedFetch('https://unit.invalid',{headers:new Headers({authorization:'Bearer old'})});assert.equal(calls,2);
});

test('configured origin with trailing slash does not create a double-slash API route',async()=>{
 const api=client(async url=>{assert.equal(url,'https://unit.invalid/api/v1/auth/me');return new Response('{}',{status:200});});
 await api.apiGet('/api/v1/auth/me');
});
test('deadline includes a stalled response body',async()=>{
 const api=client();let signal;
 await assert.rejects(api.withRequestTimeout(s=>{signal=s;return api.readApiResponse({status:200,ok:true,text:()=>new Promise(()=>{})});},10),e=>e.status===408);
 assert.equal(signal.aborted,true);
});
