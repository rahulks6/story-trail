// Every icon and launch image comes from one master (brand/katkee-app-icon-1024.png) through
// scripts/brand-assets.cjs. The Android and iOS builds that would reject a wrong size or a missing
// resource can't run here, so this checks what they would: sizes, formats, references, and that
// every copy of the traced mark is the same mark.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {XMLValidator}=require('../mobile/node_modules/fast-xml-parser');
const {pngHeader}=require('../mobile/scripts/check-release.cjs');
const root=path.join(__dirname,'..');
const at=(f)=>path.join(root,f),read=(f)=>fs.readFileSync(at(f),'utf8');
const res='mobile/android/app/src/main/res',ios='mobile/ios/KatkeeMobile';
const DENSITIES={mdpi:1,hdpi:1.5,xhdpi:2,xxhdpi:3,xxxhdpi:4};
const RGB=2,RGBA=6;

test('the master is the approved 1024 x 1024 opaque icon, and the App Store icon is it',()=>{
 assert.deepEqual(pngHeader(at('brand/katkee-app-icon-1024.png')),{width:1024,height:1024,bitDepth:8,colorType:RGB});
 assert.deepEqual(pngHeader(at(`${ios}/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png`)),{width:1024,height:1024,bitDepth:8,colorType:RGB});
 const contents=JSON.parse(read(`${ios}/Images.xcassets/AppIcon.appiconset/Contents.json`));
 assert.deepEqual(contents.images,[{filename:'AppIcon-1024.png',idiom:'universal',platform:'ios',size:'1024x1024'}]);
});

test('the iPhone launch screen shows the launch logo on the app background',()=>{
 const storyboard=read(`${ios}/LaunchScreen.storyboard`);
 assert.equal(XMLValidator.validate(storyboard),true);
 assert.match(storyboard,/<imageView [^>]*image="LaunchLogo"/);
 assert.match(storyboard,/<image name="LaunchLogo" width="84" height="112"\/>/);
 // #0B0B0B, the app's background (colors.ts): 11/255.
 assert.match(storyboard,/key="backgroundColor" red="0\.0431\d*" green="0\.0431\d*" blue="0\.0431\d*" alpha="1"/);
 assert.match(read('mobile/src/theme/colors.ts'),/background: "#0B0B0B"/);
 assert.doesNotMatch(storyboard,/React Native|KatkeeMobile/,'no template text');
 const set=JSON.parse(read(`${ios}/Images.xcassets/LaunchLogo.imageset/Contents.json`));
 assert.deepEqual(set.images.map(i=>[i.filename,i.scale]),[['LaunchLogo.png','1x'],['LaunchLogo@2x.png','2x'],['LaunchLogo@3x.png','3x']]);
 for(const {filename,scale} of set.images)assert.deepEqual(pngHeader(at(`${ios}/Images.xcassets/LaunchLogo.imageset/${filename}`)),{width:84*parseInt(scale),height:112*parseInt(scale),bitDepth:8,colorType:RGBA},filename);
 const plist=read(`${ios}/Info.plist`);
 assert.match(plist,/<key>UILaunchStoryboardName<\/key>\s*<string>LaunchScreen<\/string>/);
 assert.match(plist,/<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleLightContent<\/string>/,'light status bar over the dark launch screen');
});

test('Android has launcher icons for every density, adaptive and themed icons, and every reference resolves',()=>{
 for(const [density,scale] of Object.entries(DENSITIES))for(const name of ['ic_launcher','ic_launcher_round']) {
  const header=pngHeader(at(`${res}/mipmap-${density}/${name}.png`));
  assert.deepEqual(header,{width:48*scale,height:48*scale,bitDepth:8,colorType:RGBA},`${density}/${name}`);
 }
 for(const name of ['ic_launcher','ic_launcher_round']) {
  const xml=read(`${res}/mipmap-anydpi-v26/${name}.xml`);
  assert.equal(XMLValidator.validate(xml),true);
  assert.match(xml,/<background android:drawable="@color\/ic_launcher_background" \/>/);
  assert.match(xml,/<foreground android:drawable="@drawable\/ic_launcher_foreground" \/>/);
  assert.match(xml,/<monochrome android:drawable="@drawable\/ic_launcher_monochrome" \/>/,'Android 13 themed icon');
 }
 const values=fs.readdirSync(at(`${res}/values`)).map(f=>read(`${res}/values/${f}`)).join('\n');
 const resources=[`${res}/values-v31/styles.xml`,`${res}/values/styles.xml`,`${res}/mipmap-anydpi-v26/ic_launcher.xml`,'mobile/android/app/src/main/AndroidManifest.xml'].map(read).join('\n');
 for(const [,type,name] of resources.matchAll(/@(color|drawable|mipmap)\/([a-z_]+)/g)) {
  if(type==='color')assert.match(values,new RegExp(`<color name="${name}">#[0-9A-F]{6}</color>`),`@color/${name}`);
  else assert.ok(fs.existsSync(at(`${res}/${type}/${name}.xml`))||Object.keys(DENSITIES).every(d=>fs.existsSync(at(`${res}/${type}-${d}/${name}.png`))),`@${type}/${name}`);
 }
 assert.match(values,/<color name="ic_launcher_background">#080C14<\/color>/,'the icon\'s own background (BRAND.md)');
 assert.match(values,/<color name="katkee_background">#0B0B0B<\/color>/,'the app\'s background (colors.ts)');
});

test('Android draws the same dark launch as iPhone: a dark window, and the mark on Android 12+',()=>{
 const base=read(`${res}/values/styles.xml`),v31=read(`${res}/values-v31/styles.xml`);
 for(const xml of [base,v31]) {
  assert.equal(XMLValidator.validate(xml),true);
  assert.match(xml,/<item name="android:windowBackground">@color\/katkee_background<\/item>/);
  assert.match(xml,/<item name="android:editTextBackground">@drawable\/rn_edit_text_material<\/item>/,'v31 replaces the base style, so it repeats it');
 }
 assert.match(v31,/<item name="android:windowSplashScreenBackground">@color\/katkee_background<\/item>/);
 assert.match(v31,/<item name="android:windowSplashScreenAnimatedIcon">@drawable\/ic_launcher_foreground<\/item>/);
});

test('every copy of the traced mark is the same mark, in the right colours',()=>{
 const vector=(f)=>{
  const xml=read(`${res}/drawable/${f}.xml`);
  assert.equal(XMLValidator.validate(xml),true,f);
  return {xml,paths:[...xml.matchAll(/android:fillColor="(#[0-9A-F]{8})"[^>]*android:pathData="([^"]+)"/g)].map(m=>({color:m[1],d:m[2]}))};
 };
 const foreground=vector('ic_launcher_foreground'),monochrome=vector('ic_launcher_monochrome'),notification=vector('ic_notification');
 assert.deepEqual(foreground.paths.map(p=>p.color),['#FFE4E8F0','#FFFCB020']);
 for(const v of [monochrome,notification])assert.deepEqual(v.paths.map(p=>p.color),['#FFFFFFFF','#FFFFFFFF']);
 const svg=read('brand/katkee-mark.svg');
 const svgPaths=[...svg.matchAll(/ d="([^"]+)"/g)].map(m=>m[1]);
 const app=read('mobile/src/components/brandMarkPaths.ts');
 for(const v of [monochrome,notification])assert.deepEqual(v.paths.map(p=>p.d),foreground.paths.map(p=>p.d));
 assert.deepEqual(svgPaths,foreground.paths.map(p=>p.d));
 for(const p of foreground.paths)assert.ok(app.includes(JSON.stringify(p.d)),'the in-app logo uses the same paths');
 assert.ok(read('website/src/images/katkee-icon.svg').includes(foreground.paths[0].d),'and the website');
 // The adaptive canvas is 108 dp; the master's 1024 px fill its 72 dp visible area.
 assert.match(foreground.xml,/android:viewportWidth="1536"/);
 assert.match(foreground.xml,/android:translateX="256" android:translateY="256"/);
 assert.match(foreground.xml,/android:fillType="evenOdd"/);
 // Path data any Android version parses: commands, numbers, commas and spaces only.
 for(const p of foreground.paths)assert.match(p.d,/^[MLAZ0-9., -]+$/);
});

test('the Play Store and website graphics are the sizes the stores and browsers expect',()=>{
 assert.deepEqual(pngHeader(at('brand/store/google-play-icon-512.png')),{width:512,height:512,bitDepth:8,colorType:RGBA},'Play wants 32-bit');
 assert.deepEqual(pngHeader(at('brand/store/google-play-feature-graphic-1024x500.png')),{width:1024,height:500,bitDepth:8,colorType:RGB});
 assert.deepEqual(pngHeader(at('website/src/images/apple-touch-icon.png')),{width:180,height:180,bitDepth:8,colorType:RGB});
 assert.deepEqual(pngHeader(at('website/src/images/social-card.png')),{width:1200,height:630,bitDepth:8,colorType:RGB});
 const ico=fs.readFileSync(at('website/src/images/favicon.ico'));
 assert.deepEqual([ico.readUInt16LE(0),ico.readUInt16LE(2),ico.readUInt16LE(4)],[0,1,3]);
 assert.deepEqual([0,1,2].map(i=>ico[6+16*i]),[16,32,48]);
 for(const i of [0,1,2]) {
  const offset=ico.readUInt32LE(6+16*i+12);
  assert.equal(ico.toString('latin1',offset+1,offset+4),'PNG');
 }
});
