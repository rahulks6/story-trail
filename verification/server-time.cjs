// API timestamps ("2026-10-05 16:49:38.646456+00") are not in ECMAScript's Date format, so Hermes
// may not parse them: every server timestamp in the app goes through mobile/src/utils/serverTime.ts.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const src=path.join(__dirname,'../mobile/src');
const code=ts.transpileModule(fs.readFileSync(path.join(src,'utils/serverTime.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module_={exports:{}};vm.runInNewContext(code,{module:module_,exports:module_.exports,Date,Number},{filename:'serverTime.ts'});
const {serverDate,serverTimeMs,timeAgo}=module_.exports;

test('serverDate reads every API timestamp format and never yields an Invalid Date',()=>{
 for(const value of ['2026-10-05 16:49:38.646456+00','2026-10-05T16:49:38.646456+00:00','2026-10-05T16:49:38.646Z'])
  assert.equal(serverDate(value).getTime(),Date.UTC(2026,9,5,16,49,38,646),value);
 for(const value of ['',null,undefined,'yesterday','2026-13-45 99:99:99+00'])assert.equal(serverDate(value),null,String(value));
 assert.ok(Number.isNaN(serverTimeMs('not a time')));
});

test('timeAgo gives compact ages and never a negative or broken one',()=>{
 const now=Date.UTC(2026,9,6,12,0,0);
 const at=(ms)=>new Date(now-ms).toISOString();
 assert.deepEqual([0,59e3,5*60e3,3*3600e3,2*86400e3,22*86400e3].map(ms=>timeAgo(at(ms),now)),['just now','just now','5m ago','3h ago','2d ago','3w ago']);
 assert.equal(timeAgo('2026-10-06 11:00:00+00',now),'1h ago','Postgres text timestamps');
 assert.equal(timeAgo(at(-90e3),now),'just now','a phone clock behind the server');
 for(const value of ['',null,'yesterday'])assert.equal(timeAgo(value,now),'');
});

// Values the app itself wrote as ISO strings (drafts, the DM outbox, analytics, sticker dates).
const ALLOWED={
 'components/StickerSheet.tsx':2,
 'state/dmOutbox.ts':1,
 'state/validateSavedDraft.ts':1,
 'analytics/analytics.ts':4,
 'utils/serverTime.ts':3,
};
test('no screen parses a server timestamp with Date directly',()=>{
 const found={};
 const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(ts|tsx)$/.test(e.name)){
  const n=(fs.readFileSync(p,'utf8').match(/new Date\((?!\))|Date\.parse\(/g)??[]).length;if(n)found[path.relative(src,p).split(path.sep).join('/')]=n;}}};
 walk(src);
 assert.deepEqual(found,ALLOWED,'parse API timestamps with serverTimeMs/serverDate (mobile/src/utils/serverTime.ts)');
});
