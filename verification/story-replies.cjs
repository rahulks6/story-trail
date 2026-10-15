// Story replies and quick reactions (Phase 15): a viewer answers a Story in its owner's DMs. The
// app offers exactly the reactions the server accepts, and replies go through the DM rules.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const reactions=(file)=>{
 const m=/export const STORY_REACTIONS = \[([^\]]*)\] as const;/.exec(read(file));
 assert.ok(m,`${file}: STORY_REACTIONS`);
 return [...m[1].matchAll(/"([^"]+)"/g)].map((x)=>x[1]);
};

test('the app offers exactly the quick reactions the server accepts',()=>{
 const server=reactions('backend/src/modules/conversations/conversations.service.ts');
 assert.equal(server.length,8);
 assert.deepEqual(reactions('mobile/src/api/conversations.ts'),server);
});

test('a reply needs access to the Story and goes through the normal DM send',()=>{
 const service=read('backend/src/modules/conversations/conversations.service.ts');
 const body=service.slice(service.indexOf('export async function replyToStory'),service.indexOf('function replayed'));
 assert.match(body,/await getStoryForViewer\(storyId, viewerId\)/);
 assert.match(body,/openConversationWith\(viewerId, owner\.username\)/);
 assert.match(body,/sendMessage\(viewerId, conversation\.id,/);
});
