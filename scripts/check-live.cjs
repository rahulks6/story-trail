#!/usr/bin/env node
'use strict';
/**
 * After deploying: checks that the public addresses the app and the store listings use are live.
 *
 *   npm run check:live        (node scripts/check-live.cjs)
 *
 * Reads the addresses from mobile/build-config.json (the production API, and the Privacy Policy,
 * Terms and Support pages) and website/site.json (the website). Passes only when:
 * - the API answers /health with its database up, and /ready;
 * - every page answers 200 with its own heading, as HTML, behind the website's
 *   Content-Security-Policy and with HSTS;
 * - www.<website> redirects to the website.
 * It needs internet access: run it from your computer or CI after a deploy, and before
 * submitting to the App Store or Google Play.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** Each check: { name, url, ok, detail }. `fetchImpl` is the WHATWG fetch (replaceable in tests). */
async function checkLive({ config, site, fetchImpl = fetch, timeoutMs = 15000 }) {
  const results = [];
  const request = (url, init = {}) => fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), ...init });
  async function check(name, url, test) {
    try {
      const detail = await test(await request(url));
      results.push({ name, url, ok: !detail, detail: detail || '' });
    } catch (error) {
      results.push({ name, url, ok: false, detail: error?.cause?.code ?? error?.message ?? String(error) });
    }
  }
  const api = config.productionApiUrl.replace(/\/?$/, '/');
  await check('API health', `${api}health`, async (res) => {
    if (res.status !== 200) return `status ${res.status}`;
    const body = await res.json().catch(() => null);
    return body?.status === 'ok' && body?.db === 'up' ? '' : `unexpected body ${JSON.stringify(body)}`;
  });
  await check('API ready', `${api}ready`, async (res) => (res.status === 200 ? '' : `status ${res.status}`));

  const pages = [
    ['Privacy Policy', config.privacyPolicyUrl, /<h1>Privacy Policy<\/h1>/],
    ['Terms of Service', config.termsUrl, /<h1>Terms of Service<\/h1>/],
    ['Support', config.supportUrl, /<h1>How can we help\?<\/h1>/],
    ['Account deletion', `${site.origin}/delete-account`, /<h1>Delete your Katkee account<\/h1>/],
    ['Website', `${site.origin}/`, /<title>[^<]+<\/title>/],
  ];
  for (const [name, url, heading] of pages) {
    await check(name, url, async (res) => {
      if (res.status !== 200) return `status ${res.status}${res.headers.get('location') ? ` to ${res.headers.get('location')}` : ''}`;
      if (!/^text\/html/.test(res.headers.get('content-type') ?? '')) return `content type ${res.headers.get('content-type')}`;
      if (!/default-src 'none'/.test(res.headers.get('content-security-policy') ?? '')) return 'missing the website\'s Content-Security-Policy';
      if (!res.headers.get('strict-transport-security')) return 'missing Strict-Transport-Security';
      return heading.test(await res.text()) ? '' : 'the page is not the expected one';
    });
  }
  const host = new URL(site.origin).host;
  await check('www redirect', `https://www.${host}/`, async (res) => {
    const location = res.headers.get('location');
    return [301, 308].includes(res.status) && location === `${site.origin}/` ? '' : `status ${res.status}, location ${location}`;
  });
  return results;
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'mobile/build-config.json'), 'utf8'));
  const site = JSON.parse(fs.readFileSync(path.join(root, 'website/site.json'), 'utf8'));
  const results = await checkLive({ config, site });
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(17)} ${r.url}${r.ok ? '' : `  (${r.detail})`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`);
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { checkLive };
