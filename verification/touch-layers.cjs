// Touch layers must exist on the phone. Android drops a view that draws nothing ("view
// flattening"), so an empty full-screen layer with touch handlers never receives a touch: they
// fall through to whatever is underneath. That broke drawing and the filter swipe in the Story
// editor on Android. Every view that takes PanResponder handlers must be `collapsable={false}`
// or `accessible` (which also keeps it).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=path.join(__dirname,'../mobile/src');

/** Each `<View ...>` opening tag that spreads panHandlers, without the ones that keep the view. */
function problems(files){
 const out=[];
 for(const [file,code] of Object.entries(files)){
  for(const m of code.matchAll(/<View\b((?:[^<>]|=>)*?\{\.\.\.\w+\.panHandlers\}(?:[^<>]|=>)*?)(?<!=)\/?>/g)){
   if(!/collapsable=\{false\}|\baccessible\b/.test(m[1]))out.push(`${file}: a touch layer Android may drop (add collapsable={false})`);
  }
 }
 return out;
}

function files(){
 const out={};
 (function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
  if(e.isDirectory())walk(p);else if(/\.tsx$/.test(e.name))out[path.relative(src,p).split(path.sep).join('/')]=fs.readFileSync(p,'utf8');}})(src);
 return out;
}

test('every touch layer stays a real view on Android',()=>{
 const all=files();
 assert.ok(Object.values(all).filter((c)=>/\.panHandlers\}/.test(c)).length>=8,'the check found the touch layers');
 assert.deepEqual(problems(all),[]);
});

test('the check catches an empty layer and allows a kept one',()=>{
 assert.equal(problems({'x.tsx':'<View style={StyleSheet.absoluteFill} {...gesture.panHandlers} />'}).length,1);
 assert.equal(problems({'x.tsx':'<View style={s} collapsable={false} {...gesture.panHandlers} />'}).length,0);
 assert.equal(problems({'x.tsx':'<View {...gesture.panHandlers} accessible accessibilityLabel="Story" />'}).length,0);
 assert.equal(problems({'x.tsx':'<View {...g.panHandlers} onLayout={(e) => { size(e); }} accessible>'}).length,0,'an arrow function is not the end of the tag');
});
