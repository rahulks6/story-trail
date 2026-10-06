// Sponsored Story client (mobile/src/api/ads.ts) with react-native and the API client mocked.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../mobile/src/api/ads.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const plain=v=>JSON.parse(JSON.stringify(v));

function fixture(os='android'){
 const calls={get:[],post:[]},timers=[];
 const client={apiGet:async(url,token)=>{calls.get.push({url,token});return {items:[]};},apiPost:async(url,body,token)=>{calls.post.push({url,body:plain(body),token});}};
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,Math,Promise,
  setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>undefined,
  require:n=>({'react-native':{Platform:{OS:os}},'./client':client}[n])},{filename:'ads.ts'});
 return {ads:module.exports,calls,runTimers:()=>{while(timers.length)timers.shift()();}};
}

test('placements tell the server the platform, so platform-targeted campaigns can match',async()=>{
 for(const [os,expected] of [['android','/api/v1/ads/placements?organicCount=12&platform=android'],['ios','/api/v1/ads/placements?organicCount=12&platform=ios'],['web','/api/v1/ads/placements?organicCount=12']]){
  const {ads,calls}=fixture(os);await ads.getAdPlacements(12,'token');
  assert.equal(calls.get[0].url,expected,os);
 }
});

test('the organic count is always a whole number the server accepts (0-1000)',async()=>{
 const {ads,calls}=fixture();
 for(const count of [-3,2.7,5000])await ads.getAdPlacements(count,'token');
 assert.deepEqual(calls.get.map(c=>c.url.match(/organicCount=(\d+)/)[1]),['0','2','1000']);
});

test('the call-to-action opens the advertiser profile for View Profile and only https links otherwise',()=>{
 const {ads}=fixture();
 assert.deepEqual(plain(ads.adCtaAction({cta:'View Profile',destination:null,profileUsername:'sunrise.travel'})),{kind:'profile',username:'sunrise.travel'});
 assert.equal(ads.adCtaAction({cta:'View Profile',destination:'https://example.com',profileUsername:null}),null,'no profile, no action');
 assert.equal(ads.adCtaAction({cta:'View Profile',destination:null,profileUsername:'bad name/../x'}),null);
 assert.deepEqual(plain(ads.adCtaAction({cta:'Shop Now',destination:'https://shop.example.com/sale'})),{kind:'link',url:'https://shop.example.com/sale'});
 for(const destination of [null,'','http://example.com','javascript:alert(1)','https://exa mple.com'])
  assert.equal(ads.adCtaAction({cta:'Learn More',destination}),null,String(destination));
});

test('ad events are batched, de-duplicated and never block: a hide is sent at once',()=>{
 const {ads,calls,runTimers}=fixture();
 ads.recordAd('d1','ad_rendered',0,'t');ads.recordAd('d1','ad_rendered',0,'t');ads.recordAd('d1','ad_impression',1200.7,'t');
 assert.equal(calls.post.length,0,'waits for the batch window');
 runTimers();
 assert.deepEqual(calls.post.map(p=>p.body.events),[[{deliveryId:'d1',event:'ad_rendered',visibleMs:0},{deliveryId:'d1',event:'ad_impression',visibleMs:1200}]]);
 ads.recordAd('d2','ad_hide',-5,'t');
 assert.deepEqual(calls.post[1].body.events,[{deliveryId:'d2',event:'ad_hide',visibleMs:0}],'hides flush immediately');
});
