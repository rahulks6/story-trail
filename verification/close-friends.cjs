// Close Friends (Phase 15): a Story shared with Close Friends is seen only by the people on its
// owner's list. Every place a Story can be seen must use the one rule in stories/audience.ts; this
// checks none of them still decides by "public or following" alone, and that the app and the
// server agree on the audiences.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('every way to see a Story applies the shared audience rule',()=>{
 const stories=read('backend/src/modules/stories/stories.service.ts');
 assert.equal((stories.match(/audienceAllows\(/g)||[]).length,3,'the Story itself, a creator\'s list, the following feed');
 assert.doesNotMatch(stories,/s\.audience === "public" \|\| relationship\.isFollowing/);
 assert.match(read('backend/src/modules/highlights/highlights.service.ts'),/audienceAllows\(item\.audience, access\)/);
 const feed=read('backend/src/modules/recommendations/feed-features.repository.ts');
 assert.match(feed,/\$\{AUDIENCE_SQL\}/);
 assert.doesNotMatch(feed,/s\.audience='public' OR o\.following/);
 assert.match(read('backend/src/modules/notifications/notifications.service.ts'),/await getStoryForViewer\(storyId, user\.id\)/,'mentions only reach the audience');
});

test('the app offers exactly the audiences the server accepts',()=>{
 const server=/const AUDIENCES: Audience\[\] = \[([^\]]*)\]/.exec(read('backend/src/modules/stories/dto.ts'));
 const app=/export type StoryAudience = ([^;]+);/.exec(read('mobile/src/api/stories.ts'));
 const list=(m)=>[...m[1].matchAll(/"(\w+)"/g)].map((x)=>x[1]);
 assert.deepEqual(list(server),['public','followers','close_friends']);
 assert.deepEqual(list(app),list(server));
 assert.match(read('backend/migrations/0043_close_friends.sql'),/CHECK \(audience IN \('public', 'followers', 'close_friends'\)\)/);
});
