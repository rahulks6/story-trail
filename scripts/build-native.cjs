'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),platform=process.argv[2];
if(process.argv.length!==3||!['android','ios'].includes(platform)){console.error('Usage: node scripts/build-native.cjs android|ios');process.exit(2);}
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
try {
 if(platform==='android'){
  for(const tool of ['javac','jlink']){
   const check=cp.spawnSync(tool,['--version'],{encoding:'utf8',timeout:10000});
   if(check.error||check.status!==0)throw Error('Install the full JDK 17 and put '+tool+' on PATH; a Java runtime alone cannot compile Android.');
  }
  const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
  if(!sdk||!fs.existsSync(path.join(sdk,'platforms/android-36/android.jar')))throw Error('Install Android SDK platform 36 and set ANDROID_HOME. See docs/NATIVE_BUILD_HANDOFF.md.');
  const cwd=path.join(root,'mobile/android');
  const command=process.platform==='win32'?'cmd.exe':'sh';
  const args=process.platform==='win32'?['/d','/s','/c','gradlew.bat',':app:assembleDebug','--console=plain','--no-daemon']:['gradlew',':app:assembleDebug','--console=plain','--no-daemon'];
  if(run('assemble-debug',command,args,cwd)){
   const p=path.join(cwd,'app/build/outputs/apk/debug/app-debug.apk');
   if(!fs.existsSync(p))throw Error('Gradle returned success without the expected APK. Inspect build output.');
   artifact=path.relative(root,p);
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
const report={generatedAt:new Date().toISOString(),platform,results,artifact,reason,releaseReady:false,notVerified:['production signing','physical-device acceptance','store submission']};
fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log('Evidence: '+path.relative(root,folder));
if(!artifact)process.exitCode=1;
else console.log('Development artifact: '+artifact+'; this is not a signed store release.');
