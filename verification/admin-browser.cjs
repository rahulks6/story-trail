const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const {totp}=require('../backend/dist/src/modules/admin/totp');
const {randomUUID}=require('node:crypto');const fs=require('node:fs');const assert=require('node:assert/strict');
const base=process.env.KATKEE_TEST_BASE||'http://127.0.0.1:4173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('This fixture-creating test must use an isolated loopback server.');
const superEmail=process.env.KATKEE_TEST_SUPER_EMAIL,superPassword=process.env.KATKEE_TEST_SUPER_PASSWORD;
if(!superEmail||!superPassword)throw Error('Provide credentials for an existing isolated-test Super Admin.');
const output=process.env.KATKEE_TEST_OUTPUT||'browser-results';fs.mkdirSync(output,{recursive:true});
async function api(path,method='GET',body,token){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=r.status===204?null:await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
async function user(){const id=randomUUID().slice(0,8);const input={username:'ui_'+id,email:'ui_'+id+'@example.com',password:'correcthorsebattery',displayName:'UI test operator'};const data=await api('/api/v1/auth/signup','POST',input);return {...data,input};}
(async()=>{
 const admin=await user(),owner=await user(),reporter=await user();const png=require('../backend/dist/test/fixtures').buildTestPng(4,4);
 const uploaded=await fetch(base+'/api/v1/media/photos',{method:'POST',headers:{'Content-Type':'image/png',Authorization:'Bearer '+owner.tokens.accessToken},body:png});const media=(await uploaded.json()).media;
 const published=await api('/api/v1/stories','POST',{mediaId:media.id,caption:'UI moderation verification',audience:'public',allowComments:'everyone',allowSharing:true},owner.tokens.accessToken);
 const report=(await api('/api/v1/reports','POST',{targetType:'story',targetId:published.story.id,reason:'spam'},reporter.tokens.accessToken)).report;
 const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),headless:true});
 const context=await browser.newContext({viewport:{width:1365,height:960}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Blocked resources, Trusted Types and integrity failures are reported to the console, not thrown.
 page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|Trusted Type|integrity|digest/i.test(m.text()))errors.push('console: '+m.text());});
 if(process.env.KATKEE_ADMIN_BUILD==='1'){
  await page.goto(base+'/admin/login');
  const loaded=await page.evaluate(()=>({script:document.querySelector('script[src^="/admin/assets/app."][integrity^="sha384-"]')!==null,style:document.querySelector('link[href^="/admin/assets/style."][integrity^="sha384-"]')!==null,styled:getComputedStyle(document.body).display==='flex'}));
  assert.deepEqual(loaded,{script:true,style:true,styled:true},'the production build loads its versioned, integrity-checked assets');
 }
 // Second factor like a real operator: scan-equivalent (read the setup key), then backup codes on later sign-ins.
 const backupCodes=new Map();
 async function login(email){await page.goto(base+'/admin/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(email===superEmail?superPassword:'correcthorsebattery');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const step=await Promise.race([page.getByRole('heading',{name:'Set up two-step verification',exact:true}).waitFor().then(()=>'enroll'),page.getByRole('heading',{name:'Two-step verification',exact:true}).waitFor().then(()=>'verify')]);
  if(step==='enroll'){assert.equal(await page.locator('svg.qr').count(),1,'QR code rendered');if(email===superEmail)await page.screenshot({path:output+'/admin-mfa-enroll.png',fullPage:true});await page.getByText("Can't scan? Enter this key").click();const key=(await page.locator('details code').innerText()).replace(/\s+/g,'');
   await page.getByLabel('6-digit code',{exact:true}).fill(totp(key));await page.getByRole('button',{name:'Verify and finish setup',exact:true}).click();await page.getByRole('heading',{name:'Save your backup codes',exact:true}).waitFor();
   if(email===superEmail)await page.screenshot({path:output+'/admin-mfa-backup-codes.png',fullPage:true});backupCodes.set(email,await page.locator('ol.codes li').allInnerTexts());assert.equal(backupCodes.get(email).length,10);await page.getByRole('button',{name:'I saved these codes — continue',exact:true}).click();}
  else{if(email===superEmail)await page.screenshot({path:output+'/admin-mfa-verify.png',fullPage:true});await page.getByLabel('Authenticator code or backup code',{exact:true}).fill(backupCodes.get(email).shift());await page.getByRole('button',{name:'Verify',exact:true}).click();}
  await page.waitForURL(base+'/admin');await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();}
 await login(superEmail);await page.getByText('Moderation queue',{exact:true}).waitFor();await page.screenshot({path:output+'/admin-dashboard.png',fullPage:true});
 await page.getByRole('button',{name:'Admins',exact:true}).click();await page.getByRole('button',{name:'Add Admin',exact:true}).click();await page.getByLabel('Account ID',{exact:true}).fill(admin.user.id);
 for(const permission of ['reports.read','reports.review','content.remove','moderation.history.read'])await page.getByLabel(permission,{exact:true}).check();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Confirm access change',exact:true}).click();await page.getByRole('button',{name:'Add Admin',exact:true}).waitFor();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL(base+'/admin/login');await login(admin.input.email);
 assert.equal(await page.getByRole('button',{name:'Admins',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Ads',exact:true}).count(),0);
 await page.getByRole('button',{name:'Reports',exact:true}).click();await page.getByPlaceholder('Search ID or username / campaign name').fill(report.id);await page.getByRole('button',{name:'Search',exact:true}).click();await page.locator('article').filter({hasText:report.id}).getByRole('button',{name:'Review report',exact:true}).click();await page.getByText('UI moderation verification',{exact:true}).first().waitFor();
 await page.getByPlaceholder('Reason for your decision').fill('Confirmed test review');await page.screenshot({path:output+'/admin-report-review.png',fullPage:true});page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Remove content',exact:true}).click();await page.getByRole('button',{name:'Filter',exact:true}).waitFor();
 const hidden=await fetch(base+'/api/v1/stories/'+published.story.id,{headers:{Authorization:'Bearer '+reporter.tokens.accessToken}});assert.equal(hidden.status,404);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL(base+'/admin/login');await login(superEmail);await page.getByRole('button',{name:'Audit Logs',exact:true}).click();await page.getByText('MODERATION_REMOVE',{exact:true}).first().waitFor();
 await page.getByRole('button',{name:'Verify integrity',exact:true}).click();await page.getByText(/^Audit chain intact: \d+ records/).waitFor();await page.screenshot({path:output+'/admin-audit-verify.png',fullPage:true});
 await page.getByRole('button',{name:'Security',exact:true}).click();await page.getByRole('heading',{name:'Your two-step verification',exact:true}).waitFor();await page.screenshot({path:output+'/admin-security.png',fullPage:true});
 // Analytics: server-side totals; Refresh runs the worker's rollup. The Story owner and the reporter
 // used the app today; Admin console sessions are not consumer activity.
 await page.getByRole('button',{name:'Analytics',exact:true}).click();await page.getByRole('heading',{name:'Retention',exact:true}).waitFor();
 await page.getByRole('button',{name:'Refresh now',exact:true}).click();await page.getByText('Analytics refreshed.',{exact:true}).waitFor();
 const dau=Number((await page.locator('article').filter({has:page.getByRole('heading',{name:'Daily active users',exact:true})}).locator('.metric').innerText()).replace(/,/g,''));
 assert.equal(dau,2,'today counts the two people who used the app, not Admin console sessions');
 assert.ok(await page.locator('svg.chart rect').count()>=1,'active users chart');
 await page.locator('table').first().getByRole('cell',{name:new Date().toISOString().slice(0,10),exact:true}).waitFor();
 assert.equal(await page.getByRole('cell',{name:'pending',exact:true}).count()>=1,true,"today's signups show retention as pending");
 await page.screenshot({path:output+'/admin-analytics.png',fullPage:true});
 await page.getByRole('button',{name:'Ads',exact:true}).click();await page.getByRole('button',{name:'New advertiser',exact:true}).click();await page.getByLabel('Advertiser name',{exact:true}).fill('UI test advertiser');await page.getByLabel('Public Katkee account ID',{exact:true}).fill(owner.user.id);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Create advertiser',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'New campaign',exact:true}).click();await page.getByRole('heading',{name:'Create campaign',exact:true}).waitFor();await page.screenshot({path:output+'/admin-campaign-form.png',fullPage:true});
 // A real video creative: the console waits for processing (poster, renditions) before saving the draft.
 const video=output+'/creative.mp4';require('node:child_process').execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','2','-c:v','libx264','-pix_fmt','yuv420p',video]);
 const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
 // The wizard: Details → Creative → Audience → Budget & schedule → Preview & review.
 await page.getByLabel('Campaign name',{exact:true}).fill('UI video creative');await page.locator('select[name=advertiserId]').selectOption({label:'UI test advertiser'});
 await page.getByRole('button',{name:'Next: Creative',exact:true}).click();
 assert.equal(await page.getByLabel('Campaign name',{exact:true}).isVisible(),false,'only the current wizard step is shown');
 await page.getByLabel('Photo / video',{exact:true}).setInputFiles(video);await page.getByLabel('Caption',{exact:true}).fill('Two-second test creative');
 await page.getByLabel('Public HTTPS destination',{exact:true}).fill('https://example.com/offer');
 await page.getByRole('button',{name:'Next: Audience',exact:true}).click();
 await page.getByLabel('Travel',{exact:true}).check();await page.getByLabel('Android',{exact:true}).check();
 await page.getByRole('button',{name:'Next: Budget & schedule',exact:true}).click();
 await page.getByLabel('Start',{exact:true}).fill(local(new Date(Date.now()+3600e3)));await page.getByLabel('End',{exact:true}).fill(local(new Date(Date.now()+7*86400e3)));
 await page.getByRole('button',{name:'Next: Preview & review',exact:true}).click();
 await page.getByText('Interested in Travel',{exact:true}).waitFor();await page.screenshot({path:output+'/admin-campaign-preview.png',fullPage:true});
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Upload and save draft',exact:true}).click();
 try{await page.getByText(/^Processing video/).waitFor({timeout:30000});}
 catch(e){await page.screenshot({path:output+'/failure-campaign.png',fullPage:true});
  console.error('message:',await page.locator('#message').innerText(),'invalid fields:',await page.evaluate(()=>[...document.querySelectorAll('form :invalid')].map(n=>n.name+'='+n.validationMessage)));throw e;}
 try{await page.getByText('UI video creative').first().waitFor({timeout:120000});}
 catch(e){await page.screenshot({path:output+'/failure-campaign-save.png',fullPage:true});console.error('message:',await page.locator('#message').innerText());throw e;}await page.screenshot({path:output+'/admin-campaign-video-draft.png',fullPage:true});
 assert.deepEqual(errors,[]);await browser.close();const passed=['Super Admin sign-in with TOTP enrollment (QR + setup key) and backup codes','dashboard real data','create limited Admin with explicit confirmation','limited Admin enrolls MFA and sees limited navigation','report review/media preview','analytics dashboard: live DAU/WAU/MAU, daily totals, retention and refresh','remove Story and verify consumer 404','Super Admin repeat sign-in with a backup code','audit history visible','audit hash chain verified from the console','Security page','advertiser creation','campaign creation form','campaign wizard: audience (broad categories, platforms) and preview summary','video creative processed before the draft is saved'];
 if(process.env.KATKEE_ADMIN_BUILD==='1')passed.unshift('production build: versioned assets with integrity under a Trusted Types CSP, no violations');
 fs.writeFileSync(output+'/browser-results.json',JSON.stringify({passed,pageErrors:errors},null,2));console.log(passed.length+' browser checks passed; no page errors.');
})().catch(e=>{console.error(e);process.exit(1);});
