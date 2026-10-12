// scripts/check-live.cjs proves the deployed addresses work before a store submission. It runs
// against the real internet, so here it runs against a stand-in network that answers like a
// correct deployment, then like each kind of broken one: each must fail the check.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {checkLive}=require('../scripts/check-live.cjs');
const root=path.join(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'mobile/build-config.json'),'utf8'));
const site=JSON.parse(fs.readFileSync(path.join(root,'website/site.json'),'utf8'));
const page=(name)=>fs.readFileSync(path.join(root,'website/public',name),'utf8');
const CSP="default-src 'none'; img-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** A deployment that answers as production should; `change` breaks one thing. */
function network(change={}) {
 const html=(body)=>({status:200,headers:{'content-type':'text/html; charset=utf-8','content-security-policy':CSP,'strict-transport-security':'max-age=31536000'},body});
 const routes={
  [`${config.productionApiUrl}health`]:{status:200,headers:{'content-type':'application/json'},body:JSON.stringify({status:'ok',service:'katkee-backend',db:'up'})},
  [`${config.productionApiUrl}ready`]:{status:200,headers:{'content-type':'application/json'},body:'{"status":"ready"}'},
  [config.privacyPolicyUrl]:html(page('privacy.html')),
  [config.termsUrl]:html(page('terms.html')),
  [config.supportUrl]:html(page('support.html')),
  [`${site.origin}/delete-account`]:html(page('delete-account.html')),
  [`${site.origin}/`]:html(page('index.html')),
  [`https://www.${new URL(site.origin).host}/`]:{status:301,headers:{location:`${site.origin}/`},body:''},
  ...change,
 };
 const seen=[];
 const fetchImpl=async(url,init)=>{
  seen.push({url,redirect:init.redirect});
  const r=routes[url];
  if(r===undefined)throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}});
  return new Response(r.body,{status:r.status,headers:r.headers});
 };
 return {fetchImpl,seen};
}
const failures=async(change)=>(await checkLive({config,site,fetchImpl:network(change).fetchImpl})).filter(r=>!r.ok).map(r=>r.name);

test('a correct deployment passes every check, without following redirects',async()=>{
 const {fetchImpl,seen}=network();
 const results=await checkLive({config,site,fetchImpl});
 assert.deepEqual(results.filter(r=>!r.ok),[]);
 assert.equal(results.length,8);
 assert.ok(seen.every(s=>s.redirect==='manual'));
 assert.ok(results.every(r=>r.url.startsWith('https://')));
});

test('the app\'s addresses are the website\'s own pages',()=>{
 assert.equal(config.privacyPolicyUrl,`${site.origin}/privacy`);
 assert.equal(config.termsUrl,`${site.origin}/terms`);
 assert.equal(config.supportUrl,`${site.origin}/support`);
});

test('each kind of broken deployment fails its check',async()=>{
 const html=(body,extra={})=>({status:200,headers:{'content-type':'text/html; charset=utf-8','content-security-policy':CSP,'strict-transport-security':'max-age=31536000',...extra},body});
 assert.deepEqual(await failures({[`${config.productionApiUrl}health`]:{status:503,headers:{},body:'{"status":"degraded","db":"down"}'}}),['API health']);
 assert.deepEqual(await failures({[`${config.productionApiUrl}health`]:{status:200,headers:{},body:'{"status":"ok","db":"down"}'}}),['API health']);
 assert.deepEqual(await failures({[`${config.productionApiUrl}ready`]:{status:503,headers:{},body:'{}'}}),['API ready']);
 assert.deepEqual(await failures({[config.privacyPolicyUrl]:{status:404,headers:{'content-type':'text/html'},body:page('404.html')}}),['Privacy Policy']);
 assert.deepEqual(await failures({[config.termsUrl]:html(page('privacy.html'))}),['Terms of Service'],'the wrong page');
 assert.deepEqual(await failures({[config.supportUrl]:{status:301,headers:{location:'https://elsewhere.example/'},body:''}}),['Support']);
 assert.deepEqual(await failures({[config.privacyPolicyUrl]:html(page('privacy.html'),{'content-security-policy':''})}),['Privacy Policy'],'no CSP');
 assert.deepEqual(await failures({[config.privacyPolicyUrl]:html(page('privacy.html'),{'strict-transport-security':''})}),['Privacy Policy'],'no HSTS');
 assert.deepEqual(await failures({[config.privacyPolicyUrl]:html(page('privacy.html'),{'content-type':'application/json'})}),['Privacy Policy']);
 assert.deepEqual(await failures({[`${site.origin}/delete-account`]:html(page('index.html'))}),['Account deletion']);
 assert.deepEqual(await failures({[`https://www.${new URL(site.origin).host}/`]:html(page('index.html'))}),['www redirect'],'www serving a copy instead of redirecting');
 assert.deepEqual(await failures({[`${config.productionApiUrl}health`]:undefined}),['API health'],'not reachable at all');
});
