// Push registration (mobile/src/push/pushNotifications.ts) with Firebase Messaging and react-native mocked.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../mobile/src/push/pushNotifications.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const plain=v=>JSON.parse(JSON.stringify(v));
const USER='11111111-1111-4111-8111-111111111111';
const CONVERSATION='katkee://conversation/0f3c2b1a-1111-4222-8333-444455556666';

function fixture({os='android',version=34,firebase=true,androidGranted=false,androidAnswer='granted',iosStatus=-1,iosAnswer=1,serverDown=false}={}){
 const store=new Map(),calls={register:[],unregister:[],requests:0,deleted:0,iosRequests:0};let refresh=null,opened=null,granted=androidGranted;
 const AuthorizationStatus={NOT_DETERMINED:-1,DENIED:0,AUTHORIZED:1,PROVISIONAL:2,EPHEMERAL:3};
 const messaging={AuthorizationStatus,getMessaging:()=>({app:'[DEFAULT]'}),
  hasPermission:async()=>iosStatus,requestPermission:async()=>{calls.iosRequests++;iosStatus=iosAnswer;return iosAnswer;},
  getToken:async()=>'fcm-token-1234567890abcdef',deleteToken:async()=>{calls.deleted++;},
  onTokenRefresh:(m,fn)=>{refresh=fn;return ()=>{refresh=null;};},
  getInitialNotification:async()=>({data:{url:CONVERSATION}}),
  onNotificationOpenedApp:(m,fn)=>{opened=fn;return ()=>{opened=null;};},
  onMessage:()=>()=>undefined,setBackgroundMessageHandler:()=>undefined};
 const rn={Platform:{OS:os,Version:version},PermissionsAndroid:{PERMISSIONS:{POST_NOTIFICATIONS:'android.permission.POST_NOTIFICATIONS'},RESULTS:{GRANTED:'granted',DENIED:'denied'},
  check:async()=>granted,request:async()=>{calls.requests++;granted=androidAnswer==='granted';return androidAnswer;}}};
 const storage={getItem:async k=>store.has(k)?store.get(k):null,setItem:async(k,v)=>{store.set(k,v);},removeItem:async k=>{store.delete(k);}};
 const api={registerPushDevice:async(device,token)=>{calls.register.push({device:plain(device),token});return {device:{id:'d'}};},
  unregisterPushDevice:async(device,token)=>{calls.unregister.push({device:plain(device),token});if(serverDown)throw Error('offline');}};
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,Intl,JSON,Number,Promise,
  require:n=>{if(n==='@react-native-firebase/messaging'){if(!firebase)throw Error("No Firebase App '[DEFAULT]' has been created");return messaging;}
   return {'react-native':rn,'@react-native-async-storage/async-storage':storage,'../api/push':api}[n];}},{filename:'pushNotifications.ts'});
 return {push:module.exports,calls,store,refresh:t=>refresh?.(t),open:m=>opened?.(m)};
}

test('a build without Firebase configuration runs with push quietly off',async()=>{
 const {push,calls}=fixture({firebase:false});
 assert.equal(await push.pushPermission(),'unavailable');
 assert.equal(await push.registerForPush(USER,'access'),'unavailable');
 assert.equal(await push.requestPushPermission(),false);
 assert.equal(await push.initialNotificationLink(),null);
 assert.equal(typeof push.onNotificationOpened(()=>undefined),'function');
 await push.unregisterForPush('access');push.registerBackgroundHandler();
 assert.deepEqual([calls.register.length,calls.unregister.length],[0,0]);
});

test('Android 13+: never prompts by itself, asks once when asked to, then registers an FCM token',async()=>{
 const {push,calls}=fixture();
 assert.equal(await push.pushPermission(),'undetermined');
 assert.equal(await push.registerForPush(USER,'access'),'no_permission');
 assert.equal(calls.requests,0,'registration never shows the system prompt');
 assert.equal(await push.hasAskedForPush(),false);
 assert.equal(await push.requestPushPermission(),true);
 assert.equal(await push.hasAskedForPush(),true);
 assert.equal(await push.registerForPush(USER,'access'),'registered');
 assert.equal(calls.register[0].device.provider,'fcm');assert.equal(calls.register[0].device.platform,'android');
 assert.equal(calls.register[0].device.token,'fcm-token-1234567890abcdef');assert.equal(calls.register[0].token,'access');
});

test('Android 13+: a refusal is reported as denied; older Android needs no prompt',async()=>{
 const refused=fixture({androidAnswer:'denied'});
 assert.equal(await refused.push.requestPushPermission(),false);
 assert.equal(await refused.push.pushPermission(),'denied');
 const old=fixture({version:30});
 assert.equal(await old.push.pushPermission(),'granted');
 assert.equal(await old.push.registerForPush(USER,'access'),'registered');assert.equal(old.calls.requests,0);
});

test('iOS: asks through Firebase, counts provisional as allowed, registers with platform ios',async()=>{
 const f=fixture({os:'ios',iosAnswer:2});
 assert.equal(await f.push.pushPermission(),'undetermined');
 assert.equal(await f.push.requestPushPermission(),true);
 assert.equal(await f.push.registerForPush(USER,'access'),'registered');
 assert.deepEqual([f.calls.register[0].device.provider,f.calls.register[0].device.platform],['fcm','ios']);
 const denied=fixture({os:'ios',iosStatus:0});
 assert.equal(await denied.push.pushPermission(),'denied');
 assert.equal(await denied.push.registerForPush(USER,'access'),'no_permission');
});

test('a refreshed token is re-registered for whoever is signed in, and for nobody after sign-out',async()=>{
 const f=fixture({androidGranted:true});
 let session={userId:USER,accessToken:'access-2'};
 const stop=f.push.watchPushToken(()=>session);
 f.refresh('fcm-token-rotated-0000000000');await new Promise(r=>setImmediate(r));
 assert.deepEqual([f.calls.register[0].device.token,f.calls.register[0].token],['fcm-token-rotated-0000000000','access-2']);
 session=null;f.refresh('fcm-token-rotated-1111111111');await new Promise(r=>setImmediate(r));
 assert.equal(f.calls.register.length,1);
 stop();
});

test('sign-out unregisters the saved token and deletes it, even offline',async()=>{
 const f=fixture({androidGranted:true,serverDown:true});
 await f.push.registerForPush(USER,'access');assert.equal(f.store.size,1);
 await f.push.unregisterForPush('access');
 assert.deepEqual(f.calls.unregister[0],{device:{provider:'fcm',token:'fcm-token-1234567890abcdef'},token:'access'});
 assert.equal(f.calls.deleted,1,'the old token is made useless even when the server call fails');
 assert.equal(f.store.has('katkee.push.device.v1'),false);
});

test('only the app\'s own links in a notification are followed',async()=>{
 const {push,open}=fixture();
 for(const ok of[CONVERSATION,'katkee://story/0f3c2b1a-1111-4222-8333-444455556666','katkee://user/some.one','katkee://activity'])
  assert.equal(push.notificationLink({data:{url:ok}}),ok);
 for(const bad of['https://evil.example/x','katkee://admin','katkee://conversation/../../x','katkee://user/a',42,null])
  assert.equal(push.notificationLink({data:{url:bad}}),null,String(bad));
 assert.equal(push.notificationLink(null),null);
 assert.equal(await push.initialNotificationLink(),CONVERSATION);
 const seen=[];push.onNotificationOpened(u=>seen.push(u));
 open({data:{url:'javascript:alert(1)'}});open({data:{url:'katkee://activity'}});
 assert.deepEqual(seen,['katkee://activity']);
});
