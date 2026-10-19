// The katkee.com website (website/): the committed build is exactly what its sources make, every
// page is well-formed, self-contained and accessible, and the build refuses the mistakes that
// would put a broken page in front of a store reviewer.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.join(__dirname,'..');
const {build}=require('../website/build.cjs');
const site=JSON.parse(fs.readFileSync(path.join(root,'website/site.json'),'utf8'));

const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);
/** Open/close balance of every element (self-closing SVG children allowed). */
function unbalanced(html){
 const stack=[];
 for(const [,close,name,self] of html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)){
  const tag=name.toLowerCase();
  if(VOID.has(tag)||self)continue;
  if(!close){stack.push(tag);continue;}
  const open=stack.pop();
  if(open!==tag)return `</${tag}> closes <${open}>`;
 }
 return stack.length?`unclosed <${stack.join('>, <')}>`:null;
}

test('website/public is exactly what the sources build',()=>{
 const files=build();
 const onDisk=(dir,base=dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?onDisk(path.join(dir,e.name),base):[path.relative(base,path.join(dir,e.name)).split(path.sep).join('/')]);
 assert.deepEqual(onDisk(path.join(root,'website/public')).sort(),[...files.keys()].sort());
 for(const [name,data] of files)assert.ok(fs.readFileSync(path.join(root,'website/public',name)).equals(data),`${name} is stale: run node website/build.cjs`);
});

test('every page is well-formed, self-contained and accessible',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'website/public/manifest.json'),'utf8'));
 const pages=[...Object.values(manifest.pages),manifest.notFound];
 const ids=new Map(pages.map(p=>[p,new Set([...fs.readFileSync(path.join(root,'website/public',p),'utf8').matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]))]));
 for(const page of pages){
  const html=fs.readFileSync(path.join(root,'website/public',page),'utf8');
  assert.equal(unbalanced(html),null,page);
  assert.match(html,/^<!doctype html>\n<html lang="en">/,page);
  assert.equal((html.match(/<h1[\s>]/g)??[]).length,1,`${page}: one h1`);
  assert.match(html,/<meta name="viewport" content="width=device-width, initial-scale=1">/,page);
  assert.match(html,/<meta name="description" content="[^"]{20,}">/,page);
  assert.match(html,new RegExp(`<link rel="canonical" href="${site.origin}/`),page);
  for(const [,tag] of html.matchAll(/<img\b([^>]*)>/g))assert.match(tag,/\salt="[^"]*"/,`${page}: every image has alt text`);
  // Nothing is loaded from another origin: the CSP would block it, and visitors aren't tracked.
  for(const [,url] of html.matchAll(/\ssrc="([^"]+)"/g))assert.ok(url.startsWith('/'),`${page}: ${url} is loaded from another origin`);
  for(const [,tag] of html.matchAll(/<link\b([^>]*)>/g)){
   if(/rel="canonical"/.test(tag))continue;
   assert.ok(/\shref="\/[^/]/.test(tag),`${page}: <link${tag}> is loaded from another origin`);
  }
  for(const [,target,anchor] of html.matchAll(/\shref="(\/[a-z-]*)#([^"]+)"/g)){
   const file=target==='/'?'index.html':manifest.pages[target];
   assert.ok(ids.get(file)?.has(anchor),`${page}: ${target}#${anchor} has no such section`);
  }
  for(const [,anchor] of html.matchAll(/\shref="#([^"]+)"/g))assert.ok(ids.get(page).has(anchor),`${page}: #${anchor}`);
 }
});

test('the contact addresses on the pages are the ones in site.json, and the store buttons are honest',()=>{
 const home=fs.readFileSync(path.join(root,'website/public/index.html'),'utf8');
 const support=fs.readFileSync(path.join(root,'website/public/support.html'),'utf8');
 for(const email of Object.values(site.contact))assert.ok(support.includes(`mailto:${email}`),email);
 // No store links yet: the buttons say "Coming soon", and link nowhere.
 if(!site.stores.appStore&&!site.stores.googlePlay){
  assert.equal((home.match(/Coming soon to/g)??[]).length,4);
  assert.doesNotMatch(home,/apps\.apple\.com|play\.google\.com/);
 }
});

/** A copy of website/ and legal/ to break on purpose. */
function sandbox(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'katkee-website-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.cpSync(path.join(root,'website'),path.join(dir,'website'),{recursive:true,filter:(src)=>!src.includes(`${path.sep}public`)});
 fs.cpSync(path.join(root,'legal'),path.join(dir,'legal'),{recursive:true});
 const edit=(file,from,to)=>{const p=path.join(dir,file),s=fs.readFileSync(p,'utf8');assert.ok(s.includes(from),`${file} contains ${from}`);fs.writeFileSync(p,s.replace(from,to));};
 const run=()=>{delete require.cache[path.join(dir,'website/build.cjs')];return require(path.join(dir,'website/build.cjs')).build();};
 return {edit,run};
}

test('the build refuses broken links, unknown addresses, scripts, inline styles and placeholders',t=>{
 const cases=[
  ['website/src/pages/support.html','href="/delete-account"','href="/delete-acount"',/broken link \/delete-acount/],
  ['website/src/pages/support.html','mailto:{{contact.support}}','mailto:help@example.com',/help@example\.com is not one of the contact addresses/],
  ['website/src/pages/404.html','<h1>','<h1 style="color:red">',/inline styles are not allowed/],
  ['website/src/pages/404.html','</section>','<script>alert(1)</script></section>',/scripts and inline styles are not allowed/],
  ['website/src/pages/index.html','{{{storeButtons}}}','{{{storeButton}}}',/unknown placeholder \{\{storeButton\}\}/],
  ['website/src/pages/support.html','href="/delete-account"','href="http://katkee.com/delete-account"',/must be https/],
  ['legal/TERMS_OF_SERVICE.md','[Privacy Policy](./PRIVACY_POLICY.md)','[Privacy Policy](./PRIVACY.md)',/unsupported link \.\/PRIVACY\.md/],
  ['legal/PRIVACY_POLICY.md','**Last updated:** 19 October 2026','Updated recently.',/needs a "\*\*Last updated:\*\* <date>" line/],
  ['legal/PRIVACY_POLICY.md','## 9. Katkee is for adults','> ## 9. Katkee is for adults',/unsupported Markdown/],
  ['website/src/pages/support.html','href="/terms#grievances"','href="/terms#grievance"',/link \/terms#grievance names no section on terms\.html/],
  ['website/site.json','"origin": "https://katkee.com"','"origin": "http://katkee.com"',/exact https:\/\/ origin/],
 ];
 for(const [file,from,to,error] of cases){
  const s=sandbox(t);
  assert.doesNotThrow(s.run,'the untouched copy builds');
  s.edit(file,from,to);
  assert.throws(s.run,error,`${file}: ${to}`);
 }
});

test('the legal pages render the Markdown faithfully',()=>{
 const {markdown}=require('../website/build.cjs');
 const doc=markdown('# Katkee Test\n\n**Last updated:** 1 May 2026\n\n## 1. First part\n\nSome **bold**, _soft_ and `code`, at a@b.com.\n- one\n  continued\n  - nested\n- two\n\n### Detail\nText with [a link](https://katkee.com/terms).\n','test');
 assert.equal(doc.title,'Katkee Test');
 assert.equal(doc.updated,'1 May 2026');
 assert.deepEqual(doc.toc,[{id:'first-part',text:'1. First part'}]);
 assert.equal(doc.html,[
  '<h2 id="first-part">1. First part</h2>',
  '<p>Some <strong>bold</strong>, <em>soft</em> and <code>code</code>, at <a href="mailto:a@b.com">a@b.com</a>.</p>',
  '<ul>\n<li>one continued<ul>\n<li>nested</li>\n</ul></li>\n<li>two</li>\n</ul>',
  '<h3 id="detail">Detail</h3>',
  '<p>Text with <a href="https://katkee.com/terms">a link</a>.</p>',
 ].join('\n'));
 assert.equal(markdown('# T\n\n**Last updated:** x\n\nA <b>tag</b> & "quotes".\n','t').html,'<p>A &lt;b&gt;tag&lt;/b&gt; &amp; &quot;quotes&quot;.</p>');
});
