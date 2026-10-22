#!/usr/bin/env node
'use strict';
/**
 * Builds the katkee.com website into website/public/ from:
 * - website/site.json (name, origin, contact addresses, store links);
 * - website/src/ (the page shell, the pages, the stylesheet; images from scripts/brand-assets.cjs);
 * - legal/PRIVACY_POLICY.md and legal/TERMS_OF_SERVICE.md (the published policy and terms).
 *
 *   node website/build.cjs           write website/public/
 *   node website/build.cjs --check   fail if website/public/ is not exactly what the sources make
 *
 * public/ is committed: the API serves it on katkee.com (backend/src/modules/website), and it
 * can be uploaded to any static host as it is. No scripts, no cookies, no third-party requests.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const root = path.resolve(here, '..');
const publicDir = path.join(here, 'public');

const read = (file) => fs.readFileSync(path.join(here, file), 'utf8');
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// --- Markdown (the subset the legal pages use; anything else is refused, not mis-rendered) ---

/** Relative links between the legal files, as published. */
const LEGAL_LINKS = { './PRIVACY_POLICY.md': '/privacy', './TERMS_OF_SERVICE.md': '/terms' };

function inline(text, where) {
  const tokens = [];
  const keep = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = text.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${escape(code)}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const target = LEGAL_LINKS[href] ?? href;
    if (!/^(\/|https:\/\/|mailto:)/.test(target)) throw new Error(`${where}: unsupported link ${href}`);
    return keep(`<a href="${escape(target)}">${emphasis(escape(label))}</a>`);
  });
  s = escape(s).replace(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi, (_, email) => keep(`<a href="mailto:${email}">${email}</a>`));
  s = emphasis(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

function emphasis(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(\S(?:.*?\S)?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])\*(\S(?:.*?\S)?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

const indentOf = (line) => /^ */.exec(line)[0].length;
const LIST_ITEM = /^( *)([-*]|\d+\.) (.*)$/;

function list(lines, start, indent, where) {
  const ordered = /^ *\d+\. /.test(lines[start]);
  const items = [];
  let i = start;
  while (i < lines.length && lines[i].trim()) {
    const line = lines[i];
    const item = LIST_ITEM.exec(line);
    const depth = indentOf(line);
    if (item && depth === indent) { items.push({ text: [item[3]], children: [] }); i++; continue; }
    if (item && depth > indent && items.length) {
      const [html, next] = list(lines, i, depth, where);
      items[items.length - 1].children.push(html);
      i = next;
      continue;
    }
    if (!item && depth > indent && items.length) { items[items.length - 1].text.push(line.trim()); i++; continue; }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  return [`<${tag}>\n${items.map((it) => `<li>${inline(it.text.join(' '), where)}${it.children.join('')}</li>`).join('\n')}\n</${tag}>`, i];
}

function slug(text, used) {
  let base = text.replace(/<[^>]+>/g, '').replace(/^\d+\.\s*/, '').toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/** { title, updated, toc: [{id, text}], html } for one legal Markdown file. */
function markdown(source, where) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const toc = [];
  const used = new Set();
  let title = null, updated = null, paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ');
    const last = /^\*\*Last updated:\*\*\s*(.+)$/.exec(text);
    if (last && !updated && !out.length) updated = last[1].trim();
    else out.push(`<p>${inline(text, where)}</p>`);
    paragraph = [];
  };
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { flush(); i++; continue; }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const text = inline(heading[2].trim(), where);
      if (level === 1) {
        if (title) throw new Error(`${where}: more than one title`);
        title = heading[2].trim();
      } else {
        const id = slug(text, used);
        if (level === 2) toc.push({ id, text });
        out.push(`<h${level} id="${id}">${text}</h${level}>`);
      }
      i++;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      const [html, next] = list(lines, i, indentOf(line), where);
      out.push(html);
      i = next;
      continue;
    }
    if (/^ *(>|\||```|<|#{4,})/.test(line) || /^ {4}/.test(line)) throw new Error(`${where}:${i + 1}: unsupported Markdown: ${line.trim()}`);
    paragraph.push(line.trim());
    i++;
  }
  flush();
  if (!title) throw new Error(`${where}: no title`);
  if (!updated) throw new Error(`${where}: needs a "**Last updated:** <date>" line under the title`);
  return { title, updated, toc, html: out.join('\n') };
}

// --- Assets ------------------------------------------------------------------------------------

const TYPES = {
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json',
};

/**
 * The "Open in Katkee" page is one template for every shared link (/u/<username>, /s/<story id>).
 * The API puts the link's own katkee:// address and path where these markers are, escaped; the
 * markers are in the manifest so the two never disagree.
 */
const OPEN_MARKERS = { appLink: '%APP_LINK%', linkPath: '%LINK_PATH%' };
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

function hashed(name, data) {
  const ext = path.extname(name);
  const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 10);
  return `${path.basename(name, ext)}.${hash}${ext}`;
}

// --- The site -------------------------------------------------------------------------------

/** Live store links once site.json has them; until then, plainly "coming soon" (no fake links). */
function storeButtons(site) {
  const button = (name, live, url) => url
    ? `<a class="store-button" href="${escape(url)}"><span class="store-small">${live}</span><span class="store-name">${name}</span></a>`
    : `<span class="store-button is-soon"><span class="store-small">Coming soon to</span><span class="store-name">${name}</span></span>`;
  return `<div class="store-buttons">${button('App Store', 'Download on the', site.stores.appStore)}${button('Google Play', 'Get it on', site.stores.googlePlay)}</div>`;
}

/** On the "Open in Katkee" page: the live store links, or a quiet line until there are some. */
function getKatkee(site) {
  const live = [['App Store', 'Download on the', site.stores.appStore], ['Google Play', 'Get it on', site.stores.googlePlay]].filter(([, , url]) => url);
  if (!live.length) return '<p class="open-note">Katkee is coming soon to the App Store and Google Play.</p>';
  return `<h2 class="open-get">Get Katkee</h2>\n<div class="store-buttons">${live.map(([name, small, url]) => `<a class="store-button" href="${escape(url)}"><span class="store-small">${small}</span><span class="store-name">${name}</span></a>`).join('')}</div>`;
}

/**
 * The files that let katkee.com links open the app directly (Android App Links, iOS Universal
 * Links), for the paths of shared profiles and Stories. iOS needs the Apple Team ID: without it
 * there's no file, and links open the "Open in Katkee" page in Safari instead.
 */
function appLinkFiles(site) {
  const { android, ios } = site.appLinks;
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(android.package)) throw new Error(`appLinks.android.package ${android.package} is not a package name`);
  if (!android.sha256CertFingerprints.length) throw new Error('appLinks.android.sha256CertFingerprints needs at least the upload key');
  for (const fp of android.sha256CertFingerprints) if (!FINGERPRINT.test(fp)) throw new Error(`appLinks.android: ${fp} is not a SHA-256 fingerprint (AA:BB:..., 32 pairs, upper case)`);
  const files = {
    '/.well-known/assetlinks.json': ['assetlinks.json', Buffer.from(JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: android.package, sha256_cert_fingerprints: android.sha256CertFingerprints },
    }], null, 2) + '\n')],
  };
  if (ios.teamId) {
    if (!/^[A-Z0-9]{10}$/.test(ios.teamId)) throw new Error(`appLinks.ios.teamId ${ios.teamId} is not an Apple Team ID (10 letters and digits)`);
    files['/.well-known/apple-app-site-association'] = ['apple-app-site-association.json', Buffer.from(JSON.stringify({
      applinks: { details: [{ appIDs: [`${ios.teamId}.${ios.bundleId}`], components: [{ '/': '/u/*' }, { '/': '/s/*' }] }] },
    }, null, 2) + '\n')];
  }
  return files;
}

function build() {
  const site = JSON.parse(read('site.json'));
  const origin = new URL(site.origin);
  if (origin.protocol !== 'https:' || origin.origin !== site.origin) throw new Error('site.json origin must be an exact https:// origin');
  for (const url of Object.values(site.stores)) if (url && !/^https:\/\//.test(url)) throw new Error(`store link ${url} must be https`);

  const files = new Map();
  const assets = {};
  const assetUrl = {};
  for (const [name, source] of [['site.css', 'src/site.css'], ['katkee-icon.svg', 'src/images/katkee-icon.svg'], ['social-card.png', 'src/images/social-card.png']]) {
    const data = fs.readFileSync(path.join(here, source));
    const file = hashed(name, data);
    files.set(`assets/${file}`, data);
    assets[file] = TYPES[path.extname(name)];
    assetUrl[name] = `/assets/${file}`;
  }
  const rootFiles = {
    '/favicon.ico': ['favicon.ico', fs.readFileSync(path.join(here, 'src/images/favicon.ico'))],
    '/apple-touch-icon.png': ['apple-touch-icon.png', fs.readFileSync(path.join(here, 'src/images/apple-touch-icon.png'))],
  };

  const legal = (file) => markdown(fs.readFileSync(path.join(root, 'legal', file), 'utf8'), `legal/${file}`);
  const privacy = legal('PRIVACY_POLICY.md');
  const terms = legal('TERMS_OF_SERVICE.md');
  const legalPage = (doc) => `<article class="legal">
<header class="page-head wrap-narrow">
<p class="eyebrow">Legal</p>
<h1>${escape(doc.title.replace(/^Katkee /, ''))}</h1>
<p class="updated">Last updated ${escape(doc.updated)}</p>
</header>
<div class="wrap-narrow legal-body">
<nav class="toc" aria-label="On this page">
<p class="toc-title">On this page</p>
<ul>
${doc.toc.map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`).join('\n')}
</ul>
</nav>
<div class="prose">
${doc.html}
</div>
</div>
</article>`;

  const pages = [
    { route: '/', file: 'index.html', title: `${site.name}: ${site.tagline.replace(/\.$/, '')}`, description: site.description, content: read('src/pages/index.html'), body: 'home' },
    { route: '/support', file: 'support.html', title: `Help Center · ${site.name}`, description: `Answers to common questions about ${site.name}, and how to contact us.`, content: read('src/pages/support.html'), body: 'support' },
    { route: '/delete-account', file: 'delete-account.html', title: `Delete your account · ${site.name}`, description: `How to delete your ${site.name} account, in the app or by email, and what happens to your data.`, content: read('src/pages/delete-account.html'), body: 'delete' },
    { route: '/child-safety', file: 'child-safety.html', title: `Child Safety Standards · ${site.name}`, description: `${site.name}'s standards against child sexual abuse and exploitation: what isn't allowed, how to report it and what we do.`, content: read('src/pages/child-safety.html'), body: 'delete' },
    { route: '/privacy', file: 'privacy.html', title: `Privacy Policy · ${site.name}`, description: `What ${site.name} collects, how we use it, who can see it and the choices you have.`, content: legalPage(privacy), body: 'legal-page' },
    { route: '/terms', file: 'terms.html', title: `Terms of Service · ${site.name}`, description: `The terms for using ${site.name}.`, content: legalPage(terms), body: 'legal-page' },
    { route: null, file: '404.html', title: `Page not found · ${site.name}`, description: site.description, content: read('src/pages/404.html'), body: 'not-found' },
    // Shared links (/u/<username>, /s/<story id>) for people without the app. It says nothing
    // about the account or Story: those may be private, blocked or gone.
    { route: null, file: 'open.html', title: `Open in ${site.name}`, description: `Someone shared this with you on ${site.name}. Open it in the app.`, content: read('src/pages/open.html'), body: 'open', url: `${site.origin}/${OPEN_MARKERS.linkPath}`, appLink: OPEN_MARKERS.appLink },
  ];
  const routes = new Set(pages.filter((p) => p.route).map((p) => p.route));
  const layout = read('src/layout.html');

  const context = { site, contact: site.contact, origin: site.origin, storeButtons: storeButtons(site), getKatkee: getKatkee(site) };
  const lookup = (key, page) => {
    const value = key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), { ...context, ...page });
    if (value === undefined || value === null) throw new Error(`${page.file}: unknown placeholder {{${key}}}`);
    return value;
  };
  const fill = (template, page) => template
    .replace(/\{\{\{([\w.]+)\}\}\}/g, (_, key) => String(lookup(key, page)))
    .replace(/\{\{asset:([\w.-]+)\}\}/g, (_, name) => { if (!assetUrl[name]) throw new Error(`${page.file}: unknown asset ${name}`); return assetUrl[name]; })
    .replace(/\{\{current:([\w/-]+)\}\}/g, (_, route) => (route === page.route ? ' aria-current="page"' : ''))
    .replace(/\{\{([\w.]+)\}\}/g, (_, key) => escape(lookup(key, page)));

  for (const page of pages) {
    const pageContext = { ...page, url: page.url ?? `${site.origin}${page.route ?? '/'}`, robots: page.route ? 'index, follow' : 'noindex' };
    const html = fill(layout, { ...pageContext, content: fill(page.content, pageContext) });
    // Refuse what would break the strict Content-Security-Policy, or a broken link.
    if (/\{\{|\}\}/.test(html)) throw new Error(`${page.file}: unfilled placeholder`);
    if (/<script|\son[a-z]+=|\sstyle=|javascript:/i.test(html)) throw new Error(`${page.file}: scripts and inline styles are not allowed (the site's Content-Security-Policy blocks them)`);
    for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
      if (href.startsWith('#') || href.startsWith('mailto:')) continue;
      // The open page's own address and app link are filled in per request by the API.
      if (page.file === 'open.html' && (href === OPEN_MARKERS.appLink || href === page.url)) continue;
      const local = href.startsWith(site.origin) ? href.slice(site.origin.length) || '/' : href;
      if (!local.startsWith('/')) { if (!/^https:\/\//.test(local)) throw new Error(`${page.file}: link ${href} must be https`); continue; }
      const pathname = local.split('#')[0].split('?')[0];
      if (!routes.has(pathname) && !Object.values(assetUrl).includes(pathname) && !rootFiles[pathname]) throw new Error(`${page.file}: broken link ${href}`);
    }
    for (const [, email] of html.matchAll(/mailto:([^"?]+)/g)) {
      if (!Object.values(site.contact).includes(email)) throw new Error(`${page.file}: ${email} is not one of the contact addresses in site.json`);
    }
    for (const marker of Object.values(OPEN_MARKERS)) {
      if (html.includes(marker) !== (page.file === 'open.html')) throw new Error(`${page.file}: ${marker} belongs on open.html only`);
    }
    files.set(page.file, Buffer.from(html));
  }
  // A link to a section ("/terms#grievances", "#contact") must name a section that exists.
  const fileOf = new Map(pages.filter((p) => p.route).map((p) => [p.route, p.file]));
  const idsIn = (file) => new Set([...files.get(file).toString().matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const page of pages) {
    for (const [, href] of files.get(page.file).toString().matchAll(/\shref="([^"]*#[^"]*)"/g)) {
      const local = href.startsWith(site.origin) ? href.slice(site.origin.length) : href;
      if (!local.startsWith('/') && !local.startsWith('#')) continue;
      const [pathname, fragment] = local.split('#');
      const target = pathname ? fileOf.get(pathname.split('?')[0]) : page.file;
      if (target && fragment && !idsIn(target).has(fragment)) throw new Error(`${page.file}: link ${href} names no section on ${target}`);
    }
  }

  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...routes].map((r) => `  <url><loc>${site.origin}${r}</loc></url>`).join('\n')}\n</urlset>\n`;
  rootFiles['/robots.txt'] = ['robots.txt', Buffer.from(robots)];
  rootFiles['/sitemap.xml'] = ['sitemap.xml', Buffer.from(sitemap)];
  Object.assign(rootFiles, appLinkFiles(site));
  for (const [file, data] of Object.values(rootFiles)) files.set(file, data);

  const manifest = {
    generatedBy: 'website/build.cjs',
    host: origin.host,
    pages: Object.fromEntries(pages.filter((p) => p.route).map((p) => [p.route, p.file])),
    notFound: '404.html',
    openInApp: { file: 'open.html', markers: OPEN_MARKERS },
    assets,
    files: Object.fromEntries(Object.entries(rootFiles).map(([route, [file]]) => [route, { file, type: TYPES[path.extname(file)] }])),
  };
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  return files;
}

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

function main() {
  const files = build();
  const onDisk = new Set(listFiles(publicDir));
  if (process.argv.includes('--check')) {
    const problems = [];
    for (const [file, data] of files) {
      if (!onDisk.has(file)) problems.push(`missing ${file}`);
      else if (!fs.readFileSync(path.join(publicDir, file)).equals(data)) problems.push(`out of date ${file}`);
      onDisk.delete(file);
    }
    for (const file of onDisk) problems.push(`not made by the build: ${file}`);
    if (problems.length) {
      console.error(`website/public is stale (run node website/build.cjs):\n- ${problems.join('\n- ')}`);
      process.exitCode = 1;
    } else console.log(`website/public is up to date (${files.size} files).`);
    return;
  }
  fs.rmSync(publicDir, { recursive: true, force: true });
  for (const [file, data] of files) {
    const target = path.join(publicDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  console.log(`Wrote ${files.size} files to website/public.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { build, markdown };
