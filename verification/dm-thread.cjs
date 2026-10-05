// Pure DM thread helpers (mobile/src/screens/dm/threadState.ts) and API timestamp parsing (mobile/src/utils/serverTime.ts).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const transpile=f=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(file,requireMap={}){const module={exports:{}};vm.runInNewContext(transpile(file),{module,exports:module.exports,require:n=>{if(n in requireMap)return requireMap[n];throw Error('unexpected '+n);},Date,Math,Map,Set,Number},{filename:file});return module.exports;}
const time=load('mobile/src/utils/serverTime.ts');
const thread=load('mobile/src/screens/dm/threadState.ts',{'../../utils/serverTime':time});
const plain=v=>JSON.parse(JSON.stringify(v));
const me='me',them='them';
const msg=(id,createdAt,senderId=me,status)=>({id,conversationId:'c',senderId,body:id,sharedStoryId:null,createdAt,...(status?{status}:{})});

test('API timestamps parse the same in every engine format the server produces',()=>{
 const expected=Date.UTC(2026,9,5,16,49,38,646);
 for(const value of['2026-10-05 16:49:38.646456+00','2026-10-05T16:49:38.646456+00:00','2026-10-05T16:49:38.646Z','2026-10-05 21:19:38.646+0430','2026-10-05 21:19:38.646+04:30'])
  assert.equal(time.serverTimeMs(value),expected,value);
 assert.equal(time.serverTimeMs('2026-10-05 16:49:38+00'),Date.UTC(2026,9,5,16,49,38,0));
 assert.equal(time.serverTimeMs('2026-10-05 16:49+00'),Date.UTC(2026,9,5,16,49,0,0));
 assert.ok(Number.isNaN(time.serverTimeMs('')));assert.ok(Number.isNaN(time.serverTimeMs(null)));assert.ok(Number.isNaN(time.serverTimeMs('yesterday')));
});

test('pages merge newest first without duplicates, whatever order they arrive in',()=>{
 const older=[msg('b','2026-10-05 10:00:02+00'),msg('a','2026-10-05 10:00:01+00')];
 const newer=[msg('d','2026-10-05 10:00:04.5+00'),msg('c','2026-10-05 10:00:04+00'),msg('b','2026-10-05 10:00:02+00')];
 assert.deepEqual(plain(thread.mergeMessages(older,newer)).map(m=>m.id),['d','c','b','a']);
 assert.deepEqual(plain(thread.mergeMessages(newer,older)).map(m=>m.id),['d','c','b','a']);
 assert.equal(thread.newestId(thread.mergeMessages(older,newer)),'d');assert.equal(thread.oldestId(thread.mergeMessages(older,newer)),'a');
 assert.equal(thread.newestId([]),null);
 const tie=thread.mergeMessages([],[msg('x1','2026-10-05 10:00:00+00'),msg('x2','2026-10-05 10:00:00+00')]);
 assert.deepEqual(plain(tie).map(m=>m.id),['x2','x1'],'same instant: id breaks the tie like the server does');
});

test('read receipts update only the viewer\'s own messages, and statuses never go backwards',()=>{
 const list=[msg('m3','2026-10-05 10:00:03+00'),msg('t2','2026-10-05 10:00:02+00',them),msg('m1','2026-10-05 10:00:01+00',me,'sent')];
 const delivered=thread.applyReceipt(list,me,{lastReadAt:'2026-10-05T09:00:00+00:00',lastDeliveredAt:'2026-10-05T10:00:03.5+00:00'});
 assert.deepEqual(plain(delivered).map(m=>[m.id,m.status??null]),[['m3','delivered'],['t2',null],['m1','delivered']]);
 const read=thread.applyReceipt(delivered,me,{lastReadAt:'2026-10-05T10:00:01.5+00:00',lastDeliveredAt:'2026-10-05T10:00:03.5+00:00'});
 assert.deepEqual(plain(read).map(m=>m.status??null),['delivered',null,'read']);
 const stale=thread.applyReceipt(read,me,{lastReadAt:'2026-10-05T09:00:00+00:00',lastDeliveredAt:'2026-10-05T09:00:00+00:00'});
 assert.equal(stale,read,'an older receipt changes nothing (same array back)');
 const refetched=thread.mergeMessages(read,[msg('m1','2026-10-05 10:00:01+00',me,'delivered')]);
 assert.equal(plain(refetched).find(m=>m.id==='m1').status,'read','a page fetched before the receipt can\'t undo it');
});
