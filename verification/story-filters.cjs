// Story filters (Phase 15): the server applies a filter to the pixels while it processes an upload
// (backend/src/modules/media/filters.ts) and the editor previews it on the phone with the same
// arithmetic (mobile/src/models/filterPreviews.ts). The two copies must agree exactly, or a Story
// would look different once published. This checks they do.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const SERVER='backend/src/modules/media/filters.ts',APP='mobile/src/models/filterPreviews.ts';

/** The RECIPES table, as data. */
function recipes(file){
 const block=/export const RECIPES: Record<FilterKey, FilterRecipe> = \{([\s\S]*?)\n\};/.exec(read(file));
 assert.ok(block,`${file}: RECIPES`);
 return Object.fromEntries([...block[1].matchAll(/^\s*(\w+): \{([^}]*)\},$/gm)].map(([,key,body])=>
  [key,Object.fromEntries([...body.matchAll(/(\w+): (-?[\d.]+)/g)].map(([,k,v])=>[k,Number(v)]))]));
}
/** The shared colour-transform code, whitespace-normalised. */
function shared(file){
 const block=/\/\/ BEGIN shared colorTransform[^\n]*\n([\s\S]*?)\/\/ END shared colorTransform/.exec(read(file));
 assert.ok(block,`${file}: shared colorTransform block`);
 return block[1].replace(/\s+/g,' ').trim();
}

test('the server and the app define the same filters with the same arithmetic',()=>{
 const server=recipes(SERVER),app=recipes(APP);
 assert.equal(Object.keys(server).length,11);
 assert.deepEqual(app,server);
 assert.deepEqual(server.original,{});
 assert.equal(shared(APP),shared(SERVER));
});

test('every filter the API accepts has a recipe, and the editor offers exactly those',()=>{
 const names=/export const FILTER_NAMES = \[([\s\S]*?)\] as const;/.exec(read('backend/src/modules/stories/overlays.ts'));
 assert.ok(names,'FILTER_NAMES');
 const api=[...names[1].matchAll(/"(\w+)"/g)].map((m)=>m[1]);
 assert.deepEqual(Object.keys(recipes(SERVER)),api);
 const editor=[...read(APP).matchAll(/\{ name: "(\w+)", overlayColor:/g)].map((m)=>m[1].toLowerCase());
 assert.deepEqual(editor,api);
 const typeKeys=/export type FilterKey = ([^;]+);/.exec(read(APP));
 assert.deepEqual([...typeKeys[1].matchAll(/"(\w+)"/g)].map((m)=>m[1]),api);
});

test('the upload carries the chosen filter, and viewers skip the tint once it is baked in',()=>{
 assert.match(read('mobile/src/state/uploadQueue.ts'),/createUploadSession\(\{clientUploadId:job\.id,kind:job\.kind,mimeType:job\.mimeType,byteSize:size,filter:job\.payload\.filter\|\|'original'\}/);
 assert.match(read('backend/src/modules/media/uploads.ts'),/INSERT INTO media \(id, owner_id, kind, mime_type, byte_size, storage_key, status, filter\)/);
 assert.match(read('backend/src/modules/media/worker.ts'),/processPhoto\(original, workDir, media\.mimeType, media\.filter\)/);
 assert.match(read('backend/src/modules/media/worker.ts'),/\}, media\.filter\);/);
 for(const screen of ['mobile/src/screens/story/StoryFeed.tsx','mobile/src/screens/profile/ArchivedStoryViewerScreen.tsx','mobile/src/screens/highlight/HighlightViewerScreen.tsx'])
  assert.match(read(screen),/filterApplied=\{detail\.filterApplied === true\}/,screen);
});
