/* Run: node --test verification/account-links.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('../backend/node_modules/typescript');
const root = path.resolve(__dirname, '..');
function load(relative) {
  const filename = path.join(root, relative);
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} };
  vm.runInNewContext(out.outputText, { module, exports: module.exports, require: () => { throw new Error('pure module expected'); }, URLSearchParams });
  return module.exports;
}
const links = load('mobile/src/navigation/profileLinks.ts');
const { profileUsernameFromPath } = links;
// Results come from another VM realm; compare plain values, not prototypes.
const deepLinkTarget = (p) => { const r = links.deepLinkTarget(p); return r === null ? null : JSON.parse(JSON.stringify(r)); };
const { deviceLabel } = load('mobile/src/utils/devices.ts');
const { newPasswordProblem } = load('mobile/src/utils/passwordRules.ts');

test('profile links keep working and normalize case', () => {
  assert.equal(profileUsernameFromPath('user/Some.One'), 'some.one');
  assert.deepEqual(deepLinkTarget('/user/some_one/'), { kind: 'profile', username: 'some_one' });
});

test('a shared profile link carries the account ID, so it still opens after a rename', () => {
  assert.deepEqual(deepLinkTarget('user/old_name?id=0F3C2B1A-1111-4222-8333-444455556666'),
    { kind: 'profile', username: 'old_name', userId: '0f3c2b1a-1111-4222-8333-444455556666' });
  // A malformed or missing id falls back to the name; nothing else in the query is used.
  assert.deepEqual(deepLinkTarget('user/old_name?id=not-a-uuid'), { kind: 'profile', username: 'old_name' });
  assert.deepEqual(deepLinkTarget('user/old_name?id='), { kind: 'profile', username: 'old_name' });
  assert.deepEqual(deepLinkTarget('user/old_name?other=1'), { kind: 'profile', username: 'old_name' });
});

test('story links from the Share sheet resolve, malformed ids are ignored', () => {
  assert.deepEqual(deepLinkTarget('story/0F3C2B1A-1111-4222-8333-444455556666'), { kind: 'story', storyId: '0f3c2b1a-1111-4222-8333-444455556666' });
  assert.equal(deepLinkTarget('story/not-a-uuid'), null);
  assert.equal(deepLinkTarget('story/../../admin'), null);
});

test('push notification links open a DM thread or Activity, and nothing malformed', () => {
  assert.deepEqual(deepLinkTarget('conversation/0F3C2B1A-1111-4222-8333-444455556666'), { kind: 'conversation', conversationId: '0f3c2b1a-1111-4222-8333-444455556666' });
  assert.deepEqual(deepLinkTarget('/activity/'), { kind: 'activity' });
  assert.equal(deepLinkTarget('conversation/not-a-uuid'), null);
  assert.equal(deepLinkTarget('conversation/0f3c2b1a-1111-4222-8333-444455556666/extra'), null);
  assert.equal(deepLinkTarget('activity/everything'), null);
});

test('reset links prefill only well-formed email and code', () => {
  assert.deepEqual(deepLinkTarget('reset-password?email=Person%40Example.com&code=123456'), { kind: 'resetPassword', email: 'person@example.com', code: '123456' });
  assert.deepEqual(deepLinkTarget('reset-password?email=bad&code=12ab56'), { kind: 'resetPassword' });
  assert.equal(deepLinkTarget('unknown/path'), null);
});

test('device labels never invent detail', () => {
  assert.equal(deviceLabel('KatkeeMobile/1 CFNetwork/1490 Darwin/24.0.0'), 'iPhone');
  assert.equal(deviceLabel('okhttp/4.12.0'), 'Android phone');
  assert.equal(deviceLabel('Mozilla/5.0 (X11; Linux x86_64) Chrome/130'), 'Web browser');
  assert.equal(deviceLabel(null), 'Unknown device');
});

test('client password rules mirror the server minimums', () => {
  assert.ok(newPasswordProblem('short', 'a@b.co'));
  assert.ok(newPasswordProblem('a@b.co.uk', 'A@B.co.uk'));
  assert.equal(newPasswordProblem('a long enough passphrase', 'a@b.co'), undefined);
});
