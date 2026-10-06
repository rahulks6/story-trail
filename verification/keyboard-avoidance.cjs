// Text fields must stay visible above the keyboard. The app is edge-to-edge on Android, so the
// system no longer resizes the window when the keyboard opens: a KeyboardAvoidingView whose
// behavior is undefined on Android leaves fields underneath it (it hid the DM composer, comments,
// sign-in and profile forms there). Screens use mobile/src/components/KeyboardAvoider.tsx, and a
// file with a text field must use it unless it is listed here with the reason it is exempt.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=path.join(__dirname,'../mobile/src');

const EXEMPT={
 'components/Form.tsx':'the shared TextField; the screens that use it handle the keyboard',
 'components/StickerSheet.tsx':'its own KeyboardAvoidingView (padding on iOS, height on Android)',
 'components/TextToolModal.tsx':'its own KeyboardAvoidingView (padding on iOS, height on Android)',
 'screens/search/SearchScreen.tsx':'search field at the top of the screen',
 'screens/dm/NewChatScreen.tsx':'search field at the top of the screen',
 'screens/dm/DMInboxScreen.tsx':'search field at the top of the screen',
 'screens/dm/SendStoryScreen.tsx':'search field at the top of the screen',
 'screens/highlight/HighlightEditorScreen.tsx':'name field at the top of the screen',
 'screens/profile/SignInSecuritySection.tsx':'shown only inside AccountSecurityScreen, which handles the keyboard',
};
// Only these may use React Native's KeyboardAvoidingView directly.
const DIRECT=['components/KeyboardAvoider.tsx','components/StickerSheet.tsx','components/TextToolModal.tsx'];

function files(){
 const out={};
 const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
  if(e.isDirectory())walk(p);else if(/\.tsx$/.test(e.name))out[path.relative(src,p).split(path.sep).join('/')]=fs.readFileSync(p,'utf8');}};
 walk(src);
 return out;
}

/** Files whose text fields can end up under the keyboard, and other misuse. */
function problems(all){
 const out=[];
 for(const [file,code] of Object.entries(all)){
  const hasField=/<(TextInput|TextField)\b/.test(code);
  if(hasField&&!EXEMPT[file]&&!/\bKeyboardAvoider\b/.test(code))out.push(`${file}: text field without KeyboardAvoider`);
  if(/\bKeyboardAvoidingView\b/.test(code)&&!DIRECT.includes(file))out.push(`${file}: use KeyboardAvoider, not KeyboardAvoidingView`);
  if(/behavior=\{Platform\.OS === "ios" \? "[a-z]+" : undefined\}/.test(code))out.push(`${file}: no keyboard handling on Android`);
 }
 for(const file of Object.keys(EXEMPT))if(!all[file]||!/<(TextInput|TextField)\b/.test(all[file]))out.push(`${file}: exempt but has no text field any more; drop it from EXEMPT`);
 return out;
}

test('every text field stays above the keyboard on both platforms',()=>{
 assert.deepEqual(problems(files()),[]);
});

test('the check is not vacuous',()=>{
 const all=files();
 const reverted={...all,'screens/dm/ConversationScreen.tsx':all['screens/dm/ConversationScreen.tsx']
  .replace(/<KeyboardAvoider [^>]*>/,'<KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>')
  .replace('</KeyboardAvoider>','</KeyboardAvoidingView>').replace(/import \{ KeyboardAvoider \}[^\n]*\n/,'')};
 assert.deepEqual(problems(reverted).sort(),[
  'screens/dm/ConversationScreen.tsx: no keyboard handling on Android',
  'screens/dm/ConversationScreen.tsx: text field without KeyboardAvoider',
  'screens/dm/ConversationScreen.tsx: use KeyboardAvoider, not KeyboardAvoidingView',
 ]);
 const unhandled={...all,'components/ReportSheet.tsx':all['components/ReportSheet.tsx'].replace(/KeyboardAvoider/g,'View')};
 assert.deepEqual(problems(unhandled),['components/ReportSheet.tsx: text field without KeyboardAvoider']);
});
