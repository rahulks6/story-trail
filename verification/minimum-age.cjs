// Katkee is for people 18 and older (Phase 14, India launch), and Rahul Katakdhond is its operator
// and Grievance Officer. The rule lives in several places that must agree: the server
// (backend/src/modules/auth/age.ts), the app's copy (mobile/src/utils/birthDate.ts), the Terms,
// the Privacy Policy, the website and the store guides. This checks they do.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

/** MINIMUM_AGE and the three messages, as written in a TypeScript source file. */
function ageRule(file){
 const source=read(file);
 const age=/export const MINIMUM_AGE = (\d+);/.exec(source);
 const block=/export const BIRTH_DATE_MESSAGES = \{([\s\S]*?)\} as const;/.exec(source);
 assert.ok(age&&block,`${file}: MINIMUM_AGE and BIRTH_DATE_MESSAGES`);
 const messages=Object.fromEntries([...block[1].matchAll(/(\w+): ["`]([^"`]+)["`]/g)].map(([,key,text])=>[key,text.replace('${MINIMUM_AGE}',age[1])]));
 return {age:Number(age[1]),messages};
}

test('the server and the app apply the same rule: 18, with the same messages',()=>{
 const server=ageRule('backend/src/modules/auth/age.ts'),app=ageRule('mobile/src/utils/birthDate.ts');
 assert.equal(server.age,18);
 assert.deepEqual(app,server);
 assert.deepEqual(Object.keys(server.messages).sort(),['invalid','required','tooYoung']);
 assert.equal(server.messages.tooYoung,'Katkee is only for people 18 and older.');
 // Both count the day in India (UTC+05:30).
 for(const file of ['backend/src/modules/auth/age.ts','mobile/src/utils/birthDate.ts'])assert.match(read(file),/330 \* 60_000/,file);
});

test('the Terms, the Privacy Policy and the website say 18 and older, and nothing younger',()=>{
 const site=JSON.parse(read('website/site.json'));
 assert.equal(site.minimumAge,18);
 assert.match(read('legal/TERMS_OF_SERVICE.md'),/## 2\. Eligibility: 18 and older\n\nKatkee is only for adults\. You must be at least 18 years old/);
 assert.match(read('legal/PRIVACY_POLICY.md'),/## 9\. Katkee is for adults \(18 and older\)\n\nKatkee is only for people 18 and older\./);
 assert.match(read('website/public/index.html'),/Katkee is for people 18 and older\./);
 assert.match(read('website/public/support.html'),/<summary>How old do I need to be\?<\/summary>\n<p>18 or older\./);
 // An age below 18 ("13 and older", "under 13", "13+ "), but not a platform version ("Android 12+").
 const younger=/\b(1[0-7]|[1-9]) (and|or) older\b|\bunder 1[0-7]\b|(?<!(Android|iOS) )\b1[0-7]\+ /i;
 const files=['legal/TERMS_OF_SERVICE.md','legal/PRIVACY_POLICY.md','legal/README.md','LAUNCH.md','STORE_LISTING.md',
  'docs/GOOGLE_PLAY_DEPLOYMENT.md','docs/IOS_APP_STORE_DEPLOYMENT.md',
  ...fs.readdirSync(path.join(root,'website/src/pages')).map((f)=>`website/src/pages/${f}`),'website/src/layout.html'];
 for(const file of files){
  const hit=read(file).split('\n').find((line)=>younger.test(line));
  assert.equal(hit,undefined,`${file} still names a younger minimum age`);
 }
 assert.match(read('docs/GOOGLE_PLAY_DEPLOYMENT.md'),/age group \*\*18 and over\*\* only/);
});

test('the operator and Grievance Officer are named the same everywhere',()=>{
 const site=JSON.parse(read('website/site.json'));
 assert.equal(site.grievanceOfficer,'Rahul Katakdhond');
 assert.deepEqual(site.operator,{name:'Rahul Katakdhond',form:'sole proprietorship',country:'India'});
 const terms=read('legal/TERMS_OF_SERVICE.md'),privacy=read('legal/PRIVACY_POLICY.md');
 const operated=`operated by ${site.operator.name}, a ${site.operator.form} registered`;
 assert.ok(terms.includes(`Katkee is ${operated}`)&&privacy.includes(`Katkee is ${operated}`));
 assert.match(terms,/## 12\. Grievances[\s\S]*- \*\*Name\*\*: Rahul Katakdhond\n- \*\*Email\*\*: grievance@katkee\.com/);
 assert.match(terms,/Grievance Appellate Committee[\s\S]*30 days/);
 assert.match(privacy,/\*\*Grievance Officer \(India\)\*\*: Rahul Katakdhond, grievance@katkee\.com/);
 assert.ok(read('website/public/support.html').includes('<p>Rahul Katakdhond<br><a href="mailto:grievance@katkee.com">'));
 assert.ok(read('website/public/index.html').includes(`Operated by ${site.operator.name}, a ${site.operator.form} registered in ${site.operator.country}.`));
 assert.equal(site.contact.grievance,'grievance@katkee.com');
});

test('the store answers declare the date of birth',()=>{
 assert.match(read('mobile/ios/KatkeeMobile/PrivacyInfo.xcprivacy'),/<!-- Date of birth[^>]*-->\s*<dict>\s*<key>NSPrivacyCollectedDataType<\/key>\s*<string>NSPrivacyCollectedDataTypeOtherDataTypes<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>\s*<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>/);
 assert.match(read('docs/IOS_APP_STORE_DEPLOYMENT.md'),/\| Other Data Types \(date of birth/);
 assert.match(read('docs/GOOGLE_PLAY_DEPLOYMENT.md'),/\| Personal info: Other info \(date of birth/);
 assert.match(read('legal/PRIVACY_POLICY.md'),/display name, \*\*date of birth\*\*/);
});

test('anyone can report an account as "May be under 18", in the app, on the server and in the database',()=>{
 const app=read('mobile/src/api/moderation.ts'),dto=read('backend/src/modules/moderation/dto.ts'),migration=read('backend/migrations/0040_minimum_age.sql');
 const quoted=(text)=>[...text.matchAll(/"([a-z_0-9]+)"/g)].map((m)=>m[1]);
 const serverReasons=quoted(/export const REPORT_REASONS: ReportReason\[\] = \[([^\]]+)\]/.exec(dto)[1]);
 const appReasons=[...app.matchAll(/\{ value: "([a-z_0-9]+)", label: "([^"]+)" \}/g)].map((m)=>m[1]);
 const appType=quoted(/export type ReportReason = ([^;]+);/.exec(app)[1]);
 const databaseReasons=[.../reports_reason_valid CHECK \(reason IN \(([^)]+)\)\)/.exec(migration)[1].matchAll(/'([a-z_0-9]+)'/g)].map((m)=>m[1]);
 assert.ok(serverReasons.includes('under_18'));
 assert.deepEqual(appReasons,serverReasons,'the app offers exactly the reasons the server accepts');
 assert.deepEqual(appType,serverReasons);
 assert.deepEqual(databaseReasons,serverReasons);
 assert.match(app,/\{ value: "under_18", label: "May be under 18" \}/);
 assert.match(migration,/WHEN 'under_18' THEN 2/);
});
