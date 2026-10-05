/** Isolated test databases only. Never reset, truncate, or drop an existing database. */
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
if(process.env.NODE_ENV==='production')throw Error('Do not run integration tests with production configuration.');
if(!['localhost','127.0.0.1','::1'].includes(process.env.PGHOST||'localhost'))throw Error('Use a dedicated local PostgreSQL test server.');
const env={...process.env,PGHOST:process.env.PGHOST||'localhost',JWT_ACCESS_SECRET:process.env.JWT_ACCESS_SECRET||'isolated-test-access-secret-at-least-32-characters',JWT_REFRESH_SECRET:process.env.JWT_REFRESH_SECRET||'isolated-test-refresh-secret-at-least-32-characters'};
const run=Date.now().toString(),template='katkee_test_template_'+run;
const dbCommand=(name,args)=>cp.execFileSync(process.platform==='win32'?name+'.exe':name,args,{env,stdio:'inherit'});
dbCommand('createdb',[template]);
for(let i=0;i<2;i++)cp.execFileSync(process.execPath,['dist/scripts/migrate.js'],{cwd:root,env:{...env,PGDATABASE:template},stdio:'inherit'});
let failed=false;
// TEST_FILTER=<regex> runs a subset (e.g. TEST_FILTER='media|stories'); the full suite is the default.
const only=process.env.TEST_FILTER?new RegExp(process.env.TEST_FILTER):null;
for(const file of fs.readdirSync(path.join(root,'dist/test')).filter(n=>n.endsWith('.test.js')&&(!only||only.test(n)))){
 const database='katkee_test_'+file.replace(/[^a-z0-9]/gi,'').toLowerCase()+'_'+run;
 dbCommand('createdb',['-T',template,database]);
 const result=cp.spawnSync(process.execPath,['--test',path.join(root,'dist/test',file)],{env:{...env,PGDATABASE_TEST:database},stdio:'inherit'});
 if(result.status!==0)failed=true;
}
console.log('Generated local test databases retained for inspection. No existing data was reset.');
process.exitCode=failed?1:0;
