// Emoji on older Android phones: their system font stops at the emoji of its year, and anything
// newer shows as an empty box. The app bundles EmojiCompat's font (androidx.emoji2) and wires it
// in four places that the Android build here cannot exercise on an old phone: the dependency
// (app/build.gradle), its start-up (MainApplication.kt), the removed downloadable-font
// initialiser (AndroidManifest.xml) and the text manager that measures with it
// (EmojiTextPackage.kt). It also relies on React Native's text views, which this checks too.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),android='mobile/android/app',rn='mobile/node_modules/react-native';
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
// The emoji2 each AppCompat release requires (its POM); emoji2-bundled must be that version
// exactly, since it depends on emoji2 [x] strictly and would otherwise move emoji2 for everyone.
const APPCOMPAT_EMOJI2={'1.7.0':'1.3.0','1.7.1':'1.3.0'};

function load(){
 const java=`${rn}/ReactAndroid/src/main/java/com/facebook/react`;
 return {
  gradle:read(`${android}/build.gradle`),
  app:read(`${android}/src/main/java/com/katkee/MainApplication.kt`),
  text:read(`${android}/src/main/java/com/katkee/EmojiTextPackage.kt`),
  manifest:read(`${android}/src/main/AndroidManifest.xml`),
  versions:read(`${rn}/gradle/libs.versions.toml`),
  textView:read(`${java}/views/text/ReactTextView.java`),
  editText:read(`${java}/views/textinput/ReactEditText.kt`),
  flags:read(`${java}/internal/featureflags/ReactNativeFeatureFlagsDefaults.kt`)+read(`${java}/internal/featureflags/ReactNativeNewArchitectureFeatureFlagsDefaults.kt`),
  fabric:read(`${java}/fabric/FabricUIManager.java`),
 };
}

/** Everything missing or out of step, as readable problems (empty when wired correctly). */
function problems(c){
 const out=[];
 const appcompat=/^androidx-appcompat = "([^"]+)"/m.exec(c.versions)?.[1];
 const emoji2=APPCOMPAT_EMOJI2[appcompat];
 if(!emoji2)out.push(`React Native's AppCompat ${appcompat} is not in APPCOMPAT_EMOJI2: look up the emoji2 it requires`);
 const bundled=[...c.gradle.matchAll(/implementation\(["']androidx\.emoji2:emoji2-bundled:([^"']+)["']\)/g)].map(m=>m[1]);
 if(bundled.length!==1)out.push('app/build.gradle must depend on androidx.emoji2:emoji2-bundled once');
 else if(!/^\d+\.\d+\.\d+$/.test(bundled[0]))out.push(`emoji2-bundled ${bundled[0]} is not an exact version`);
 else if(emoji2&&bundled[0]!==emoji2)out.push(`emoji2-bundled ${bundled[0]} is not the emoji2 ${emoji2} AppCompat ${appcompat} resolves`);
 const onCreate=/override fun onCreate\(\) \{([\s\S]*?)\n  \}/.exec(c.app)?.[1]??'';
 const init=onCreate.indexOf('EmojiCompat.init(BundledEmojiCompatConfig(this))'),react=onCreate.indexOf('loadReactNative(this)');
 if(init<0)out.push('MainApplication.onCreate does not initialise EmojiCompat with the bundled font');
 else if(react<0||init>react)out.push('EmojiCompat must be initialised before React Native loads (views read it as they are created)');
 if(!/^import androidx\.emoji2\.bundled\.BundledEmojiCompatConfig$/m.test(c.app)||!/^import androidx\.emoji2\.text\.EmojiCompat$/m.test(c.app))out.push('MainApplication does not import EmojiCompat and BundledEmojiCompatConfig');
 // Packages are searched in order for the RCTText manager: this one must come before MainReactPackage.
 if(!/PackageList\(this\)\.packages\.apply \{[^}]*?add\(0, EmojiTextPackage\(\)\)/.test(c.app))out.push('EmojiTextPackage must be added first to the package list');
 if(!/ReactTextViewManager\(emojiCompatSpans\)/.test(c.text)||!/EmojiCompat\.get\(\)\.process\(text\)/.test(c.text))out.push('EmojiTextPackage does not give RCTText a manager that processes text with EmojiCompat');
 if(!/EmojiCompat\.LOAD_STATE_SUCCEEDED/.test(c.text))out.push('EmojiTextPackage must wait for the font to load (process throws before then)');
 const removed=/<meta-data\s+android:name="androidx\.emoji2\.text\.EmojiCompatInitializer"\s+tools:node="remove"\s*\/>/.test(c.manifest);
 if(!removed)out.push('the manifest must remove emoji2\'s EmojiCompatInitializer, or the downloadable font is configured first');
 if(!/android:name="androidx\.startup\.InitializationProvider"[^>]*tools:node="merge"/.test(c.manifest))out.push('the manifest must merge (not replace) androidx.startup\'s provider');
 // What the wiring relies on in React Native itself.
 if(!/class ReactTextView extends AppCompatTextView\b/.test(c.textView))out.push('ReactTextView no longer extends AppCompatTextView');
 if(!/class ReactEditText public constructor\(context: Context\) : AppCompatEditText\(context\)/.test(c.editText))out.push('ReactEditText no longer extends AppCompatEditText');
 // PreparedLayoutTextView draws its own Layout and is not a TextView: AppCompat would not apply.
 if(/fun enablePreparedTextLayout\(\): Boolean = true/.test(c.flags))out.push('enablePreparedTextLayout is on: <Text> no longer uses ReactTextView');
 if(!/mViewManagerRegistry\.get\(ReactTextViewManager\.REACT_CLASS\)[\s\S]{0,700}?instanceof ReactTextViewManagerCallback/.test(c.fabric))out.push('Fabric no longer measures text with the RCTText manager\'s callback');
 return out;
}

test('the bundled emoji font is a dependency, starts first, and <Text> measures and draws with it',()=>{
 assert.deepEqual(problems(load()),[]);
});

test('the check is not vacuous: each kind of drift is caught',()=>{
 const c=load();
 const drift=(change)=>problems({...c,...change(c)});
 assert.deepEqual(drift(c=>({gradle:c.gradle.replace(/\n.*emoji2-bundled.*\n/,'\n')})),['app/build.gradle must depend on androidx.emoji2:emoji2-bundled once']);
 assert.deepEqual(drift(c=>({gradle:c.gradle.replace('emoji2-bundled:1.3.0','emoji2-bundled:1.4.0')})),['emoji2-bundled 1.4.0 is not the emoji2 1.3.0 AppCompat 1.7.0 resolves']);
 assert.deepEqual(drift(c=>({gradle:c.gradle.replace('emoji2-bundled:1.3.0','emoji2-bundled:1.3.+')})),['emoji2-bundled 1.3.+ is not an exact version']);
 assert.deepEqual(drift(c=>({versions:c.versions.replace(/^androidx-appcompat = "[^"]+"/m,'androidx-appcompat = "1.8.0"')})),["React Native's AppCompat 1.8.0 is not in APPCOMPAT_EMOJI2: look up the emoji2 it requires"]);
 assert.deepEqual(drift(c=>({app:c.app.replace('    EmojiCompat.init(BundledEmojiCompatConfig(this))\n','')})),['MainApplication.onCreate does not initialise EmojiCompat with the bundled font']);
 assert.deepEqual(drift(c=>({app:c.app.replace('    EmojiCompat.init(BundledEmojiCompatConfig(this))\n','').replace('    loadReactNative(this)\n','    loadReactNative(this)\n    EmojiCompat.init(BundledEmojiCompatConfig(this))\n')})),['EmojiCompat must be initialised before React Native loads (views read it as they are created)']);
 assert.deepEqual(drift(c=>({app:c.app.replace('add(0, EmojiTextPackage())','add(EmojiTextPackage())')})),['EmojiTextPackage must be added first to the package list']);
 assert.deepEqual(drift(c=>({text:c.text.replace('EmojiCompat.get().process(text)','Unit')})),['EmojiTextPackage does not give RCTText a manager that processes text with EmojiCompat']);
 assert.deepEqual(drift(c=>({manifest:c.manifest.replace('tools:node="remove" />\n      </provider>','/>\n      </provider>')})),["the manifest must remove emoji2's EmojiCompatInitializer, or the downloadable font is configured first"]);
 assert.deepEqual(drift(c=>({textView:c.textView.replace('extends AppCompatTextView','extends TextView')})),['ReactTextView no longer extends AppCompatTextView']);
 assert.deepEqual(drift(c=>({flags:c.flags.replace('fun enablePreparedTextLayout(): Boolean = false','fun enablePreparedTextLayout(): Boolean = true')})),['enablePreparedTextLayout is on: <Text> no longer uses ReactTextView']);
});
