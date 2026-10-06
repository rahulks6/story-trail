const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {validateRelease}=require('../mobile/scripts/check-release.cjs');
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'katkee-release-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config={productionApiUrl:'https://api.katkee.app',androidApplicationId:'com.katkee.app',iosBundleId:'com.katkee.app',appVersion:'1.2.0',releaseIdentifiersConfirmed:true,privacyPolicyUrl:'https://katkee.app/privacy',termsUrl:'https://katkee.app/terms',supportUrl:'https://katkee.app/support'};
 function write(name,data){const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
 const save=()=>write('build-config.json',JSON.stringify(config));save();
 write('android/app/build.gradle','applicationId "com.katkee.app"\ndef v = new groovy.json.JsonSlurper().parse(file("../../build-config.json")).appVersion\nversionName katkeeVersionName');
 write('package.json',JSON.stringify({dependencies:{'react-native':'0.87.1'}}));
 write('android/build.gradle','targetSdkVersion = 36\ncompileSdkVersion = 36\nclasspath("com.android.tools.build:gradle:8.9.1")');
 write('ios/KatkeeMobile/Images.xcassets/AppIcon.appiconset/Contents.json',JSON.stringify({images:[{filename:'icon.png'}]}));
 write('ios/KatkeeMobile/Images.xcassets/AppIcon.appiconset/icon.png','fixture');
 write('ios/KatkeeMobile/PrivacyInfo.xcprivacy','<plist><dict><key>NSPrivacyCollectedDataTypes</key><array><dict/></array></dict></plist>');
 write('android/app/debug.keystore','public-test-key');
 write('ios/KatkeeMobile.xcodeproj/project.pbxproj','PRODUCT_BUNDLE_IDENTIFIER = "com.katkee.app"\nMARKETING_VERSION = 1.2.0;\nMARKETING_VERSION = 1.2.0;');
 const check=(platform='android',env={},checkSigning=false)=>validateRelease({root,platform,env,checkSigning});
 return {root,config,save,write,check};
}
test('Android checks do not require an iOS identifier or project',t=>{
 const f=fixture(t);delete f.config.iosBundleId;f.save();fs.rmSync(path.join(f.root,'ios'),{recursive:true});assert.deepEqual(f.check(),[]);
});
test('iOS checks do not require Android SDK target or signing',t=>{
 const f=fixture(t);delete f.config.androidApplicationId;f.save();fs.rmSync(path.join(f.root,'android'),{recursive:true});assert.deepEqual(f.check('ios'),[]);
});
test('release rejects placeholder origins, paths and embedded credentials',t=>{
 const f=fixture(t);
 for(const url of ['http://api.katkee.app','https://localhost','https://127.0.0.1','https://[::1]','https://example.com','https://api.invalid','https://api.katkee.app/api','https://user:secret@api.katkee.app','https://api.katkee.app?x=y']) {
  f.config.productionApiUrl=url;f.save();assert.ok(f.check().some(x=>x.includes('HTTPS API origin')),url);
 }
});
test('missing signing inputs and development identifiers block release',t=>{
 const f=fixture(t);f.config.androidApplicationId='com.katkee.development';f.config.releaseIdentifiersConfirmed=false;f.save();
 const problems=f.check('android',{},true);assert.ok(problems.some(p=>p.includes('permanent release identifier')));assert.equal(problems.filter(p=>p.startsWith('Configure KATKEE_')).length,4);
});
test('a renamed copy of the public debug key is rejected',t=>{
 const f=fixture(t);f.write('renamed-key.jks','public-test-key');
 const problems=f.check('android',{KATKEE_UPLOAD_STORE_FILE:path.join(f.root,'renamed-key.jks'),KATKEE_UPLOAD_STORE_PASSWORD:'test',KATKEE_UPLOAD_KEY_PASSWORD:'test',KATKEE_UPLOAD_KEY_ALIAS:'private-looking'},true);
 assert.ok(problems.some(p=>p.includes('public template debug keystore')));
});
test('outdated native target and native identifier mismatch remain blocked',t=>{
 const f=fixture(t);f.write('android/build.gradle','targetSdkVersion = 34');f.write('android/app/build.gradle','applicationId "com.wrong.app"');const problems=f.check();
 assert.ok(problems.some(p=>p.includes('target API 36')));assert.ok(problems.some(p=>p.includes('differs')));
});
test('API 36 alone cannot clear an old framework and AGP',t=>{
 const f=fixture(t);f.write('package.json',JSON.stringify({dependencies:{'react-native':'0.75.4'}}));
 f.write('android/build.gradle','targetSdkVersion = 36\ncompileSdkVersion = 36\nclasspath("com.android.tools.build:gradle:8.5.0")');
 assert.ok(f.check().some(p=>p.includes('React Native')));assert.ok(f.check().some(p=>p.includes('8.9.1')));
});
test('missing iOS icons and empty privacy declaration block release',t=>{
 const f=fixture(t);f.write('ios/KatkeeMobile/Images.xcassets/AppIcon.appiconset/Contents.json','{"images":[{}]}');
 f.write('ios/KatkeeMobile/PrivacyInfo.xcprivacy','<key>NSPrivacyCollectedDataTypes</key><array/>');
 assert.ok(f.check('ios').some(p=>p.includes('AppIcon')));assert.ok(f.check('ios').some(p=>p.includes('privacy manifest')));
});
test('policy links and boolean confirmation are required',t=>{
 const f=fixture(t);f.config.privacyPolicyUrl='https://example.com';f.config.releaseIdentifiersConfirmed='false';f.save();
 assert.ok(f.check().some(p=>p.includes('privacyPolicyUrl')));assert.ok(f.check().some(p=>p.includes('Confirm')));
});

test('one release version: build-config appVersion drives Android and must match Xcode',t=>{
 const f=fixture(t);assert.deepEqual(f.check('all'),[]);
 for(const bad of [undefined,'1.2','v1.2.0','1.2.0-beta']){f.config.appVersion=bad;f.save();assert.ok(f.check('all').some(x=>x.includes('Set appVersion')),String(bad));}
 f.config.appVersion='1.3.0';f.save();assert.deepEqual(f.check('ios'),['Xcode MARKETING_VERSION differs from build-config.json appVersion.']);
 f.config.appVersion='1.2.0';f.save();f.write('android/app/build.gradle','applicationId "com.katkee.app"\nversionName "1.0"');
 assert.deepEqual(f.check('android'),['Android versionName must come from build-config.json appVersion.']);
});
