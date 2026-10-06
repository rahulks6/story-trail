// Native capabilities the app's code uses must be declared: without the permission Android throws
// a SecurityException (e.g. Vibration.vibrate without VIBRATE), and iOS ends the app the first
// time it touches the camera, microphone, photos or location without a usage description.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mobile=path.join(__dirname,'../mobile');

const RULES=[
 {name:'vibration',uses:/Vibration\.vibrate\(/,android:['android.permission.VIBRATE']},
 {name:'camera',uses:/useCameraPermission\(|<Camera\b/,android:['android.permission.CAMERA'],ios:['NSCameraUsageDescription']},
 {name:'microphone',uses:/useMicrophonePermission\(/,android:['android.permission.RECORD_AUDIO'],ios:['NSMicrophoneUsageDescription']},
 {name:'location',uses:/Geolocation\.getCurrentPosition\(/,android:['android.permission.ACCESS_COARSE_LOCATION'],ios:['NSLocationWhenInUseUsageDescription']},
 {name:'photo library',uses:/launchImageLibrary\(/,ios:['NSPhotoLibraryUsageDescription']},
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
