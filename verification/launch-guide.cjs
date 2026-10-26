// LAUNCH.md is the step-by-step deploy guide. A wrong name in it costs the person following it
// hours, so this checks it against the code: the npm scripts it runs, the files it names, the
// settings in its cdk.context.json, the secrets it fills, the stack outputs it reads, the
// container and build stage it uses, and the sign-up request it sends.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../backend/node_modules/typescript');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const guide=read('LAUNCH.md');
const stack=read('infra/lib/katkee-stack.ts');

/** A TypeScript module, transpiled and run; `mocks` supplies its imports. */
function load(file,mocks={}){
 const module={exports:{}};
 const code=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:(name)=>{if(name in mocks)return mocks[name];throw Error('Unexpected '+name);}});
 return module.exports;
}

test('every npm script the guide runs exists',()=>{
 const scripts=JSON.parse(read('package.json')).scripts;
 const infra=JSON.parse(read('infra/package.json')).scripts;
 const used=[...guide.matchAll(/(?<!--prefix \w+ )npm run ([\w:-]+)/g)].map((m)=>m[1]);
 assert.ok(used.length>=5);
 // The guide runs them from the project root, except `npm run build` in infra (Part 6).
 for(const name of used)assert.ok(scripts[name]||(name==='build'&&infra.build),`npm run ${name} is not in package.json`);
 assert.match(guide,/cd ~\/katkee\/infra\n\s*npm ci\n\s*npm run build/);
});

test('every project file the guide names exists',()=>{
 const tops=['admin','backend','brand','docs','infra','legal','mobile','scripts','verification','website'];
 const named=new Set([...guide.matchAll(/`([\w.@-]+(?:\/[\w.@-]+)+)`/g)].map((m)=>m[1]).filter((p)=>tops.includes(p.split('/')[0])));
 assert.ok(named.size>=10);
 for(const file of named){
  if(file.includes('/build/'))continue; // outputs of a build the guide runs
  assert.ok(fs.existsSync(path.join(root,file)),`${file} does not exist`);
 }
 for(const file of ['RELEASE_READINESS.md'])assert.ok(guide.includes(file)&&fs.existsSync(path.join(root,file)));
});

test('the settings file uses only settings the deploy reads, and every one it needs',()=>{
 const block=/cat > cdk\.context\.json <<'EOF'\n([\s\S]*?)\n\s*EOF/.exec(guide);
 assert.ok(block,'the cdk.context.json block');
 const settings=JSON.parse(block[1].replace(/^ {3}/gm,''));
 const app=read('infra/bin/katkee.ts');
 const known=new Set([...app.matchAll(/\b(?:get|need|list)\("(\w+)"\)/g)].map((m)=>m[1]));
 const required=new Set([...app.matchAll(/\bneed\("(\w+)"\)/g)].map((m)=>m[1]));
 for(const key of Object.keys(settings))assert.ok(known.has(key),`${key} is not a setting infra/bin/katkee.ts reads`);
 // Always needed (the provider ones only with their provider; one of the two key forms).
 for(const key of ['imageTag','apiDomainName','apiCertificateArn','emailFrom','sesIdentity','alarmEmail'])assert.ok(required.has(key)&&key in settings,key);
 assert.ok('cloudFrontPublicKeyFile' in settings);
 assert.equal(settings.adminConsoleEnabled,'true');
 assert.match(settings.imageTag,/^[A-Za-z0-9._-]{1,128}$/);
 // Settings added later in the guide, as JSON lines.
 for(const [,key] of guide.matchAll(/^\s+"(\w+)": "[^"]*",$/gm))assert.ok(known.has(key),`${key} is not a setting`);
 for(const [,key] of guide.matchAll(/`"(\w+)": "[^"`]*",`/g))assert.ok(known.has(key),`${key} is not a setting`);
 for(const name of (guide.match(/"providers": "([^"]+)"/g)??[]).flatMap((l)=>/"providers": "([^"]+)"/.exec(l)[1].split(',')))assert.ok(['fcm','apns','phone','safeBrowsing'].includes(name),name);
});

test('the secrets, stack outputs, container and build stage it uses are the real ones',()=>{
 const secrets=new Set([...stack.matchAll(/"([A-Z_]+)"/g)].map((m)=>m[1]));
 const filled=[...guide.matchAll(/katkee\/production\/([A-Z_]+)/g)].map((m)=>m[1]);
 assert.ok(filled.includes('CLOUDFRONT_PRIVATE_KEY')&&filled.includes('FCM_SERVICE_ACCOUNT_JSON'));
 for(const name of filled)assert.ok(secrets.has(name),`secret ${name} is not in PROVIDER_CREDENTIALS`);
 assert.match(stack,/export const SECRET_PREFIX = "katkee\/production\/";/);
 const outputs=new Set([...stack.matchAll(/output\("(\w+)"/g)].map((m)=>m[1]));
 const read_=[...guide.matchAll(/\$\(out (\w+)\)/g)].map((m)=>m[1]);
 assert.ok(read_.length>=10);
 for(const name of read_)assert.ok(outputs.has(name),`stack output ${name} does not exist`);
 assert.ok(outputs.has('LoadBalancerDns')&&guide.includes('`LoadBalancerDns`'));
 assert.ok(guide.includes('--stack-name KatkeeProduction')&&read('infra/bin/katkee.ts').includes('new KatkeeStack(app, "KatkeeProduction"'));
 assert.ok(guide.includes('{"name":"api","command":["node","dist/scripts/bootstrap-super-admin.js"')&&stack.includes('apiTask.addContainer("api"'));
 assert.ok(fs.existsSync(path.join(root,'backend/scripts/bootstrap-super-admin.ts')));
 assert.ok(guide.includes('--target worker')&&/^FROM \S+ AS worker$/m.test(read('backend/Dockerfile')));
 assert.match(read('backend/Dockerfile').trim().split('\n').filter((l)=>l.startsWith('FROM')).pop(),/AS runtime$/,'the API image is the last stage');
});

test('the sign-up request in Part 15 is one the API accepts, once the placeholders are filled in',()=>{
 const body=JSON.parse(/-d '(\{"username"[^']+\})'/.exec(guide)[1]);
 assert.deepEqual(Object.keys(body).sort(),['birthDate','displayName','email','password','username']);
 const validation=load('backend/src/shared/validation.ts',{'../http/errors':{HttpError:class HttpError extends Error{}}});
 const policy=load('backend/src/modules/users/username-policy.ts',{'../../shared/validation':validation,'../../shared/verified':load('backend/src/shared/verified.ts')});
 assert.equal(policy.usernameProblem(body.username),null,`${body.username} is refused by the username rules`);
 assert.equal(body.birthDate,'YYYY-MM-DD','a placeholder the reader replaces');
 const {birthDateProblem}=load('backend/src/modules/auth/age.ts');
 assert.equal(birthDateProblem('1990-01-31'),null,'the example date the guide gives is accepted');
 assert.ok(guide.includes('such as `1990-01-31`'));
 assert.ok(body.email.endsWith('@katkee.com')&&body.displayName.length<=60);
});
