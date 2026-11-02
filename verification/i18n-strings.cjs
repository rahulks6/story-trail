// Every word a screen shows comes from the i18n catalogue (mobile/src/i18n/en.ts, translated in
// hi.ts and mr.ts), so the app reads the same in English, Hindi and Marathi. This fails on English
// written straight into a .tsx file: JSX text, or a string in a shown prop (title, label,
// placeholder, accessibilityLabel/Hint, message...), including both sides of a ternary and the
// text of a template literal. Brand names and symbols that never translate are allowed below.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require('../mobile/node_modules/typescript');
const src=path.join(__dirname,'../mobile/src');
const files=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?files(path.join(dir,e.name)):e.name.endsWith('.tsx')?[path.join(dir,e.name)]:[]);

// The only English allowed in JSX: the brand (and the two halves of its wordmark) and a URL prefix.
const ALLOWED=new Set(['Katkee','KATKEE','Kat','kee','https://']);
const SHOWN_PROPS=new Set(['title','label','placeholder','accessibilityLabel','accessibilityHint','message','subtitle','hint','headerTitle','body','description','confirmLabel','emptyHint','storyLabel','text']);
const english=(s)=>/[A-Za-z]{2,}/.test(s)&&!ALLOWED.has(s.trim());

function offenders(file) {
 const code=fs.readFileSync(file,'utf8');
 const sf=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const found=[];
 const report=(node,text)=>found.push(`${path.relative(src,file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1} ${JSON.stringify(text.trim().slice(0,60))}`);
 // Strings that end up on screen from an expression: the expression itself, a ternary's branches,
 // either side of || / ?? / && / +, and a template literal's own text.
 const shown=(e)=>{
  if(!e)return;
  if(ts.isParenthesizedExpression(e)||ts.isAsExpression(e)||ts.isNonNullExpression(e))return shown(e.expression);
  if(ts.isStringLiteral(e)||ts.isNoSubstitutionTemplateLiteral(e)){if(english(e.text))report(e,e.text);return;}
  if(ts.isTemplateExpression(e)){
   const text=[e.head.text,...e.templateSpans.map((s)=>s.literal.text)].join(' ');
   if(english(text))report(e,text);
   e.templateSpans.forEach((s)=>shown(s.expression));
   return;
  }
  if(ts.isConditionalExpression(e)){shown(e.whenTrue);shown(e.whenFalse);return;}
  if(ts.isBinaryExpression(e)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.PlusToken].includes(e.operatorToken.kind)){shown(e.left);shown(e.right);return;}
  if(ts.isBinaryExpression(e)&&e.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken)shown(e.right);
 };
 const visit=(n)=>{
  if(ts.isJsxText(n)){if(english(n.text))report(n,n.text);return;}
  if(ts.isJsxExpression(n)&&n.parent&&(ts.isJsxElement(n.parent)||ts.isJsxFragment(n.parent)))shown(n.expression);
  if(ts.isJsxAttribute(n)&&SHOWN_PROPS.has(n.name.getText(sf))&&n.initializer){
   if(ts.isStringLiteral(n.initializer)){if(english(n.initializer.text))report(n.initializer,n.initializer.text);}
   else if(ts.isJsxExpression(n.initializer))shown(n.initializer.expression);
  }
  ts.forEachChild(n,visit);
 };
 visit(sf);
 return found;
}

test('no hard-coded English in JSX text or shown props (use t() from mobile/src/i18n)',()=>{
 assert.deepEqual(files(src).flatMap(offenders),[]);
});

test('the check itself catches JSX text, shown props, ternaries and templates',()=>{
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'i18n-check-'));
 const file=path.join(dir,'Sample.tsx');
 fs.writeFileSync(file,[
  'const a = <Text>Hello there</Text>;',
  'const b = <Button title="Save" />;',
  'const c = <Text>{busy ? "Saving…" : t("common.save")}</Text>;',
  'const d = <View accessibilityLabel={`Photo by ${name}`} />;',
  'const e = <Text>Katkee</Text>;',
  'const f = <Text testID="save-button">{t("common.save")} 🎉</Text>;',
 ].join('\n'));
 try {
  assert.deepEqual(offenders(file).map((o)=>o.replace(/^.*Sample\.tsx:/,'')),['1 "Hello there"','2 "Save"','3 "Saving…"','4 "Photo by"']);
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
