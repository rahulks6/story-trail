const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('../backend/node_modules/typescript');

const root = path.resolve(__dirname, '..');
function loadDto() {
  const filename = path.join(root, 'backend/src/modules/users/dto.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.equal((compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  class ValidationError extends Error {
    constructor(fieldErrors) { super('Validation failed'); this.fieldErrors = fieldErrors; }
  }
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name === '../auth/dto') return { ValidationError };
      if (name === '../../shared/validation') return { USERNAME_RE: /^[a-z0-9_.]{3,30}$/ };
      if (name === './profiles.service') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename });
  return { dto: module.exports, ValidationError };
}

test('profile metadata trims and de-duplicates username/interests', () => {
  const { dto } = loadDto();
  const parsed = dto.parseUpdateProfileInput({
    username: '  New_User  ',
    displayName: 'New name',
    interests: [' Travel ', 'Travel', 'Food'],
    avatarMediaId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(parsed.username, 'new_user');
  assert.deepEqual(parsed.interests, ['Travel', 'Food']);
  assert.equal(parsed.avatarMediaId, '11111111-1111-4111-8111-111111111111');
});

test('profile metadata rejects reserved, malformed and oversized values', () => {
  const { dto, ValidationError } = loadDto();
  for (const body of [
    { username: 'admin' },
    { username: 'two words' },
    { interests: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { avatarMediaId: 'not-a-uuid' },
  ]) {
    assert.throws(() => dto.parseUpdateProfileInput(body), (error) => error instanceof ValidationError);
  }
});

test('profile update keeps avatar and profile fields in one repository UPDATE', () => {
  const repository = fs.readFileSync(path.join(root, 'backend/src/modules/users/users.repository.ts'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'backend/src/modules/users/profiles.service.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'backend/migrations/0027_profile_metadata.sql'), 'utf8');
  assert.match(repository, /avatar_media_id = CASE WHEN/);
  assert.match(repository, /has_avatar/);
  assert.doesNotMatch(service, /setAvatarMedia\(/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS interests_json TEXT NOT NULL DEFAULT '\[\]'/);
  assert.match(migration, /jsonb_typeof\(interests_json::jsonb\) = 'array'/);
});
