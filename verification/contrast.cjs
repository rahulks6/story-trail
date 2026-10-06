// Text contrast of the locked palette (mobile/src/theme/colors.ts), measured with the WCAG 2.2
// formula rather than judged by eye: every pair the app uses for text must reach 4.5:1 (body
// text, AA). Disabled text is exempt (WCAG 1.4.3). The palette itself is approved branding and
// is not changed here; a pair that falls short fails this check for a design decision.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../mobile/src/theme/colors.ts'),'utf8');
const palette=Object.fromEntries([...source.matchAll(/^\s*(\w+): "(#[0-9A-Fa-f]{6})"/gm)].map((m)=>[m[1],m[2]]));

function luminance(hex){
 const [r,g,b]=[1,3,5].map((i)=>parseInt(hex.slice(i,i+2),16)/255).map((c)=>(c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4));
 return 0.2126*r+0.7152*g+0.0722*b;
}
function ratio(a,b){
 const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
 return (hi+0.05)/(lo+0.05);
}

// [foreground, background]: text the screens draw on each surface.
const TEXT=[
 ['textPrimary','background'],['textPrimary','surface'],['textPrimary','surfaceElevated'],
 ['textSecondary','background'],['textSecondary','surface'],['textSecondary','surfaceElevated'],
 ['accent','background'],['accent','surface'],['onAccent','accent'],['onAccent','accentPressed'],
 ['danger','background'],['danger','surface'],['danger','surfaceElevated'],['onAccent','danger'],['success','background'],
];

/** A translucent tint over a surface, as the screen composites it. */
function over(rgba,base){
 const [r,g,b,a]=rgba;
 const hex=(i)=>Math.round(a*[r,g,b][i]+(1-a)*parseInt(base.slice(1+2*i,3+2*i),16)).toString(16).padStart(2,'0');
 return `#${hex(0)}${hex(1)}${hex(2)}`;
}
const read=(file)=>fs.readFileSync(path.join(__dirname,'../mobile/src',file),'utf8');
// Red text on red tints: the error banner (on the screen) and the delete button (on a sheet).
const TINTS=[
 ['components/Form.tsx',/bannerError: \{ backgroundColor: "rgba\((\d+),(\d+),(\d+),([\d.]+)\)"/,'background'],
 ['components/OverlayAdjustSheet.tsx',/deleteButton: \{[^}]*backgroundColor: "rgba\((\d+),(\d+),(\d+),([\d.]+)\)"/,'surface'],
];

test('the palette has the colours this check reads',()=>{
 for(const name of ['background','surface','surfaceElevated','textPrimary','textSecondary','accent','accentPressed','onAccent','danger','success']){
  assert.match(palette[name]??'',/^#[0-9A-Fa-f]{6}$/,name);
 }
});

test('every text pair reaches 4.5:1',()=>{
 const short=TEXT.map(([fg,bg])=>[`${fg} on ${bg}`,ratio(palette[fg],palette[bg])]).filter(([,r])=>r<4.5).map(([pair,r])=>`${pair} ${r.toFixed(2)}:1`);
 assert.deepEqual(short,[]);
});

test('red text on its own tints reaches 4.5:1, and the tints follow the palette red',()=>{
 const danger=[1,3,5].map((i)=>parseInt(palette.danger.slice(i,i+2),16));
 for(const [file,pattern,base] of TINTS){
  const m=pattern.exec(read(file));
  assert.ok(m,`${file}: tint not found`);
  const rgba=m.slice(1,5).map(Number);
  assert.deepEqual(rgba.slice(0,3),danger,`${file}: the tint is not the palette's danger red`);
  const r=ratio(palette.danger,over(rgba,palette[base]));
  assert.ok(r>=4.5,`${file}: danger on its tint ${r.toFixed(2)}:1`);
 }
});

test('the formula matches known values',()=>{
 assert.equal(ratio('#FFFFFF','#000000').toFixed(1),'21.0');
 assert.equal(ratio('#777777','#FFFFFF').toFixed(2),'4.48');
});
