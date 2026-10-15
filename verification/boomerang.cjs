// Boomerang (Phase 16): the app records a short burst and the server makes the forward-and-back
// loop. The effect has to travel from the camera through the outbox to the upload request, and the
// app's burst must be longer than the clip the server keeps.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('the effect travels from the camera to the upload request',()=>{
 assert.match(read('mobile/src/screens/create/CameraScreen.tsx'),/"video", null, null, 'video\/mp4', effect\);/);
 assert.match(read('mobile/src/screens/create/StoryEditorScreen.tsx'),/boomerang \? "boomerang" : undefined,\n\s*\);/);
 const queue=read('mobile/src/state/uploadQueue.ts');
 assert.match(queue,/\.\.\.\(job\.effect\?\{effect:job\.effect\}:\{\}\)\},token\(\)\)/);
 assert.match(read('mobile/src/api/media.ts'),/effect\?: "none" \| "boomerang"/);
 assert.match(read('backend/src/modules/media/worker.ts'),/media\.filter, media\.effect\)/);
});

test('the burst covers the clip the server keeps, and only videos can be Boomerangs',()=>{
 const appMs=Number(/BOOMERANG_RECORD_MS = (\d+)/.exec(read('mobile/src/models/captureModes.ts'))[1]);
 const serverSeconds=Number(/BOOMERANG_CLIP_SECONDS = ([\d.]+)/.exec(read('backend/src/modules/media/processing.ts'))[1]);
 assert.ok(appMs>serverSeconds*1000,`${appMs} ms recorded for a ${serverSeconds} s clip`);
 const migration=read('backend/migrations/0044_boomerang.sql');
 assert.match(migration,/CHECK \(effect IN \('none', 'boomerang'\)\)/);
 assert.match(migration,/CHECK \(effect = 'none' OR kind = 'video'\)/);
});
