// Story topics and interests: the server keeps the canonical list (backend/src/shared/topics.ts)
// and the app has its own copy (mobile/src/models/topics.ts) for the interest chips. They must be the same
// list in the same order, or the app would offer a topic the server refuses.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
/** The string literals of `export const TOPICS = [...]` in a file. */
function topics(file){
 const m=/export const TOPICS = \[([\s\S]*?)\]/.exec(read(file));
 assert.ok(m,`${file} declares TOPICS`);
 return [...m[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
}

test('the app offers exactly the topics the server accepts',()=>{
 const server=topics('backend/src/shared/topics.ts'),app=topics('mobile/src/models/topics.ts');
 assert.equal(server.length,22);
 assert.equal(new Set(server.map(t=>t.toLowerCase())).size,server.length,'no topic twice');
 assert.deepEqual(app,server);
 assert.ok(server.every(t=>t.length<=30),'within the stories.topic column check');
});

test('interest chips, a Story topic sent by an older app, and the AI\'s topics all come from that one list',()=>{
 assert.match(read('mobile/src/screens/onboarding/OnboardingScreen.tsx'),/export const INTEREST_CHOICES = TOPICS;/);
 assert.match(read('backend/src/modules/stories/dto.ts'),/canonicalTopic\(b\.topic\)/);
 // Story understanding (stories/story-ai.ts): Claude may answer only a listed topic or "none",
 // and the answer is checked against the list again before it's stored.
 const ai=read('backend/src/modules/stories/story-ai.ts');
 assert.match(ai,/enum: \[\.\.\.TOPICS, "none"\]/);
 assert.match(ai,/topic: canonicalTopic\(topic\)/);
});
