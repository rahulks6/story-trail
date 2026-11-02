// For checks that run one app module in a sandbox with stubbed imports: the module's i18n import
// ("../i18n"), answering in English from the real catalogue (mobile/src/i18n/en.ts), as the app
// does in English. Not a test file itself.
const fs=require('node:fs'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../mobile/src/i18n/en.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module_={exports:{}};
new Function('module','exports',source)(module_,module_.exports);
const en=module_.exports.en;

function t(key,params={}) {
 const entry=en[key];
 if(entry===undefined)return key;
 const text=typeof entry==='string'?entry:(Number(params.count)===1&&entry.one?entry.one:entry.other);
 return text.replace(/\{(\w+)\}/g,(m,name)=>name in params?(name==='count'&&typeof params[name]==='number'?params[name].toLocaleString('en-US'):String(params[name])):m);
}

/** The module's `import { t, ... } from "../i18n"`, in English. */
const i18n={t,en,getLanguage:()=>'en',localeTag:()=>'en-US',formatNumber:(n)=>Math.floor(n).toLocaleString('en-US'),useT:()=>t,useLanguage:()=>'en'};
/** True for any relative import of the i18n module. */
const isI18n=(name)=>/(^|\/)i18n$/.test(name);

module.exports={en,t,i18n,isI18n};
