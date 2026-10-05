const {chromium}=require('playwright-core');
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
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1365,height:960}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function login(email){await page.goto(base+'/admin/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(email===superEmail?superPassword:'correcthorsebattery');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(base+'/admin');await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();}
 await login(superEmail);await page.getByText('Moderation queue',{exact:true}).waitFor();await page.screenshot({path:output+'/admin-dashboard.png',fullPage:true});
 await page.getByRole('button',{name:'Admins',exact:true}).click();await page.getByRole('button',{name:'Add Admin',exact:true}).click();await page.getByLabel('Account ID',{exact:true}).fill(admin.user.id);
 for(const permission of ['reports.read','reports.review','content.remove','moderation.history.read'])await page.getByLabel(permission,{exact:true}).check();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Confirm access change',exact:true}).click();await page.getByRole('button',{name:'Add Admin',exact:true}).waitFor();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL(base+'/admin/login');await login(admin.input.email);
 assert.equal(await page.getByRole('button',{name:'Admins',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Ads',exact:true}).count(),0);
 await page.getByRole('button',{name:'Reports',exact:true}).click();await page.getByPlaceholder('Search ID or username / campaign name').fill(report.id);await page.getByRole('button',{name:'Search',exact:true}).click();await page.locator('article').filter({hasText:report.id}).getByRole('button',{name:'Review report',exact:true}).click();await page.getByText('UI moderation verification',{exact:true}).first().waitFor();
 await page.getByPlaceholder('Reason and moderator notes').fill('Confirmed test review');await page.screenshot({path:output+'/admin-report-review.png',fullPage:true});page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Remove content',exact:true}).click();await page.getByRole('button',{name:'Filter',exact:true}).waitFor();
 const hidden=await fetch(base+'/api/v1/stories/'+published.story.id,{headers:{Authorization:'Bearer '+reporter.tokens.accessToken}});assert.equal(hidden.status,404);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL(base+'/admin/login');await login(superEmail);await page.getByRole('button',{name:'Audit Logs',exact:true}).click();await page.getByText('MODERATION_REMOVE',{exact:true}).first().waitFor();
 await page.getByRole('button',{name:'Ads',exact:true}).click();await page.getByRole('button',{name:'New campaign',exact:true}).click();await page.getByRole('heading',{name:'Create campaign',exact:true}).waitFor();await page.screenshot({path:output+'/admin-campaign-form.png',fullPage:true});
 assert.deepEqual(errors,[]);await browser.close();fs.writeFileSync(output+'/browser-results.json',JSON.stringify({passed:['Super Admin login','dashboard real data','create limited Admin with explicit confirmation','limited navigation','report review/media preview','remove Story and verify consumer 404','audit history visible','campaign creation form'],pageErrors:errors},null,2));console.log('8 browser checks passed; no page errors.');
})().catch(e=>{console.error(e);process.exit(1);});
