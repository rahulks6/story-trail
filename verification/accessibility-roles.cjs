// Every tappable control tells screen readers what it is. Without accessibilityRole, VoiceOver
// reads a Pressable's text but never says it can be activated (72 controls were missing it).
// Icon-only controls also need an accessibilityLabel. Each tag is scanned with its braces
// balanced, so `=>` inside props does not end it early; tags in comments are ignored.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=path.join(__dirname,'../mobile/src');

/** Each `<Pressable ...>` opening tag in the source, with the text it wraps. */
function pressables(code){
 const out=[];
 for(let i=code.indexOf('<Pressable');i>=0;i=code.indexOf('<Pressable',i+1)){
  const lineStart=code.lastIndexOf('\n',i)+1,prefix=code.slice(lineStart,i).trim();
  if(prefix.startsWith('//')||prefix.startsWith('*')||prefix.startsWith('/*'))continue;
  let j=i+10,depth=0,quote=null;
  for(;j<code.length;j++){
   const c=code[j];
   if(quote){if(c===quote&&code[j-1]!=='\\')quote=null;}
   else if(depth>0&&'"\'`'.includes(c))quote=c;
   else if(c==='{')depth++;else if(c==='}')depth--;
   else if(c==='>'&&depth===0&&code[j-1]!=='=')break;
  }
  const tag=code.slice(i,j+1);
  const close=tag.endsWith('/>')?j:code.indexOf('</Pressable>',j);
  out.push({tag,inner:close>j?code.slice(j+1,close):'',line:code.slice(0,i).split('\n').length});
 }
 return out;
}

function problems(files){
 const out=[];
 for(const [file,code] of Object.entries(files))for(const {tag,inner,line} of pressables(code)){
  if(!/\bon(Long)?Press=/.test(tag)||tag.includes('{...'))continue;
  if(!/accessibilityRole=/.test(tag))out.push(`${file}:${line} has no accessibilityRole`);
  else if(!/accessibilityLabel=/.test(tag)&&!/<Text\b|Label\b/.test(inner))out.push(`${file}:${line} has no text and no accessibilityLabel`);
 }
 return out;
}

function sources(){
 const files={};
 const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
  if(e.isDirectory())walk(p);else if(e.name.endsWith('.tsx'))files[path.relative(src,p).split(path.sep).join('/')]=fs.readFileSync(p,'utf8');}};
 walk(src);
 return files;
}

test('every tappable control has a role, and icon-only ones a label',()=>{
 assert.deepEqual(problems(sources()),[]);
});

test('the check is not vacuous',()=>{
 const files=sources();
 assert.ok(Object.values(files).reduce((n,code)=>n+pressables(code).length,0)>150,'scans the app\'s Pressables');
 assert.deepEqual(problems({'x.tsx':'<Pressable onPress={() => go()}><Text>Go</Text></Pressable>'}),['x.tsx:1 has no accessibilityRole']);
 assert.deepEqual(problems({'x.tsx':'<Pressable accessibilityRole="button" onPress={() => go()}><Icon name="close" /></Pressable>'}),['x.tsx:1 has no text and no accessibilityLabel']);
 assert.deepEqual(problems({'x.tsx':'// a nested <Pressable onPress> would steal the touch\n<Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => go()}><Icon name="close" /></Pressable>'}),[]);
});
