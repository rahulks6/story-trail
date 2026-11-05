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
 // Calls: WebRTC opens the camera and microphone and routes call audio.
 {name:'calls',uses:/require\("react-native-webrtc"\)/,android:['android.permission.CAMERA','android.permission.RECORD_AUDIO','android.permission.MODIFY_AUDIO_SETTINGS'],ios:['NSCameraUsageDescription','NSMicrophoneUsageDescription']},
 // Earpiece/loudspeaker, Bluetooth headsets and the proximity sensor's screen-off wake lock.
 {name:'call audio',uses:/require\("react-native-incall-manager"\)/,android:['android.permission.MODIFY_AUDIO_SETTINGS','android.permission.BLUETOOTH_CONNECT','android.permission.WAKE_LOCK']},
 // Contacts on Katkee reads the address book (react-native-contacts) after its explainer.
 {name:'contacts',uses:/require\("react-native-contacts"\)|from "react-native-contacts"/,android:['android.permission.READ_CONTACTS'],ios:['NSContactsUsageDescription']},
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
 assert.deepEqual(missingDeclarations(code,manifest,plist.replace(/<key>NSCameraUsageDescription<\/key>\s*<string>[^<]*<\/string>/,'')),['camera: Info.plist lacks a NSCameraUsageDescription explanation','calls: Info.plist lacks a NSCameraUsageDescription explanation']);
});

test('calls declare only what they need; no foreground service while calls are off in production',()=>{
 // Android: Play needs a declaration and a video of a working call for a camera or microphone
 // foreground service, so none ships until calls are switched on (the manifest says how to restore it).
 assert.doesNotMatch(manifest,/FOREGROUND_SERVICE_(MICROPHONE|CAMERA|MEDIA_PROJECTION)|android:foregroundServiceType/);
 assert.match(manifest,/<uses-permission android:name="android\.permission\.FOREGROUND_SERVICE" tools:node="remove" \/>/);
 assert.match(manifest,/<service android:name="com\.oney\.WebRTCModule\.MediaProjectionService" tools:node="remove" \/>/);
 assert.doesNotMatch(fs.readFileSync(path.join(mobile,'android/app/src/main/java/com/katkee/MainApplication.kt'),'utf8'),/add\(OngoingCallPackage\(\)\)/);
 // Bluetooth below Android 12 only through the legacy permission, never location-based scanning.
 assert.match(manifest,/<uses-permission android:name="android\.permission\.BLUETOOTH" android:maxSdkVersion="30" \/>/);
 assert.doesNotMatch(manifest,/BLUETOOTH_SCAN|BLUETOOTH_ADMIN|USE_FULL_SCREEN_INTENT|MANAGE_OWN_CALLS|FOREGROUND_SERVICE_PHONE_CALL/);
 // iOS: the audio background mode only; "voip" needs PushKit and CallKit, which the app doesn't use.
 const modes=/<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1]??'';
 assert.deepEqual([...modes.matchAll(/<string>([^<]+)<\/string>/g)].map(m=>m[1]),['audio']);
 assert.match(plist,/NSMicrophoneUsageDescription<\/key><string>[^<]*calls/);
 assert.match(plist,/NSCameraUsageDescription<\/key><string>[^<]*video calls/);
});

test('location is approximate only: precise location is never declared or requested',()=>{
 assert.doesNotMatch(manifest,/ACCESS_FINE_LOCATION|ACCESS_BACKGROUND_LOCATION/,'AndroidManifest.xml');
 for(const text of code)assert.doesNotMatch(text,/ACCESS_FINE_LOCATION|enableHighAccuracy:\s*true|requestAlwaysAuthorization/);
 assert.match(plist,/<key>NSLocationDefaultAccuracyReduced<\/key>\s*<true\/>/,'iOS asks for approximate location');
 assert.doesNotMatch(plist,/NSLocationAlwaysAndWhenInUseUsageDescription|NSLocationAlwaysUsageDescription/);
});

test('contacts are read only, and only after the explainer asks',()=>{
 // A library could add WRITE_CONTACTS in the merged manifest: it is removed at merge time.
 assert.match(manifest,/<uses-permission android:name="android\.permission\.WRITE_CONTACTS" tools:node="remove" \/>/);
 assert.doesNotMatch(manifest,/<uses-permission android:name="android\.permission\.(WRITE_CONTACTS|GET_ACCOUNTS)"(?! tools:node="remove")/);
 const reader=fs.readFileSync(path.join(mobile,'src/state/contacts.ts'),'utf8');
 for(const call of ['addContact','updateContact','deleteContact','openContactForm','writePhotoToPath','getAll()','getPhotoForId'])assert.ok(!reader.includes(call),`never ${call}`);
 // Only ContactsFinder (the explainer's Continue button) asks for the permission.
 const askers=sources(path.join(mobile,'src')).filter(f=>/requestContactsAccess\(/.test(fs.readFileSync(f,'utf8'))).map(f=>path.relative(mobile,f)).sort();
 assert.deepEqual(askers,['src/components/ContactsFinder.tsx','src/state/contacts.ts']);
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
