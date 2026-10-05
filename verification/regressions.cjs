/* Run: node verification/regressions.cjs /path/to/typescript */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require(process.argv[2] || '../backend/node_modules/typescript');
const root = path.resolve(__dirname, '..');
function load(relative, mocks = {}, globals = {}) {
  const filename = path.join(root, relative);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, filename);
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, {
    module, exports: module.exports,
    require: (name) => { if (name in mocks) return mocks[name]; throw new Error(`Unexpected dependency: ${name}`); },
    Headers, AbortController, setTimeout, clearTimeout, ...globals,
  }, { filename });
  return module.exports;
}

test('all TypeScript and TSX sources parse', () => {
  let count = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(entry.name)) continue;
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
        assert.deepEqual(source.parseDiagnostics, [], filename);
        count++;
      }
    }
  }
  walk(path.join(root, 'mobile')); walk(path.join(root, 'backend'));
  console.log(`Parsed ${count} TypeScript files`);
});

test('concurrent refresh requests issue only one replacement token pair', async () => {
  let consumed = false, issued = 0;
  const service = load('backend/src/modules/auth/auth.service.ts', {
    '../../config/env': { config: { jwt: { refreshTtlSeconds: 3600 } } },
    '../users/users.repository': { findUserById: async () => ({ isActive: true }) },
    './refresh-tokens.repository': {
      findActiveRefreshToken: async () => ({ id: 'old', userId: 'user' }),
      consumeRefreshToken: async () => { if (consumed) return false; consumed = true; return true; },
      insertRefreshToken: async () => { issued++; return { id: 'new', sessionId: 'session' }; },
      finalizeRefreshToken: async () => {},
    },
    './account-security': {},
    '../../http/errors': { HttpError: class HttpError extends Error {} },
    './password': {},
    './tokens': { verifyRefreshToken: () => ({ jti: 'old' }), issueAccessToken: () => 'access', issueRefreshToken: () => 'refresh' },
  });
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => service.refresh('old', null)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(issued, 1);
  for (const result of results.filter(r => r.status === 'rejected')) assert.equal(result.reason.status, 401);
});

test('invalid Highlight cover causes no writes', async () => {
  const writes = [];
  class ValidationError extends Error {}
  const service = load('backend/src/modules/highlights/highlights.service.ts', {
    '../../http/errors': { HttpError: Error }, '../users/users.repository': {}, '../social/social.repository': {},
    '../stories/stories.repository': { findStoryById: async () => ({ ownerId: 'owner', deletedAt: null }) },
    '../stories/stories.service': {}, '../auth/dto': { ValidationError },
    './highlights.repository': {
      getWithItems: async () => ({ ownerId: 'owner', items: [{ storyId: 'A' }] }),
      replaceHighlightItems: async () => writes.push('items'), renameHighlight: async () => writes.push('title'),
      setCoverStory: async () => writes.push('cover'),
    },
  });
  await assert.rejects(service.updateHighlight('owner', 'highlight', { title: 'Changed', storyIds: ['B'], coverStoryId: 'A' }), ValidationError);
  assert.deepEqual(writes, []);
});

function client(fetch) {
  return load('mobile/src/api/client.ts', { '../config/env': { appEnv: { apiBaseUrl: 'https://test.invalid' } } }, { fetch });
}
test('authenticated requests retry once with a fresh token and preserve body', async () => {
  const calls = [];
  const api = client(async (url, init) => { calls.push(init); return { status: calls.length === 1 ? 401 : 200, ok: calls.length > 1, text: async () => '{"ok":true}' }; });
  let refreshes = 0;
  api.setSessionHandler(async token => { assert.equal(token, 'old'); refreshes++; return 'new'; });
  const result = await api.apiPost('/story', { caption: 'Hello' }, 'old');
  assert.equal(result.ok, true);
  assert.equal(refreshes, 1);
  assert.equal(new Headers(calls[1].headers).get('Authorization'), 'Bearer new');
  assert.equal(calls[0].body, calls[1].body);
});
test('persistent 401 does not cause an infinite retry', async () => {
  let requests = 0;
  const api = client(async () => { requests++; return { status: 401, ok: false, text: async () => '{}' }; });
  api.setSessionHandler(async () => 'new');
  await assert.rejects(api.apiGet('/story', 'old'), err => err.status === 401);
  assert.equal(requests, 2);
});
test('login failures never enter the refresh flow', async () => {
  const api = client(async () => ({ status: 401, ok: false, text: async () => '{}' }));
  api.setSessionHandler(async () => { throw new Error('Must not refresh'); });
  await assert.rejects(api.apiPost('/auth/login', {}), err => err.status === 401);
});
