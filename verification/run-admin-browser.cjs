'use strict';
/**
 * Runs verification/admin-browser.cjs against an isolated, freshly migrated local database
 * and a loopback API server with the Admin console enabled. Never touches existing data:
 * it creates a new uniquely named database (retained afterwards for inspection).
 *
 * Requires: backend built (npm --prefix backend run build), PGHOST/PGUSER/PGPASSWORD for a
 * local test role with CREATEDB, and Playwright (PLAYWRIGHT_MODULE, default playwright-core).
 * Usage: node verification/run-admin-browser.cjs [outputDir]
 */
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');
if (!['localhost', '127.0.0.1', '::1'].includes(process.env.PGHOST || 'localhost')) throw Error('Use a dedicated local PostgreSQL test server.');
const output = path.resolve(process.argv[2] || path.join(root, 'docs', 'browser-runs', new Date().toISOString().replace(/[:.]/g, '-')));
fs.mkdirSync(output, { recursive: true });
const database = 'katkee_browser_' + Date.now();
const port = 4100 + Math.floor(Math.random() * 500);
const env = {
  ...process.env,
  PGDATABASE: database,
  PORT: String(port),
  NODE_ENV: 'development',
  JWT_ACCESS_SECRET: 'browser-test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'browser-test-refresh-secret-at-least-32-characters',
  ADMIN_CONSOLE_ENABLED: 'true',
  ADMIN_ORIGIN: `http://127.0.0.1:${port}`,
  ADMIN_MFA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  ADS_ENABLED: 'true',
  SPONSORED_STORIES_ENABLED: 'true',
  EMAIL_PROVIDER: 'memory',
  MEDIA_STORAGE_ROOT: path.join(output, 'media'),
  // Development-only in-process media worker, so uploaded video creatives get processed.
  MEDIA_WORKER_IN_PROCESS: 'true',
  MEDIA_WORKER_POLL_MS: '500',
};

cp.execFileSync('createdb', [database], { env, stdio: 'inherit' });
cp.execFileSync(process.execPath, ['dist/scripts/migrate.js'], { cwd: backend, env, stdio: 'inherit' });
const server = cp.spawn(process.execPath, ['dist/src/index.js'], { cwd: backend, env, stdio: ['ignore', fs.openSync(path.join(output, 'server.log'), 'w'), 'inherit'] });

async function main() {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { /* starting */ }
    if (i > 100) throw Error('API did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  const superInput = { username: 'ui_super_' + Date.now().toString(36), email: `super_${Date.now()}@example.com`, password: 'correcthorsebattery', displayName: 'UI Super Admin' };
  const signup = await fetch(base + '/api/v1/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(superInput) });
  if (signup.status !== 201) throw Error('Super Admin signup failed: ' + (await signup.text()));
  cp.execFileSync(process.execPath, ['dist/scripts/bootstrap-super-admin.js', superInput.email], { cwd: backend, env, stdio: 'inherit' });
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, 'admin-browser.cjs')], {
    env: { ...env, KATKEE_TEST_BASE: base, KATKEE_TEST_SUPER_EMAIL: superInput.email, KATKEE_TEST_SUPER_PASSWORD: superInput.password, KATKEE_TEST_OUTPUT: output },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw Error('Admin browser checks failed');
}

main().then(
  () => { server.kill(); console.log(`Evidence: ${path.relative(root, output)} (database ${database} retained)`); },
  (error) => { server.kill(); console.error(error.message); process.exitCode = 1; },
);
