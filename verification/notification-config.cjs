// Push notifications are configured in five places that must agree, and the Android and iOS
// builds that would catch a mismatch cannot run here: the channels the server sends to
// (backend push providers), the channels the app creates (MainApplication.kt), the default
// channel, colour and iOS foreground options (firebase.json, merged by React Native Firebase),
// the status-bar icon (AndroidManifest.xml + drawable) and the brand accent (colors.ts).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {XMLValidator}=require('../mobile/node_modules/fast-xml-parser');
const root=path.join(__dirname,'..'),res='mobile/android/app/src/main/res';
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

function load(){
 return {
  providers:read('backend/src/modules/push/providers.ts'),
  app:read('mobile/android/app/src/main/java/com/katkee/MainApplication.kt'),
  manifest:read('mobile/android/app/src/main/AndroidManifest.xml'),
  strings:read(`${res}/values/strings.xml`),
  androidColors:read(`${res}/values/colors.xml`),
  icon:read(`${res}/drawable/ic_notification.xml`),
  firebase:JSON.parse(read('mobile/firebase.json'))['react-native'],
  theme:read('mobile/src/theme/colors.ts'),
 };
}

/** Every disagreement between the files, as readable problems (empty when consistent). */
function problems(c){
 const out=[];
 for(const [name,xml] of [['AndroidManifest.xml',c.manifest],['strings.xml',c.strings],['colors.xml',c.androidColors],['ic_notification.xml',c.icon]]){
  const valid=XMLValidator.validate(xml);
  if(valid!==true)out.push(`${name} is not well-formed: ${valid.err.msg}`);
 }
 const sent=(/channel\?:\s*([^;]+);/.exec(c.providers)?.[1]??'').match(/"([a-z_]+)"/g)?.map(s=>s.slice(1,-1)).sort()??[];
 const created=[...c.app.matchAll(/NotificationChannel\(\s*"([a-z_]+)"/g)].map(m=>m[1]).sort();
 if(!sent.length)out.push('the server sends no Android channel');
 if(JSON.stringify(sent)!==JSON.stringify(created))out.push(`server channels [${sent}] != channels the app creates [${created}]`);
 for(const m of c.app.matchAll(/R\.string\.([a-z_]+)/g))if(!c.strings.includes(`name="${m[1]}"`))out.push(`strings.xml lacks ${m[1]}`);
 if(!created.includes(c.firebase?.messaging_android_notification_channel_id))out.push('firebase.json default channel is not one the app creates');
 const colorRef=/^@color\/([a-z_]+)$/.exec(c.firebase?.messaging_android_notification_color??'');
 const colorValue=colorRef&&new RegExp(`<color name="${colorRef[1]}">(#[0-9A-Fa-f]{6})</color>`).exec(c.androidColors)?.[1];
 const accent=/accent:\s*"(#[0-9A-Fa-f]{6})"/.exec(c.theme)?.[1];
 if(!colorValue)out.push('firebase.json notification colour is not a colour defined in colors.xml');
 else if(colorValue.toUpperCase()!==accent?.toUpperCase())out.push(`notification colour ${colorValue} is not the app accent ${accent}`);
 // Foreground: apply the badge (so read-driven badge updates land while the app is open) but
 // show no banner or sound; the open app already shows new messages and Activity itself.
 if(JSON.stringify(c.firebase?.messaging_ios_foreground_presentation_options)!=='["badge"]')out.push('iOS foreground presentation must be ["badge"]');
 const iconRef=/android:name="com\.google\.firebase\.messaging\.default_notification_icon"\s+android:resource="@drawable\/([a-z_]+)"/.exec(c.manifest)?.[1];
 if(iconRef!=='ic_notification')out.push('the manifest does not point the notification icon at @drawable/ic_notification');
 if(!/^<vector\b/m.test(c.icon.replace(/<\?xml[^>]*>\s*/,'').replace(/<!--[\s\S]*?-->\s*/g,'')))out.push('ic_notification is not a vector drawable');
 for(const m of c.icon.matchAll(/android:(fillColor|strokeColor)="([^"]+)"/g))
  if(!/^#(FF)?FFFFFF$|^#00[0-9A-Fa-f]{6}$/i.test(m[2]))out.push(`ic_notification ${m[1]} ${m[2]} is not white or transparent (status-bar icons are shape-only)`);
 if(!/android:width="24dp"/.test(c.icon)||!/android:height="24dp"/.test(c.icon))out.push('ic_notification must be 24dp');
 return out;
}

test('server, app, firebase.json, manifest and brand agree on notifications',()=>{
 assert.deepEqual(problems(load()),[]);
});

test('the check is not vacuous: each kind of drift is caught',()=>{
 const c=load();
 const drift=(change)=>problems({...c,...change(c)});
 assert.deepEqual(drift(c=>({app:c.app.replace('NotificationChannel("messages"','NotificationChannel("dms"')})),
  ['server channels [activity,messages] != channels the app creates [activity,dms]']);
 assert.deepEqual(drift(c=>({firebase:{...c.firebase,messaging_android_notification_channel_id:'general'}})),['firebase.json default channel is not one the app creates']);
 assert.deepEqual(drift(c=>({androidColors:c.androidColors.replace(/#[0-9A-Fa-f]{6}/,'#FCB020')})),['notification colour #FCB020 is not the app accent #FFC800']);
 assert.deepEqual(drift(c=>({firebase:{...c.firebase,messaging_ios_foreground_presentation_options:['badge','banner']}})),['iOS foreground presentation must be ["badge"]']);
 assert.deepEqual(drift(c=>({manifest:c.manifest.replace('@drawable/ic_notification','@mipmap/ic_launcher')})),['the manifest does not point the notification icon at @drawable/ic_notification']);
 assert.deepEqual(drift(c=>({icon:c.icon.replace('#FFFFFFFF','#FFFCB020')})),['ic_notification strokeColor #FFFCB020 is not white or transparent (status-bar icons are shape-only)']);
 assert.deepEqual(drift(c=>({strings:c.strings.replace(/<string name="notification_channel_activity">[^<]*<\/string>/,'')})),['strings.xml lacks notification_channel_activity']);
 assert.deepEqual(drift(c=>({strings:c.strings.replace('</resources>','')})).length,1);
});
