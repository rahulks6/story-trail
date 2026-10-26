// Native capabilities the app's code uses must be declared: without the permission Android throws
// a SecurityException (e.g. Vibration.vibrate without VIBRATE), and iOS ends the app the first
// time it touches the camera, microphone, photos or location without a usage description.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mobile=path.join(__dirname,'../mobile');

const RULES=[
 // Haptic feedback (react-native-haptic-feedback) vibrates on Android, which needs VIBRATE.
 {name:'vibration',uses:/Vibration\.vibrate\(|from "react-native-haptic-feedback"/,android:['android.permission.VIBRATE']},
 {name:'camera',uses:/useCameraPermission\(|<Camera\b|launchCamera\(/,android:['android.permission.CAMERA'],ios:['NSCameraUsageDescription']},
 {name:'microphone',uses:/useMicrophonePermission\(/,android:['android.permission.RECORD_AUDIO'],ios:['NSMicrophoneUsageDescription']},
 {name:'location',uses:/Geolocation\.getCurrentPosition\(/,android:['android.permission.ACCESS_COARSE_LOCATION'],ios:['NSLocationWhenInUseUsageDescription']},
 {name:'photo library',uses:/launchImageLibrary\(/,ios:['NSPhotoLibraryUsageDescription']},
 // A picture or video in the system share sheet offers Save Image/Video, which iOS ends the app
 // for without this.
 {name:'saving to photos',uses:/from "react-native-share"/,ios:['NSPhotoLibraryAddUsageDescription']},
 {name:'notifications',uses:/@react-native-firebase\/messaging/,android:['android.permission.POST_NOTIFICATIONS']},
];

function sources(dir,out=[]){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);
  if(e.isDirectory())sources(p,out);else if(/\.(ts|tsx|js)$/.test(e.name))out.push(p);
 }
 return out;
}

/** Problems for code that uses a capability its manifest or Info.plist does not declare. */
function missingDeclarations(code,manifest,plist){
 const problems=[];
 for(const rule of RULES){
  if(!code.some(text=>rule.uses.test(text)))continue;
  for(const p of rule.android??[])if(!manifest.includes(`android:name="${p}"`))problems.push(`${rule.name}: AndroidManifest.xml lacks ${p}`);
  for(const k of rule.ios??[]){
   const m=new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`).exec(plist);
   if(!m||m[1].trim().length<10)problems.push(`${rule.name}: Info.plist lacks a ${k} explanation`);
  }
 }
 return problems;
}

const code=sources(path.join(mobile,'src')).map(f=>fs.readFileSync(f,'utf8'));
const manifest=fs.readFileSync(path.join(mobile,'android/app/src/main/AndroidManifest.xml'),'utf8');
const plist=fs.readFileSync(path.join(mobile,'ios/KatkeeMobile/Info.plist'),'utf8');

test('every native capability the app uses is declared on Android and iOS',()=>{
 assert.deepEqual(missingDeclarations(code,manifest,plist),[]);
});

test('the check is not vacuous: the app does use these capabilities, and a missing declaration is caught',()=>{
 for(const rule of RULES)assert.ok(code.some(t=>rule.uses.test(t)),`no code uses ${rule.name} any more; drop or update the rule`);
 assert.deepEqual(missingDeclarations(code,manifest.replace(/<uses-permission android:name="android.permission.VIBRATE" \/>/,''),plist),['vibration: AndroidManifest.xml lacks android.permission.VIBRATE']);
 assert.deepEqual(missingDeclarations(code,manifest,plist.replace(/<key>NSCameraUsageDescription<\/key>\s*<string>[^<]*<\/string>/,'')),['camera: Info.plist lacks a NSCameraUsageDescription explanation']);
});

test('location is approximate only: precise location is never declared or requested',()=>{
 assert.doesNotMatch(manifest,/ACCESS_FINE_LOCATION|ACCESS_BACKGROUND_LOCATION/,'AndroidManifest.xml');
 for(const text of code)assert.doesNotMatch(text,/ACCESS_FINE_LOCATION|enableHighAccuracy:\s*true|requestAlwaysAuthorization/);
 assert.match(plist,/<key>NSLocationDefaultAccuracyReduced<\/key>\s*<true\/>/,'iOS asks for approximate location');
 assert.doesNotMatch(plist,/NSLocationAlwaysAndWhenInUseUsageDescription|NSLocationAlwaysUsageDescription/);
});

test('no shared-storage or photo-library permission reaches the store build',()=>{
 // Libraries can add permissions in the merged manifest: this one is removed at merge time.
 assert.match(manifest,/xmlns:tools="http:\/\/schemas\.android\.com\/tools"/);
 assert.match(manifest,/<uses-permission android:name="android\.permission\.WRITE_EXTERNAL_STORAGE" tools:node="remove" \/>/);
 assert.doesNotMatch(manifest,/<uses-permission android:name="android\.permission\.(READ_EXTERNAL_STORAGE|READ_MEDIA_[A-Z_]+|MANAGE_EXTERNAL_STORAGE)"(?! tools:node="remove")/);
 // The merger implies READ from a library's WRITE; it is removed too.
 assert.match(manifest,/<uses-permission android:name="android\.permission\.READ_EXTERNAL_STORAGE" tools:node="remove" \/>/);
 for(const text of code)assert.doesNotMatch(text,/ExternalStorageDirectoryPath|DownloadDirectoryPath|PicturesDirectoryPath/,'files stay in the app\'s own storage');
});
