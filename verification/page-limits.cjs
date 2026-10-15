// The server returns at most 50 items per request (backend/src/http/pagination.ts) and refuses a
// larger `limit` with 422. The Close Friends screen asked for 200 and never loaded. No list
// request in the app may ask for more than the server gives.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const max=Number(/const MAX_LIMIT = (\d+);/.exec(fs.readFileSync(path.join(root,'backend/src/http/pagination.ts'),'utf8'))[1]);

test('no list request asks for more than the server returns at once',()=>{
 const over=[];
 (function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
  if(e.isDirectory())walk(p);else if(/\.tsx?$/.test(e.name)){
   for(const m of fs.readFileSync(p,'utf8').matchAll(/\blimit: ?(\d+)/g))if(Number(m[1])>max)over.push(`${path.relative(root,p)}: limit ${m[1]}`);
  }}})(path.join(root,'mobile/src'));
 assert.equal(max,50);
 assert.deepEqual(over,[]);
});
