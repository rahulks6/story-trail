// Every path in Katkee's icon family must be well-formed SVG: each drawing command carries a
// whole number of argument sets. A malformed path draws only up to the error, so the icon is
// cut off on some renderers (the Like heart's last curve had 4 numbers instead of 6, found by
// rendering the profile in a browser). Checks the paths map and every inline d="..." in Icon.tsx.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ARITY={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};

/** Problems in one path: commands whose numbers don't divide into whole argument sets. */
function pathProblems(d){
 const tokens=d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)||[];
 const problems=[];let cmd=null,count=0;
 const close=()=>{
  if(cmd===null)return;
  const n=ARITY[cmd.toUpperCase()];
  if(n===undefined)problems.push(`unknown command ${cmd}`);
  else if(n===0?count!==0:count===0||count%n!==0)problems.push(`${cmd} with ${count} numbers`);
 };
 if(tokens.length&&!/^[Mm]$/.test(tokens[0]))problems.push('does not start with M');
 for(const t of tokens){if(/^[A-Za-z]$/.test(t)){close();cmd=t;count=0;}else count++;}
 close();
 return problems;
}

/** Every path string in the icon source: `name:'...'` entries and `d="..."` attributes. */
function iconPaths(code){
 const out=[];
 for(const m of code.matchAll(/(\w+):'([MmLlHhVvCcSsQqTtAaZz0-9 .,-]+)'/g))out.push([m[1],m[2]]);
 for(const m of code.matchAll(/\bd="([^"]+)"/g))out.push(['inline',m[1]]);
 return out;
}

test('every icon path is well-formed',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../mobile/src/components/Icon.tsx'),'utf8');
 const paths=iconPaths(code);
 assert.ok(paths.length>=40,`found ${paths.length} paths`);
 assert.deepEqual(paths.flatMap(([name,d])=>pathProblems(d).map(p=>`${name}: ${p}`)),[]);
});

test('the check catches a cut-short curve and allows implicit repeats',()=>{
 assert.deepEqual(pathProblems('M12 21S2 15 2 8.7C2 3.4 8.5 2 12 6.5 15.5 2 22 3.4 22 8.7 22 15 12 21Z'),['C with 16 numbers']);
 assert.deepEqual(pathProblems('M12 21S2 15 2 8.7C2 3.4 8.5 2 12 6.5 15.5 2 22 3.4 22 8.7C22 15 12 21 12 21Z'),[]);
 assert.deepEqual(pathProblems('M4 22v-3a5 5 0 0 1 5-5h6'),[]);
 assert.deepEqual(pathProblems('M3 9h4l5-5v16l-5-5H3Z'),[]);
 assert.deepEqual(pathProblems('M3 9a5 5 0 0 1'),['a with 5 numbers']);
});
