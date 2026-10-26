// Every tap shows: the app's Pressable (mobile/src/components/Pressable.tsx) springs a button
// down, tints a row, and shows nothing on a full-screen tap area. React Native's own Pressable
// shows nothing at all, which is what made taps feel dead; screens must not import it.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=path.join(__dirname,'../mobile/src');
const files=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?files(path.join(dir,e.name)):/\.tsx?$/.test(e.name)?[path.join(dir,e.name)]:[]);

test("screens use the app's Pressable, never React Native's",()=>{
 const offenders=files(src)
  .filter((f)=>!f.endsWith(path.join('components','Pressable.tsx')))
  .filter((f)=>{const m=/import\s*\{([^}]*)\}\s*from\s*["']react-native["']/.exec(fs.readFileSync(f,'utf8'));return !!m&&m[1].split(',').map((n)=>n.trim()).includes('Pressable');})
  .map((f)=>path.relative(src,f));
 assert.deepEqual(offenders,[]);
});

test('no Touchable* components (they bypass the shared press feedback)',()=>{
 const offenders=files(src).filter((f)=>/\bTouchable(Opacity|Highlight|WithoutFeedback)\b/.test(fs.readFileSync(f,'utf8'))).map((f)=>path.relative(src,f));
 assert.deepEqual(offenders,[]);
});
