'use strict';
const fs=require('node:fs'),path=require('node:path');

function validateRelease({root,platform='all',env=process.env,checkSigning=false}) {
 const c=JSON.parse(fs.readFileSync(path.join(root,'build-config.json'),'utf8'));
 const problems=[];
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const rn=pkg.dependencies?.['react-native']??'';
 if(Number(/^0\.(\d+)\./.exec(rn)?.[1]??0)<77)problems.push('Upgrade React Native to a supported release with 16 KB native-library support.');
 for(const key of ['privacyPolicyUrl','termsUrl','supportUrl']) {
  try {
   const u=new URL(c[key]);
   if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost'||/(^|\.)(example\.(com|org|net)|invalid|test|local)$/.test(u.hostname))throw Error();
  } catch {problems.push('Configure '+key+' with your live public HTTPS page.');}
 }
 try {
  const u=new URL(c.productionApiUrl),h=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||
   h==='localhost'||h.endsWith('.localhost')||h==='[::1]'||h==='[::]'||h==='0.0.0.0'||
   /^127\./.test(h)||/(^|\.)(example\.(com|org|net)|invalid|test|local)$/.test(h))throw Error();
 } catch {problems.push('Set productionApiUrl to your deployed HTTPS API origin (no path, credentials, query or fragment).');}
 if(c.releaseIdentifiersConfirmed!==true)problems.push('Confirm your permanent application identifiers in build-config.json.');
 function identifier(key) {
  if(typeof c[key]!=='string'||!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*){2,}$/.test(c[key])||c[key].includes('development')) {
   problems.push('Set '+key+' to your permanent release identifier.');
  }
 }
 if(platform==='android'||platform==='all') {
  identifier('androidApplicationId');
  const gradle=fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8');
  if(!gradle.includes('applicationId "'+c.androidApplicationId+'"'))problems.push('Android applicationId differs from build-config.json.');
  const native=fs.readFileSync(path.join(root,'android/build.gradle'),'utf8');
  if(Number(/targetSdkVersion\s*=\s*(\d+)/.exec(native)?.[1]??0)<36)problems.push('Upgrade and test the Android toolchain for Play target API 36; changing this number alone is insufficient.');
  if(Number(/compileSdkVersion\s*=\s*(\d+)/.exec(native)?.[1]??0)<36)problems.push('Android compileSdkVersion must support API 36.');
  const catalog=path.join(root,'node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml');
  const agp=/com.android.tools.build:gradle:([\d.]+)/.exec(native)?.[1]??(fs.existsSync(catalog)?/agp\s*=\s*"([\d.]+)"/.exec(fs.readFileSync(catalog,'utf8'))?.[1]:undefined);
  const parts=(agp??'0.0.0').split('.').map(Number);
  if(!/^\d+\.\d+\.\d+$/.test(agp??'')||parts[0]<8||(parts[0]===8&&(parts[1]<9||(parts[1]===9&&parts[2]<1))))problems.push('API 36 requires Android Gradle Plugin 8.9.1 or newer; upgrade the coordinated native toolchain.');
  if(checkSigning) {
   for(const key of ['KATKEE_UPLOAD_STORE_FILE','KATKEE_UPLOAD_STORE_PASSWORD','KATKEE_UPLOAD_KEY_ALIAS','KATKEE_UPLOAD_KEY_PASSWORD'])if(!env[key]?.trim())problems.push('Configure '+key+' in your private build environment.');
   const file=env.KATKEE_UPLOAD_STORE_FILE;
   if(file) {
    if(!path.isAbsolute(file)||!fs.existsSync(file)||!fs.statSync(file).isFile())problems.push('Android upload keystore must be an existing file at an absolute path.');
    else {
     const template=path.join(root,'android/app/debug.keystore');
     if(fs.existsSync(template)&&fs.readFileSync(template).equals(fs.readFileSync(file)))problems.push('The public template debug keystore cannot sign a release.');
    }
   }
   if(env.KATKEE_UPLOAD_KEY_ALIAS==='androiddebugkey')problems.push('Use a private release key, not androiddebugkey.');
  }
 }
 if(platform==='ios'||platform==='all') {
  identifier('iosBundleId');
  const project=fs.readFileSync(path.join(root,'ios/KatkeeMobile.xcodeproj/project.pbxproj'),'utf8');
  if(!project.includes('PRODUCT_BUNDLE_IDENTIFIER = "'+c.iosBundleId+'"'))problems.push('Xcode bundle identifier differs from build-config.json.');
  const icons=path.join(root,'ios/KatkeeMobile/Images.xcassets/AppIcon.appiconset');
  const contents=path.join(icons,'Contents.json');
  const entries=fs.existsSync(contents)?JSON.parse(fs.readFileSync(contents,'utf8')).images??[]:[];
  if(!entries.length||entries.some(entry=>!entry.filename||!fs.existsSync(path.join(icons,entry.filename))))problems.push('Populate the iOS AppIcon catalog with approved artwork.');
  const privacy=path.join(root,'ios/KatkeeMobile/PrivacyInfo.xcprivacy');
  if(!fs.existsSync(privacy)||/NSPrivacyCollectedDataTypes<\/key>\s*(<array\s*\/>|<array>\s*<\/array>)/.test(fs.readFileSync(privacy,'utf8')))problems.push('Complete the iOS privacy manifest and store disclosures for actual data collection.');
 }
 return problems;
}

if(require.main===module) {
 const args=process.argv.slice(2);
 if(args.some(a=>!['--android','--ios'].includes(a))||(args.includes('--android')&&args.includes('--ios'))) {
  console.error('Usage: node scripts/check-release.cjs [--android | --ios]');process.exitCode=1;
 } else {
  const platform=args.includes('--android')?'android':args.includes('--ios')?'ios':'all';
  try {
   const problems=validateRelease({root:path.resolve(__dirname,'..'),platform,checkSigning:platform!=='ios'});
   if(problems.length){console.error('Release is blocked:\n- '+problems.join('\n- '));process.exitCode=1;}
   else console.log('Configuration checks passed only. Native builds, provider checks and device acceptance are still required.');
  }catch(e){console.error('Release configuration could not be checked: '+e.message);process.exitCode=1;}
 }
}
module.exports={validateRelease};
