'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {checkPaths}=require('../verification/elf-alignment.cjs');
const root=path.resolve(__dirname,'..'),platform=process.argv[2];
if(process.argv.length!==3||!['android','android-release','ios'].includes(platform)){console.error('Usage: node scripts/build-native.cjs android|android-release|ios');process.exit(2);}
const folder=path.join(root,'docs','native-builds',new Date().toISOString().replace(/[:.]/g,'-')+'-'+platform);
fs.mkdirSync(folder,{recursive:true});
const results=[];
function run(name,command,args,cwd,timeout=30*60*1000){
 console.log(name+' started; log: '+path.relative(root,path.join(folder,name+'.log')));
 const fd=fs.openSync(path.join(folder,name+'.log'),'w');
 const started=Date.now();
 const r=cp.spawnSync(command,args,{cwd,env:process.env,stdio:['ignore',fd,fd],timeout});
 if(r.error)fs.writeSync(fd,'\n'+r.error.message+'\n');fs.closeSync(fd);
 const passed=r.status===0&&!r.error;
 results.push({name,status:passed?'passed':'failed',exitCode:r.status,durationMs:Date.now()-started});
 console.log(name+': '+(passed?'passed':'failed'));return passed;
}
let artifact=null,reason=null;
const artifacts=[],checks=[];
/** 16 KB ELF alignment for every 64-bit library, plus zipalign -P 16 for APKs when build-tools exist. */
function verifyAndroidArtifact(file,sdk){
 const report=checkPaths([file]);
 const name=path.basename(file);
 fs.writeFileSync(path.join(folder,name+'.elf-alignment.json'),JSON.stringify(report,null,2)+'\n');
 checks.push({name:'16kb-elf-alignment:'+name,status:report.passed?'passed':'failed',librariesChecked:report.librariesChecked,failures:report.failures.length});
 let passed=report.passed;
 const tools=path.join(sdk,'build-tools');
 const version=fs.existsSync(tools)?fs.readdirSync(tools).sort().pop():null;
 if(file.endsWith('.apk')&&version){
  passed=run('zipalign-16kb-'+name,path.join(tools,version,'zipalign'),['-c','-P','16','-v','4',file],root,5*60*1000)&&passed;
  if(platform==='android-release')passed=run('apksigner-verify-'+name,path.join(tools,version,'apksigner'),['verify','--verbose','--print-certs',file],root,5*60*1000)&&passed;
 }
 return passed;
}
try {
 if(platform==='android'||platform==='android-release'){
  for(const tool of ['javac','jlink']){
   const check=cp.spawnSync(tool,['--version'],{encoding:'utf8',timeout:10000});
   if(check.error||check.status!==0)throw Error('Install the full JDK 17 and put '+tool+' on PATH; a Java runtime alone cannot compile Android.');
  }
  const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
  const compileSdk=/compileSdkVersion\s*=\s*(\d+)/.exec(fs.readFileSync(path.join(root,'mobile/android/build.gradle'),'utf8'))?.[1];
  if(!sdk||!compileSdk||![`android-${compileSdk}`,`android-${compileSdk}.0`].some(dir=>fs.existsSync(path.join(sdk,'platforms',dir,'android.jar'))))throw Error(`Install Android SDK platform ${compileSdk} and set ANDROID_HOME. See docs/NATIVE_BUILD_HANDOFF.md.`);
  const cwd=path.join(root,'mobile/android');
  const release=platform==='android-release';
  if(release){
   // Release signing comes only from the private environment; the Gradle preReleaseBuild guard repeats this check.
   const {validateRelease}=require('../mobile/scripts/check-release.cjs');
   const problems=validateRelease({root:path.join(root,'mobile'),platform:'android',checkSigning:true});
   if(problems.length)throw Error('Release is blocked:\n- '+problems.join('\n- '));
  }
  const tasks=release?[':app:assembleRelease',':app:bundleRelease']:[':app:assembleDebug'];
  // Maven Central intermittently answers 429; retry with backoff instead of failing the build.
  const gradleArgs=[...tasks,'--console=plain','--no-daemon','-Dorg.gradle.internal.repository.max.retries=8','-Dorg.gradle.internal.repository.initial.backoff=2000'];
  if(process.env.KATKEE_VERSION_CODE)gradleArgs.push('-PkatkeeVersionCode='+process.env.KATKEE_VERSION_CODE);
  if(process.env.KATKEE_VERSION_NAME)gradleArgs.push('-PkatkeeVersionName='+process.env.KATKEE_VERSION_NAME);
  const command=process.platform==='win32'?'cmd.exe':'sh';
  const args=process.platform==='win32'?['/d','/s','/c','gradlew.bat',...gradleArgs]:['gradlew',...gradleArgs];
  if(run(release?'assemble-and-bundle-release':'assemble-debug',command,args,cwd,90*60*1000)){
   const outputs=release?['app/build/outputs/apk/release/app-release.apk','app/build/outputs/bundle/release/app-release.aab']:['app/build/outputs/apk/debug/app-debug.apk'];
   let aligned=true;
   for(const relative of outputs){
    const p=path.join(cwd,relative);
    if(!fs.existsSync(p))throw Error('Gradle returned success without '+relative+'. Inspect build output.');
    artifacts.push({path:path.relative(root,p),bytes:fs.statSync(p).size,sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex')});
    aligned=verifyAndroidArtifact(p,sdk)&&aligned;
   }
   if(!aligned)throw Error('16 KB page-size verification failed. See *.elf-alignment.json in the evidence folder.');
   artifact=artifacts.map(a=>a.path).join(', ');
  }
 }else{
  if(process.platform!=='darwin')throw Error('iOS native compilation requires macOS with Xcode.');
  const version=cp.spawnSync('xcodebuild',['-version'],{encoding:'utf8'});
  if(version.status!==0||Number(/Xcode (\d+)/.exec(version.stdout)?.[1]??0)<26)throw Error('Select Xcode 26 or later.');
  const mobile=path.join(root,'mobile');
  if(run('bundle-check','bundle',['check'],mobile,30000)&&run('pods','bundle',['exec','pod','install'],path.join(mobile,'ios'))){
   const derived=path.join(mobile,'build/ios-native');
   if(run('simulator-build','xcodebuild',['-workspace','KatkeeMobile.xcworkspace','-scheme','KatkeeMobile','-configuration','Debug','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',derived,'CODE_SIGNING_ALLOWED=NO','build'],path.join(mobile,'ios'))){
    const p=path.join(derived,'Build/Products/Debug-iphonesimulator/KatkeeMobile.app');
    if(!fs.existsSync(p))throw Error('Xcode returned success without the expected simulator app.');
    artifact=path.relative(root,p);
   }
  }
 }
}catch(e){reason=e.message;console.error(reason);}
const report={generatedAt:new Date().toISOString(),platform,results,checks,artifacts,artifact,reason,releaseReady:false,notVerified:['production signing identity','physical-device acceptance','store submission']};
fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log('Evidence: '+path.relative(root,folder));
if(!artifact)process.exitCode=1;
else console.log((platform==='android-release'?'Signed release artifacts: ':'Development artifact: ')+artifact+'. Device acceptance is still required before store submission.');
