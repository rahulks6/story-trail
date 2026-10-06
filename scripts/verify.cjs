'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2);
if(args.some(a=>!['--bundle','--integration'].includes(a))) {
 console.error('Usage: node scripts/verify.cjs [--bundle] [--integration]');process.exit(2);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=path.join(root,'docs','test-runs',stamp);fs.mkdirSync(output,{recursive:true});
const results=[];
function run(name,cwd,argv,timeout=300000) {
 const started=Date.now();
 const result=cp.spawnSync(process.execPath,argv,{cwd:path.join(root,cwd),encoding:'utf8',timeout,maxBuffer:20*1024*1024});
 const status=result.status===0&&!result.error?'passed':'failed';
 fs.writeFileSync(path.join(output,name+'.log'),(result.stdout||'')+(result.stderr||'')+(result.error?'\n'+result.error.message:''));
 results.push({name,status,exitCode:result.status,durationMs:Date.now()-started,log:name+'.log'});
 console.log(name+': '+status);
 return status==='passed';
}
const built=run('backend-build','backend',['node_modules/typescript/bin/tsc','-p','tsconfig.json']);
run('mobile-typecheck','mobile',['node_modules/typescript/bin/tsc','--noEmit']);
// Component tests (Jest with React Native's preset) and a typecheck of the tests themselves.
run('mobile-test-typecheck','mobile',['node_modules/typescript/bin/tsc','-p','__tests__']);
// Per-test results (names, status, duration) as JSON evidence next to the log.
run('mobile-component-tests','mobile',['node_modules/jest/bin/jest.js','--ci','--json','--outputFile='+path.join(output,'mobile-component-tests.json')]);
run('source-regressions','',['--test','verification/regressions.cjs','verification/network.cjs','verification/release-config.cjs','verification/profile-metadata.cjs','verification/release-hardening.cjs','verification/secure-storage.cjs','verification/upload-queue.cjs','verification/elf-alignment.test.cjs','verification/account-links.cjs','verification/dm-outbox.cjs','verification/realtime-client.cjs','verification/dm-thread.cjs','verification/push-notifications.cjs','verification/ads-client.cjs','verification/analytics-client.cjs','verification/native-permissions.cjs','verification/server-time.cjs','verification/notification-config.cjs','verification/keyboard-avoidance.cjs','verification/accessibility-roles.cjs']);
if(built)run('ranking-unit-tests','backend',['--test','dist/test/scoring.test.js']);
// Infrastructure as code (infra/): typecheck, then the stack's properties and its contract with
// the backend's startup checks (which needs backend/dist, built above).
if(fs.existsSync(path.join(root,'infra/node_modules'))) {
 const infraBuilt=run('infra-build','infra',['node_modules/typescript/bin/tsc','-p','tsconfig.json']);
 if(infraBuilt&&built)run('infra-tests','infra',['--test','dist/test/*.test.js']);
} else results.push({name:'infra-tests',status:'failed',exitCode:null,durationMs:0,log:null,error:'infra/node_modules missing: run npm ci in infra/'});
if(args.includes('--bundle')) {
 fs.mkdirSync(path.join(root,'mobile/build'),{recursive:true});
 run('android-js-bundle','mobile',['node_modules/react-native/cli.js','bundle','--platform','android','--dev','false','--entry-file','index.js','--bundle-output','build/index.android.bundle','--assets-dest','build/android','--max-workers','2'],600000);
 run('ios-js-bundle','mobile',['node_modules/react-native/cli.js','bundle','--platform','ios','--dev','false','--entry-file','index.js','--bundle-output','build/main.jsbundle','--assets-dest','build/ios','--max-workers','2'],600000);
}
// Includes real image/video processing and local S3/SQS servers (see backend/scripts/install-media-test-servers.sh).
if(args.includes('--integration')&&built)run('database-integration','backend',['scripts/run-tests.cjs'],1800000);
const report={generatedAt:new Date().toISOString(),node:process.version,results,
 notVerified:['Android APK/AAB build and signing','iOS Xcode archive and signing','physical-device behavior and performance','live Google/SMS providers','live AWS S3/CloudFront/SQS/SES (tested against local S3/SQS servers and signature verification)','live FCM/APNs push delivery (tested against local FCM/OAuth and HTTP/2 APNs servers that verify the signed credentials)','realtime and push behavior on physical devices (background, network switches, notification taps)','production hosting on AWS (infra/ synthesized and tested, never deployed)','backup restore on AWS (drilled locally)','full product specification completion',...(!args.includes('--integration')?['database integration tests']:[])],
 releaseReady:false};
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log('Evidence: '+path.relative(root,output));
console.log('These checks do not certify a publish-ready app. See RELEASE_READINESS.md.');
process.exitCode=results.some(r=>r.status==='failed')?1:0;
