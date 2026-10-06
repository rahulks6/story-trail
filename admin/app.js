'use strict';
const $ = id => document.getElementById(id);
let principal, permissionCatalog = [], page = 'Dashboard', offset = 0, objectUrls = [], renderVersion = 0;
const has = p => principal?.role === 'SUPER_ADMIN' || principal?.permissions.includes(p);
function el(tag, text, cls) { const n = document.createElement(tag); if (tag === 'form')
    n.addEventListener('submit', e => e.preventDefault()); if (text !== undefined)
    n.textContent = String(text); if (cls)
    n.className = cls; return n; }
function message(text) { $('message').textContent = text; }
// Uploaded videos are processed (poster, renditions, metadata removed) before they can be used.
async function processedMedia(media) {
    for (let waited = 0; media.status === 'processing'; waited += 2) {
        if (waited >= 600)
            throw Error('The video is still processing. Save the draft again in a few minutes.');
        message('Processing video… ' + waited + ' s');
        await new Promise(resolve => setTimeout(resolve, 2000));
        media = (await api('media/' + media.id)).media;
    }
    if (media.status !== 'ready')
        throw Error(media.processingError || 'This media could not be processed. Choose a different file.');
    message('');
    return media;
}
async function api(path, method = 'GET', data) { const headers = {}; if (method !== 'GET')
    headers['X-CSRF-Token'] = sessionStorage.getItem('katkee.csrf') || ''; if (data && !(data instanceof Blob))
    headers['Content-Type'] = 'application/json'; if (data instanceof Blob)
    headers['Content-Type'] = data.type; const r = await fetch('/api/v1/admin/' + path, { method, credentials: 'same-origin', headers, body: data ? (data instanceof Blob ? data : JSON.stringify(data)) : undefined }); const j = r.status === 204 ? null : await r.json(); if (!r.ok) {
    if (r.status === 401 && document.body.dataset.page !== 'login') {
        location.assign('/admin/login');
    }
    throw Error(j?.message || 'Request failed. Check the fields and retry.');
} return j; }
function button(text, action, secondary = false) { const n = el('button', text, secondary ? 'secondary' : ''); n.type = 'button'; n.onclick = async () => { n.disabled = true; message(''); try {
    await action();
}
catch (e) {
    message(e.message);
}
finally {
    n.disabled = false;
} }; return n; }
function field(form, name, label, type = 'text', value = '', options) { const l = el('label', label); const n = el(options ? 'select' : type === 'textarea' ? 'textarea' : 'input'); n.name = name; if (!options && type !== 'textarea')
    n.type = type; if (options)
    for (const v of options) {
        // Explicit value: relabelling an option (e.g. id -> advertiser name) must not change what is submitted.
        const o = el('option', v);
        o.value = v;
        n.append(o);
    } n.value = value; n.required = true; l.append(n); form.append(l); return n; }
function values(form) { return Object.fromEntries(new FormData(form)); }
function card(title) { const c = el('article', undefined, 'card'); if (title)
    c.append(el('h2', title)); return c; }
function fields(c, data) { const dl = el('dl'); for (const [k, v] of Object.entries(data)) {
    if (v === null || typeof v === 'object')
        continue;
    dl.append(el('dt', k), el('dd', v));
} c.append(dl); }
async function mutate(path, data, label) { if (!confirm(label))
    return; await api(path, 'POST', { ...data, confirmed: true }); message('Saved.'); await render(); }
function actions(c) { const a = el('div', undefined, 'actions'); c.append(a); return a; }
async function preview(container, url, caption = '', brand = 'Sponsored preview', destination) { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok)
    throw Error('Preview unavailable.'); const blob = await r.blob(); const src = URL.createObjectURL(blob); objectUrls.push(src); const box = el('div', undefined, 'preview'); box.append(el('strong', brand), el('span', 'Sponsored', 'tag')); const media = el(blob.type.startsWith('video/') ? 'video' : 'img'); media.src = src; if (media.tagName === 'VIDEO') {
    media.controls = true;
    media.preload = 'metadata';
}
else
    media.alt = 'Reported or sponsored media'; box.append(media, el('p', caption)); if (destination) {
    const a = el('a', 'Open destination');
    a.href = destination;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    box.append(a);
} container.append(box); }
// Analytics (spec section 15): server-side daily totals only; no person is identifiable here.
const count = v => v === null || v === undefined ? '—' : Number(v).toLocaleString();
const percent = v => v === null || v === undefined ? '—' : (Math.round(v * 1000) / 10) + '%';
function svgNode(tag, attrs) { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; }
/** One bar per day of the selected period, so a short history reads as such instead of filling the chart. */
function activeUsersChart(daily, days, today) {
    const box = card('Active users by day');
    const byDay = new Map(daily.map(d => [d.day, d.metrics.users?.dau ?? 0]));
    const end = Date.parse(today + 'T00:00:00Z');
    const series = Array.from({ length: days }, (_, i) => { const day = new Date(end - (days - 1 - i) * 86400000).toISOString().slice(0, 10); return { day, dau: byDay.get(day) ?? 0 }; });
    const max = Math.max(1, ...series.map(d => d.dau)), width = 1000, height = 150, step = width / series.length;
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height + 20}`, role: 'img', class: 'chart', 'aria-label': `Daily active users from ${series[0].day} to ${today}: latest ${series.at(-1).dau}, highest ${max}` });
    series.forEach((d, i) => {
        if (!d.dau) return;
        const h = Math.max(2, Math.round((d.dau / max) * height));
        const bar = svgNode('rect', { x: (i * step + step * 0.15).toFixed(1), y: height - h, width: Math.max(1, step * 0.7).toFixed(1), height: h, rx: 2 });
        const title = svgNode('title', {}); title.textContent = `${d.day}: ${d.dau} active`; bar.append(title); svg.append(bar);
    });
    svg.append(svgNode('line', { x1: 0, x2: width, y1: height + 0.5, y2: height + 0.5, class: 'axis' }));
    for (const [text, x, anchor] of [[series[0].day, 0, 'start'], [today, width, 'end']]) { const t = svgNode('text', { x, y: height + 17, 'text-anchor': anchor }); t.textContent = text; svg.append(t); }
    box.append(svg);
    if (!daily.length) box.append(el('p', 'No days computed yet: use Refresh now.', 'muted'));
    return box;
}
function table(headings, rows) {
    const wrap = el('div', undefined, 'table-wrap'), t = el('table'), head = el('tr');
    for (const h of headings) { const th = el('th', h); th.scope = 'col'; head.append(th); }
    t.append(el('thead'), el('tbody')); t.tHead.append(head);
    for (const r of rows) { const tr = el('tr'); for (const v of r) tr.append(el('td', v)); t.tBodies[0].append(tr); }
    wrap.append(t);
    return wrap;
}
async function analyticsPage(c) {
    let days = 30;
    try { days = Number(sessionStorage.getItem('katkee.analyticsDays')) || 30; } catch { /* storage unavailable */ }
    const data = await api('analytics?days=' + days);
    c.replaceChildren();
    const select = el('select');
    select.setAttribute('aria-label', 'Period');
    for (const d of [7, 30, 90]) { const o = el('option', 'Last ' + d + ' days'); o.value = String(d); o.selected = d === data.days; select.append(o); }
    select.onchange = () => { try { sessionStorage.setItem('katkee.analyticsDays', select.value); } catch { /* storage unavailable */ } void render(); };
    const bar = el('div', undefined, 'toolbar');
    bar.append(el('p', `Totals only, no individual people. Days run on ${data.timeZone} time. ` + (data.computedAt ? 'Updated ' + new Date(data.computedAt).toLocaleString() + '.' : 'Not computed yet: use Refresh now.'), 'muted'), select,
        button('Refresh now', async () => { await api('analytics/refresh', 'POST', {}); await render(); message('Analytics refreshed.'); }, true));
    c.append(bar);

    const p = data.period.counts, r = data.period.rates, latest = data.daily.at(-1)?.metrics ?? {}, b = data.backlog;
    const grid = el('div', undefined, 'grid');
    for (const [label, value] of [['Daily active users', data.live.dau], ['Weekly active users', data.live.wau], ['Monthly active users', data.live.mau],
        ['New registrations', p.users?.registrations ?? 0], ['Returning users today', latest.users?.returning ?? 0], ['Active creators today', latest.stories?.activeCreators ?? 0]]) {
        const box = card(label);
        box.append(el('p', count(value), 'metric'));
        grid.append(box);
    }
    c.append(grid, activeUsersChart(data.daily, data.days, data.today));

    const section = (title, note, rows) => { const box = card(title); if (note) box.append(el('p', note, 'muted')); fields(box, Object.fromEntries(rows)); return box; };
    const totals = el('div', undefined, 'form-grid');
    totals.append(
        section('Stories', `Last ${data.days} days.`, [['Published', count(p.stories?.published)], ['Viewed', count(p.stories?.views)], ['Watched per viewer per day', r.storiesPerViewer ?? '—'],
            ['Completion rate', percent(r.completionRate)], ['Average watch time', r.averageWatchSeconds === null ? '—' : r.averageWatchSeconds + ' s'], ['Replays', count(p.stories?.replays)],
            ['Started in the editor', count(p.app?.storiesStarted)], ['Highlights created', count(p.stories?.highlightsCreated)], ['Highlight views', count(p.app?.highlightViews)]]),
        section('Engagement and DMs', `Last ${data.days} days.`, [['Likes', count(p.engagement?.likes)], ['Comments', count(p.engagement?.comments)], ['Shares', count(p.engagement?.shares)],
            ['Follows', count(p.engagement?.follows)], ['Profile views', count(p.app?.profileViews)], ['Searches', count(p.app?.searches)], ['DMs sent', count(p.dms?.sent)], ['DMs delivered', count(p.dms?.received)]]),
        section('App health', 'Crashes are JavaScript crashes reported by the app on its next launch.', [['App sessions', count(p.app?.sessions)], ['Crash-free sessions', percent(r.crashFreeSessions)],
            ['Crashes', count(p.app?.crashes)], ['Upload success rate', percent(r.uploadSuccessRate)], ['Uploads succeeded', count(p.app?.uploadsSucceeded)], ['Uploads failed', count(p.app?.uploadsFailed)],
            ['Processing failures', count(p.app?.processingFailures)]]),
        section('Platforms today', 'People active today on each platform (one person can use two).', [['Android', count(latest.users?.platforms?.android)], ['iOS', count(latest.users?.platforms?.ios)],
            ['Web', count(latest.users?.platforms?.web)], ['Not reported', count(latest.users?.platforms?.unknown)]]),
        section('Moderation', 'Backlog is live; filed and resolved cover the period.', [['Reports filed', count(p.moderation?.reports)], ['Reports resolved', count(p.moderation?.resolved)],
            ['Open', count(b.open)], ['Under review', count(b.underReview)], ['Appealed', count(b.appealed)], ['Open appeals', count(b.appealsOpen)],
            ['Oldest open report', b.oldestOpenAt ? new Date(b.oldestOpenAt).toLocaleString() : '—']]),
        section('Sponsored Stories', `Last ${data.days} days.`, [['Impressions', count(p.ads?.impressions)], ['Clicks', count(p.ads?.clicks)], ['Click rate', percent(r.adClickRate)],
            ['Completions', count(p.ads?.completions)], ['Completion rate', percent(r.adCompletionRate)], ['Hides', count(p.ads?.hides)], ['Hide rate', percent(r.adHideRate)],
            ['Reports', count(p.ads?.reports)], ['Report rate', percent(r.adReportRate)]]));
    c.append(totals);

    c.append(el('h2', 'By day'));
    c.append(data.daily.length ? table(['Day', 'Active', 'Weekly', 'Monthly', 'New', 'Returning', 'Stories', 'Views', 'Completion', 'Likes', 'Comments', 'DMs', 'Upload success', 'Crash-free', 'Reports', 'Ad impressions', 'Ad click rate'],
        [...data.daily].reverse().map(d => { const m = d.metrics; return [d.day, count(m.users?.dau), count(m.users?.wau), count(m.users?.mau), count(m.users?.registrations), count(m.users?.returning),
            count(m.stories?.published), count(m.stories?.views), percent(d.rates.completionRate), count(m.engagement?.likes), count(m.engagement?.comments), count(m.dms?.sent),
            percent(d.rates.uploadSuccessRate), percent(d.rates.crashFreeSessions), count(m.moderation?.reports), count(m.ads?.impressions), percent(d.rates.adClickRate)]; }))
        : el('p', 'No days computed yet.', 'muted'));

    c.append(el('h2', 'Retention'), el('p', 'Of the people who joined on a day, the share active exactly 1, 7 and 30 days later. Pending until that day has finished.', 'muted'));
    const retained = (v, rate) => v === null ? 'pending' : `${percent(rate)} (${count(v)})`;
    c.append(data.retention.length ? table(['Signup day', 'People', 'Day 1', 'Day 7', 'Day 30'],
        [...data.retention].reverse().map(x => [x.cohortDay, count(x.cohortSize), retained(x.d1, x.d1Rate), retained(x.d7, x.d7Rate), retained(x.d30, x.d30Rate)]))
        : el('p', 'No signups in this period yet.', 'muted'));
}
const sections = [['Dashboard', 'reports.read'], ['Analytics', 'analytics.read'], ['Reports', 'reports.read'], ['Moderation', 'moderation.history.read'], ['Users', 'users.view'], ['Ads', 'ads.analytics.read'], ['Appeals', 'reports.review'], ['Admins', 'admins.read'], ['Audit Logs', 'audit.read'], ['Security', 'security.alerts.read'], ['Link safety', 'safety.settings.manage'], ['Settings', 'ads.analytics.read']];
async function render() { const version = ++renderVersion; for (const url of objectUrls)
    URL.revokeObjectURL(url); objectUrls = []; $('title').textContent = page; const c = $('content'); c.replaceChildren(el('p', 'Loading…', 'muted')); for (const n of $('navigation').children)
    n.setAttribute('aria-current', n.textContent === page ? 'page' : 'false'); try {
    if (page === 'Dashboard') {
        const data = await api('dashboard');
        c.replaceChildren();
        const grid = el('div', undefined, 'grid');
        for (const [label, key] of [['Moderation queue', 'queue'], ['High priority', 'highPriority'], ['Reports today', 'reportsToday'], ['Resolved today', 'resolvedToday'], ['Open appeals', 'appealsOpen'], ['Pending ad reviews', 'pendingAds'], ['Restricted accounts', 'restricted']]) {
            const box = card(label);
            box.append(el('p', data[key] ?? 0, 'metric'));
            grid.append(box);
        }
        c.append(grid);
        return;
    }
    if (page === 'Analytics') {
        await analyticsPage(c);
        return;
    }
    if (page === 'Security') {
        const data = await api('security-alerts?limit=50');
        c.replaceChildren();
        const mine = card('Your two-step verification');
        mine.append(el('p', 'Backup codes sign you in once each if you lose your authenticator. Generating new ones invalidates the old set (requires recent verification).', 'muted'),
            button('Generate new backup codes', async () => { if (!confirm('Replace all of your existing backup codes?')) return; const r = await api('mfa/backup-codes', 'POST', { confirmed: true }); const list = el('ol', undefined, 'codes'); for (const code of r.backupCodes) list.append(el('li', code)); mine.append(el('p', 'Save these now. They will not be shown again.'), list); }));
        c.append(mine, el('h2', 'Open security alerts'));
        if (!data.items.length) c.append(el('p', 'No open alerts.', 'muted'));
        for (const alert of data.items) {
            const box = card(alert.kind.replace(/_/g, ' '));
            fields(box, { When: new Date(alert.created_at).toLocaleString(), Account: alert.user_id || '—', Details: JSON.stringify(alert.metadata) });
            actions(box).append(button('Acknowledge', () => mutate('security-alerts/' + alert.id + '/acknowledge', {}, 'Mark this alert as reviewed?')));
            c.append(box);
        }
        return;
    }
    if (page === 'Link safety') {
        const data = await api('safety/blocked-domains?limit=100');
        c.replaceChildren();
        const f = el('form', undefined, 'card');
        f.append(el('h2', 'Block a domain'), el('p', 'Nobody can post links to a blocked domain or its subdomains in comments, messages, captions, bios or ad destinations. Changes are recorded in the audit log.', 'muted'));
        field(f, 'domain', 'Domain (e.g. scam.example)');
        field(f, 'reason', 'Reason');
        f.append(button('Block domain', () => { const v = values(f); return mutate('safety/blocked-domains', { domain: v.domain, reason: v.reason }, 'Block links to ' + v.domain + '?'); }));
        c.append(f, el('h2', 'Blocked domains'));
        if (!data.items.length) c.append(el('p', 'No domains are blocked.', 'muted'));
        for (const d of data.items) {
            const box = card(d.domain);
            fields(box, { Reason: d.reason, 'Blocked by': d.by ? '@' + d.by : '—', When: new Date(d.createdAt).toLocaleString() });
            actions(box).append(button('Unblock', () => mutate('safety/blocked-domains/remove', { domain: d.domain }, 'Allow links to ' + d.domain + ' again?'), true));
            c.append(box);
        }
        return;
    }
    if (page === 'Settings') {
        const s = await api('ad-settings');
        c.replaceChildren();
        const f = el('form', undefined, 'card');
        f.append(el('h2', 'Sponsored frequency'), el('p', 'Delivery is optional and feature-flagged. Budgets are planning values; no billing or spend is recorded.', 'muted'));
        field(f, 'organicGap', 'Minimum organic creators between ads', 'number', s.organic_gap).min = '3';
        field(f, 'sessionCap', 'Maximum reserved ads per 30-minute session', 'number', s.session_cap);
        field(f, 'dailyCap', 'Maximum reserved ads per day', 'number', s.daily_cap);
        if (principal.role === 'SUPER_ADMIN')
            f.append(button('Save controls', () => { const v = values(f); return mutate('ad-settings', Object.fromEntries(Object.entries(v).map(([k, v]) => [k, Number(v)])), 'Update delivery frequency?'); }));
        c.append(f);
        return;
    }
    await list(c, version);
}
catch (e) {
    c.replaceChildren(el('p', e.message), button('Retry', render));
}
finally {
    if (version === renderVersion)
        $('content').replaceChildren(...c.childNodes);
} }
async function list(c, version) { const routes = { Reports: 'reports', Moderation: 'history', Users: 'users', Ads: 'campaigns', Appeals: 'appeals', Admins: 'admins', 'Audit Logs': 'audit' }; const route = routes[page]; const data = await api(route + '?limit=20&offset=' + offset + (page === 'Reports' ? '&status=' : '')); if (version !== renderVersion)
    return; c.replaceChildren(); const tools = el('div', undefined, 'toolbar'); if (['Reports', 'Users', 'Ads'].includes(page)) {
    const search = el('input');
    search.placeholder = 'Search ID or username / campaign name';
    tools.append(search, button('Search', () => searchList(c, route, search.value)));
} if (page === 'Admins' && principal.role === 'SUPER_ADMIN')
    tools.append(button('Add Admin', () => adminForm(c))); if (page === 'Ads' && has('ads.create'))
    tools.append(button('New advertiser', () => advertiserForm(c)), button('New campaign', () => campaignForm(c))); c.append(tools); if (page === 'Reports') {
    const filters = el('form', undefined, 'form-grid');
    field(filters, 'type', 'Content type', 'text', '', ['', 'story', 'comment', 'user', 'ad']);
    field(filters, 'status', 'Status', 'text', 'OPEN', ['', 'OPEN', 'UNDER_REVIEW', 'ACTIONED', 'DISMISSED', 'APPEALED', 'CLOSED']);
    field(filters, 'reason', 'Reason', 'text', '', ['', 'spam', 'harassment', 'nudity', 'violence', 'hate_speech', 'self_harm', 'impersonation', 'scam', 'other']);
    field(filters, 'minPriority', 'Minimum priority', 'text', '', ['', '1', '2', '3']);
    filters.append(button('Filter', async () => { const q = new URLSearchParams(values(filters)); const d = await api('reports?limit=20&' + q); const results = $('results'); results.replaceChildren(); await renderItems(results, d.items); }));
    c.append(filters);
} if (page === 'Audit Logs') {
    const filters = el('form', undefined, 'form-grid');
    for (const [name, label, type] of [['action', 'Action starts with (e.g. MODERATION_)', 'text'], ['actor', 'Actor user ID', 'text'], ['from', 'From', 'datetime-local'], ['to', 'To', 'datetime-local']]) field(filters, name, label, type).required = false;
    filters.append(button('Filter', async () => { const v = Object.fromEntries(Object.entries(values(filters)).filter(([, x]) => x).map(([k, x]) => [k, k === 'from' || k === 'to' ? new Date(x).toISOString() : k === 'action' ? x.toUpperCase() : x])); const d = await api('audit?limit=20&' + new URLSearchParams(v)); const results = $('results'); results.replaceChildren(); await renderItems(results, d.items); }),
        button('Verify integrity', async () => { const r = await api('audit/verify'); message(r.intact ? `Audit chain intact: ${r.rows} records, head ${String(r.headHash).slice(0, 16)}…` : `TAMPERING DETECTED at record ${r.firstProblem.chain_seq}: ${r.firstProblem.problem}`); }, true));
    c.append(filters);
} const results = el('div'); results.id = 'results'; c.append(results); await renderItems(results, data.items); const pager = actions(c); if (offset > 0)
    pager.append(button('Previous', () => { offset = Math.max(0, offset - 20); return render(); }, true)); if (data.items.length === 20)
    pager.append(button('Next', () => { offset += 20; return render(); }, true)); }
async function searchList(c, route, term) { const version = renderVersion; const data = await api(route + '?limit=20&search=' + encodeURIComponent(term) + (route === 'reports' ? '&status=' : '')); if (version !== renderVersion)
    return; const results = $('results'); results.replaceChildren(); await renderItems(results, data.items); }
async function renderItems(container, items) { if (!items.length) {
    container.append(el('p', 'No matching records.', 'muted'));
    return;
} for (const item of items) {
    const box = card(item.name || item.username || item.action || item.id);
    fields(box, item);
    const a = actions(box);
    if (page === 'Reports')
        a.append(button('Review report', () => review(item.id)));
    if (page === 'Users') {
        for (const [label, action, perm] of [['Restrict', 'restrict', 'users.restrict'], ['Suspend', 'suspend', 'users.suspend'], ['Restore account', 'restore_account', 'users.suspend']])
            if (has(perm))
                a.append(button(label, () => { const reason = prompt('Reason for this account action'); if (reason)
                    return mutate('moderate', { targetType: 'user', targetId: item.id, action, reason }, label + ' this account?'); }, true));
    }
    if (page === 'Moderation' && ['remove'].includes(item.action) && item.target_type !== 'ad' && has('content.restore'))
        a.append(button('Restore content', () => { const reason = prompt('Reason for restoring content'); if (reason)
            return mutate('moderate', { targetType: item.target_type, targetId: item.target_id, action: 'restore', reason }, 'Restore content subject to original privacy and expiry?'); }));
    if (page === 'Admins' && item.role === 'ADMIN')
        a.append(button('Edit access', () => adminForm($('content'), item)), button('Reset two-step verification', () => mutate('admins/' + item.userId + '/mfa-reset', {}, 'Sign this admin out and require them to set up two-step verification again?'), true));
    if (page === 'Appeals' && item.action)
        fields(box, { 'Appealed action': item.action.action, 'On': item.action.targetType + ' ' + item.action.targetId, 'Action reason': item.action.reason, 'Report status': item.reportStatus || 'No report' });
    if (page === 'Appeals' && item.status === 'OPEN')
        for (const [decision, label, confirmText] of [['UPHELD', 'Uphold appeal (undo the action)', 'Uphold this appeal? The content or account is restored now and the report is closed.'], ['DENIED', 'Deny appeal (keep the action)', 'Deny this appeal? The action stays and the report is closed.']])
            a.append(button(label, () => { const reason = prompt('Resolution shown in the audit log'); if (reason)
                return mutate('appeals/' + item.id, { decision, version: item.version, reason }, confirmText); }, decision === 'DENIED'));
    if (page === 'Appeals' && item.reportId && has('reports.read'))
        a.append(button('Open report', () => review(item.reportId), true));
    if (page === 'Ads') {
        if (has('ads.edit') && ['DRAFT', 'REJECTED', 'PAUSED', 'APPROVED'].includes(item.status))
            a.append(button('Edit (requires new review)', () => editCampaignForm(item)));
        a.append(button('Preview', () => preview(box, '/api/v1/admin/campaigns/' + item.id + '/preview', item.creative.caption, item.advertiser, item.creative.destination)), ...(has('ads.analytics.read') ? [button('Analytics', async () => { const data = await api('campaigns/' + item.id + '/analytics'); const counts = Object.fromEntries(data.counts.map(x => [x.event, Number(x.count)])); const stats = card('Campaign analytics'); fields(stats, { Impressions: counts.ad_impression || 0, 'Qualified views': counts.ad_qualified_view || 0, Clicks: counts.ad_click || 0, 'CTR %': counts.ad_impression ? ((counts.ad_click || 0) / counts.ad_impression * 100).toFixed(2) : 0, 'Completion %': counts.ad_impression ? ((counts.ad_complete || 0) / counts.ad_impression * 100).toFixed(2) : 0, Hides: counts.ad_hide || 0, Reports: counts.ad_report || 0, Spend: 'Unavailable — no billing' }); box.append(stats); })] : []));
        for (const [action, states, perm] of [['submit', ['DRAFT', 'REJECTED'], 'ads.edit'], ['approve', ['PENDING_REVIEW'], 'ads.review'], ['reject', ['PENDING_REVIEW'], 'ads.review'], ['activate', ['APPROVED', 'PAUSED'], 'ads.edit'], ['pause', ['ACTIVE'], 'ads.pause'], ['complete', ['ACTIVE', 'PAUSED'], 'ads.edit']])
            if (states.includes(item.status) && has(perm))
                a.append(button(action, () => { const reason = prompt('Review / transition reason'); if (reason)
                    return mutate('campaigns/' + item.id + '/transition', { action, version: item.version, reason }, action + ' this campaign?'); }, true));
    }
    container.append(box);
} }
async function review(id) { const version = ++renderVersion; const data = await api('reports/' + id); if (version !== renderVersion)
    return; const c = el('div'); const box = card('Report review'); fields(box, data.report); box.append(el('p', 'Reports on this item: ' + data.counts.count)); if (data.target) {
    fields(box, data.target);
    if (data.target.mediaId)
        await preview(box, '/api/v1/admin/evidence/' + id, data.target.caption || '', 'Reported content');
} if (data.evidence && data.evidence.messages > 0) {
    // Messages the reporter attached; opening them is recorded in the audit log.
    const dm = el('div', undefined, 'notice');
    dm.append(el('p', data.evidence.messages + ' direct messages attached by the reporter (the reported message and the ones before it).'));
    if (has('reports.messages.read'))
        dm.append(button('View attached messages (logged)', async () => { const items = (await api('reports/' + id + '/messages')).items; const list = card('Attached messages'); for (const m of items)
            list.append(el('p', (m.fromReportedUser ? 'Reported user' : 'Reporter') + ' @' + (m.sender || 'unknown') + ' · ' + new Date(m.sentAt).toLocaleString() + ': ' + (m.purged ? '[removed by retention]' : (m.body ?? '[shared Story]')))); dm.append(list); }, true));
    else
        dm.append(el('p', 'Viewing them needs the reports.messages.read permission.', 'muted'));
    box.append(dm);
} const notes = el('textarea'); notes.placeholder = 'Reason for your decision'; box.append(notes); const a = actions(box); for (const [label, action, perm] of [['Keep content', 'keep', 'reports.review'], ['Remove content', 'remove', 'content.remove'], ['Restrict account', 'restrict', 'users.restrict'], ['Suspend account', 'suspend', 'users.suspend']]) {
    if (!has(perm) || !has('reports.review'))
        continue;
    if (['restrict', 'suspend'].includes(action) && data.report.target_type !== 'user')
        continue;
    if (action === 'remove' && data.report.target_type === 'user')
        continue;
    a.append(button(label, () => mutate('moderate', { reportId: id, version: data.report.version, action, reason: notes.value }, label + '?')));
} a.append(button('Back', render, true)); c.append(box); if (data.creator) {
    const who = card('Creator');
    fields(who, { Username: '@' + data.creator.username, 'Display name': data.creator.displayName, Joined: new Date(data.creator.joinedAt).toLocaleDateString(), State: data.creator.state, Followers: data.creator.followers, 'Previous actions': data.creator.priorActions, 'Open reports on account': data.creator.openReports });
    c.append(who);
} const history = card('History');
history.append(el('h3', 'Other reports on this item'));
for (const r of data.history.reports)
    history.append(el('p', `${r.status} · ${r.reason} · priority ${r.priority} · ${new Date(r.createdAt).toLocaleString()}`));
if (!data.history.reports.length)
    history.append(el('p', 'None.', 'muted'));
history.append(el('h3', 'Previous actions on this item and its creator'));
for (const act of data.history.actions)
    history.append(el('p', `${act.action} · ${act.targetType} · by @${act.by || 'unknown'} · ${act.reason} · ${new Date(act.createdAt).toLocaleString()}`));
if (!data.history.actions.length)
    history.append(el('p', 'None.', 'muted'));
history.append(el('h3', 'Appeals'));
for (const ap of data.history.appeals)
    history.append(el('p', `${ap.status} · ${ap.reason}${ap.resolution ? ' → ' + ap.resolution : ''}`));
if (!data.history.appeals.length)
    history.append(el('p', 'None.', 'muted'));
c.append(history);
const notesCard = card('Moderator notes');
for (const n of data.history.notes)
    notesCard.append(el('p', `@${n.by} · ${new Date(n.createdAt).toLocaleString()}: ${n.body}`));
if (!data.history.notes.length)
    notesCard.append(el('p', 'No notes yet.', 'muted'));
if (has('reports.review')) {
    const note = el('textarea'); note.placeholder = 'Add a note for other moderators (cannot be edited later)'; note.maxLength = 1000;
    notesCard.append(note, actions(notesCard));
    notesCard.lastChild.append(button('Add note', async () => { if (!note.value.trim()) return; await api('reports/' + id + '/notes', 'POST', { body: note.value }); await review(id); }));
}
c.append(notesCard);
if (version === renderVersion)
    $('content').replaceChildren(...c.childNodes); }
function adminForm(c, item) { c.replaceChildren(); const f = el('form', undefined, 'card'); f.append(el('h2', item ? 'Edit Admin access' : 'Add Admin'), el('p', 'Use an existing account ID from Users. Only ADMIN access can be assigned here.')); field(f, 'userId', 'Account ID', 'text', item?.userId || ''); for (const perm of permissionCatalog) {
    const label = el('label', perm, 'check');
    const check = el('input');
    check.type = 'checkbox';
    check.name = 'permission';
    check.value = perm;
    check.checked = item?.permissions.includes(perm) || false;
    label.prepend(check);
    f.append(label);
} const enabled = field(f, 'enabled', 'Access', 'text', item?.enabled === false ? 'Disabled' : 'Active', ['Active', 'Disabled']); f.append(button('Confirm access change', () => mutate('admins', { userId: f.elements.userId.value, role: 'ADMIN', permissions: [...f.querySelectorAll('input[name=permission]:checked')].map(n => n.value), enabled: enabled.value === 'Active', version: item?.version || 0 }, 'Confirm these exact Admin permissions?')), button('Cancel', render, true)); c.append(f); }
function advertiserForm(c) { c.replaceChildren(); const f = el('form', undefined, 'card'); f.append(el('h2', 'New advertiser')); field(f, 'name', 'Advertiser name'); field(f, 'userId', 'Public Katkee account ID'); f.append(button('Create advertiser', () => mutate('advertisers', values(f), 'Create this advertiser?')), button('Cancel', render, true)); c.append(f); }
// Details → Creative → Audience → Budget & schedule → Preview & review. The draft (or a
// submission for independent review) is saved at the end; approval and activation happen
// from the Ads list by a different Admin.
async function campaignForm(c) { c.replaceChildren(); const advertisers = await api('advertisers?limit=50'); if (!advertisers.items.length) {
    c.append(el('p', 'No advertisers yet. Create a public advertiser account first.'), button('New advertiser', () => advertiserForm(c)), button('Back', render, true));
    return;
}
const categories = (await api('ad-interest-categories')).items;
const f = el('form', undefined, 'card'); f.append(el('h2', 'Create campaign'));
const steps = ['Details', 'Creative', 'Audience', 'Budget & schedule', 'Preview & review'];
const progress = el('ol', undefined, 'steps'); for (const s of steps) progress.append(el('li', s)); f.append(progress);
const panes = steps.map(() => { const p = el('fieldset', undefined, 'form-grid'); f.append(p); return p; });
// 1. Details
field(panes[0], 'name', 'Campaign name'); const select = field(panes[0], 'advertiserId', 'Advertiser', 'text', '', advertisers.items.map(a => a.id)); for (const option of select.options)
    option.textContent = advertisers.items.find(a => a.id === option.value).name; let advertiserOffset = 50; if (advertisers.items.length === 50) {
    const more = button('Load more advertisers', async () => { const next = await api('advertisers?limit=50&offset=' + advertiserOffset); advertiserOffset += 50; for (const a of next.items) {
        const option = el('option', a.name);
        option.value = a.id;
        select.append(option);
    } if (next.items.length < 50)
        more.remove(); }, true);
    panes[0].append(more);
}
// 2. Creative
const file = field(panes[1], 'file', 'Photo / video', 'file'); file.accept = 'image/jpeg,image/png,video/mp4,video/quicktime'; field(panes[1], 'caption', 'Caption', 'textarea'); const cta = field(panes[1], 'cta', 'Call to action', 'text', 'Learn More', ['Learn More', 'Visit Website', 'Shop Now', 'Install', 'View Profile']); const dest = field(panes[1], 'destination', 'Public HTTPS destination', 'url');
cta.onchange = () => { const profile = cta.value === 'View Profile'; dest.required = !profile; dest.parentElement.hidden = profile; };
// 3. Audience: broad and non-sensitive only.
panes[2].append(el('p', 'Choose up to 5 interest categories, or none to reach everyone. Religion, health, sexual orientation, politics and other sensitive traits can never be targeted, and private messages are never used.', 'muted'));
const interestBox = el('div', undefined, 'checks'); for (const cat of categories) { const l = el('label', undefined, 'check'); const i = el('input'); i.type = 'checkbox'; i.name = 'interest'; i.value = cat.key; l.append(i, document.createTextNode(' ' + cat.label)); interestBox.append(l); }
const platformBox = el('div', undefined, 'checks'); for (const [key, label] of [['android', 'Android'], ['ios', 'iPhone']]) { const l = el('label', undefined, 'check'); const i = el('input'); i.type = 'checkbox'; i.name = 'platform'; i.value = key; l.append(i, document.createTextNode(' ' + label)); platformBox.append(l); }
panes[2].append(el('h3', 'Interests'), interestBox, el('h3', 'Platforms (none = both)'), platformBox);
const checked = (name) => [...f.querySelectorAll('input[name=' + name + ']:checked')].map(i => i.value);
// 4. Budget & schedule
field(panes[3], 'startAt', 'Start', 'datetime-local'); field(panes[3], 'endAt', 'End', 'datetime-local'); field(panes[3], 'budgetMinor', 'Planning budget (minor currency units)', 'number', '0'); field(panes[3], 'currency', 'Currency', 'text', 'INR'); field(panes[3], 'impressionLimit', 'Hard reservation allocation', 'number', '1000'); field(panes[3], 'userCap', 'Per-user campaign cap', 'number', '3'); field(panes[3], 'dailyCap', 'Per-user daily campaign cap', 'number', '1');
// 5. Preview & review
const previewBox = el('div'); panes[4].append(previewBox);
function renderPreview() { previewBox.replaceChildren(); const v = values(f); const selected = file.files[0]; const box = el('div', undefined, 'preview'); box.append(el('span', 'Sponsored', 'tag'), el('strong', select.options[select.selectedIndex]?.textContent || '')); if (selected) { const url = URL.createObjectURL(selected); objectUrls.push(url); const m = el(selected.type.startsWith('video/') ? 'video' : 'img'); m.src = url; if (m.tagName === 'VIDEO') m.controls = true; box.append(m); } box.append(el('p', v.caption || ''), el('span', v.cta, 'button-like'));
    const interests = checked('interest'), platforms = checked('platform');
    const summary = card('Summary'); fields(summary, { Advertiser: select.options[select.selectedIndex]?.textContent || '', 'Opens': v.cta === 'View Profile' ? "The advertiser's Katkee profile" : v.destination, Audience: interests.length ? 'Interested in ' + interests.map(k => categories.find(x => x.key === k).label).join(', ') : 'Everyone (broad)', Platforms: platforms.length ? platforms.map(k => k === 'ios' ? 'iPhone' : 'Android').join(', ') : 'Android and iPhone', Schedule: new Date(v.startAt).toLocaleString() + ' → ' + new Date(v.endAt).toLocaleString(), 'Impressions (hard limit)': v.impressionLimit, 'Per-person caps': v.userCap + ' total, ' + v.dailyCap + ' per day' });
    previewBox.append(box, summary, el('p', 'Saving keeps this as a draft. Submitting sends it for review by another Admin; it can be activated once approved.', 'muted')); }
let current = 0; const nav = actions(f);
const back = button('Back', async () => show(current - 1), true), next = button('Next', async () => { const invalid = [...panes[current].querySelectorAll('input,select,textarea')].find(n => !n.parentElement.hidden && !n.checkValidity()); if (invalid) { invalid.reportValidity(); return; } if (current === 2 && checked('interest').length > 5) throw Error('Choose at most 5 interest categories.'); show(current + 1); });
async function save(submit) { if (!f.reportValidity())
    return; const v = values(f); const selected = file.files[0]; if (!selected)
    throw Error('Select a photo or video.'); if (!confirm(submit ? 'Upload this creative and submit the campaign for independent review?' : 'Upload this creative and save a draft for independent review?'))
    return; const uploaded = await api('media/' + (selected.type.startsWith('video/') ? 'video' : 'photo'), 'POST', selected); const ready = await processedMedia(uploaded.media); delete v.file; delete v.interest; delete v.platform; for (const k of ['budgetMinor', 'impressionLimit', 'userCap', 'dailyCap'])
    v[k] = Number(v[k]); v.startAt = new Date(v.startAt).toISOString(); v.endAt = new Date(v.endAt).toISOString(); if (v.cta === 'View Profile') delete v.destination;
    const interests = checked('interest'), platforms = checked('platform'); const audience = {}; if (interests.length) audience.interests = interests; if (platforms.length) audience.platforms = platforms;
    const created = await api('campaigns', 'POST', { ...v, audience, mediaId: ready.id, confirmed: true });
    if (submit) await api('campaigns/' + created.id + '/transition', 'POST', { action: 'submit', version: created.version, reason: 'Submitted from the campaign wizard', confirmed: true });
    await render(); }
const saveDraft = button('Upload and save draft', () => save(false)), submitReview = button('Upload and submit for review', () => save(true), true);
nav.append(back, next, saveDraft, submitReview, button('Cancel', render, true));
function show(i) { current = Math.max(0, Math.min(steps.length - 1, i)); panes.forEach((p, j) => { p.hidden = j !== current; }); [...progress.children].forEach((li, j) => li.setAttribute('aria-current', j === current ? 'step' : 'false')); back.hidden = current === 0; next.hidden = current === steps.length - 1; next.textContent = current < steps.length - 1 ? 'Next: ' + steps[current + 1] : 'Next'; saveDraft.hidden = submitReview.hidden = current !== steps.length - 1; if (current === steps.length - 1) renderPreview(); }
show(0); c.append(f); }
if (document.body.dataset.page === 'login') {
    // Step 1 password; step 2 enroll (QR + confirm + one-time backup codes) or verify (code or backup code).
    // No Admin session cookie exists until the second factor succeeds.
    const box = $('login').parentElement, status = $('message');
    const finish = (result) => { sessionStorage.setItem('katkee.csrf', result.csrf); location.assign('/admin'); };
    function showBackupCodes(result) {
        const c = card('Save your backup codes');
        c.append(el('p', 'Each code signs you in once if you lose your authenticator. They will not be shown again.'));
        const list = el('ol', undefined, 'codes');
        for (const code of result.backupCodes) list.append(el('li', code));
        c.append(list, button('I saved these codes — continue', async () => finish(result)));
        box.replaceChildren(c, status);
    }
    function codeForm(title, intro, submitLabel, onCode, allowBackup) {
        const f = el('form'); f.append(el('h2', title), el('p', intro, 'muted'));
        const code = field(f, 'code', allowBackup ? 'Authenticator code or backup code' : '6-digit code');
        code.autocomplete = 'one-time-code'; code.inputMode = allowBackup ? 'text' : 'numeric';
        f.append(button(submitLabel, async () => { if (!f.reportValidity()) return; await onCode(code.value.trim()); }));
        f.onsubmit = (e) => { e.preventDefault(); f.querySelector('button').click(); };
        setTimeout(() => code.focus(), 0);
        return f;
    }
    async function enroll(challenge) {
        const setup = await api('mfa/enroll', 'POST', { challenge });
        const c = card('Set up two-step verification');
        c.append(el('p', 'Two-step verification is required for every Admin. Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy).'));
        const svg = new DOMParser().parseFromString(setup.qrSvg, 'image/svg+xml').documentElement;
        if (svg.nodeName === 'svg') { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code for your authenticator app'); svg.classList.add('qr'); c.append(document.importNode(svg, true)); }
        const manual = el('details'); manual.append(el('summary', "Can't scan? Enter this key"), el('code', setup.secret.replace(/(.{4})/g, '$1 ').trim()));
        c.append(manual, codeForm('Enter the code it shows', 'Codes refresh every 30 seconds.', 'Verify and finish setup', async (value) => showBackupCodes(await api('mfa/enroll/confirm', 'POST', { challenge, code: value })), false));
        box.replaceChildren(c, status);
    }
    function verify(challenge) {
        const c = card();
        c.append(codeForm('Two-step verification', 'Enter the current code from your authenticator app, or one of your backup codes.', 'Verify', async (value) => {
            const isBackup = /[a-z]/i.test(value) || value.replace(/\D/g, '').length !== 6;
            finish(await api('login/mfa', 'POST', isBackup ? { challenge, backupCode: value } : { challenge, code: value }));
        }, true));
        box.replaceChildren(c, status);
    }
    $('login').onsubmit = async (e) => { e.preventDefault(); const f = e.currentTarget; const submit = f.querySelector('button'); submit.disabled = true; try {
        const result = await api('login', 'POST', values(f));
        if (result.mfaEnrollmentRequired) await enroll(result.challenge);
        else if (result.mfaRequired) verify(result.challenge);
        else finish(result);
    }
    catch (e) {
        message(e.message);
    }
    finally {
        submit.disabled = false;
    } };
}
else {
    (async () => { try {
        const session = await api('session');
        principal = session.principal;
        permissionCatalog = session.permissions;
        const allowed = sections.filter(([name, p]) => (name === 'Ads' ? ['ads.create', 'ads.edit', 'ads.review', 'ads.pause', 'ads.analytics.read'].some(has) : has(p)) && (name !== 'Admins' || principal.role === 'SUPER_ADMIN'));
        for (const [name] of allowed)
            $('navigation').append(button(name, () => { page = name; offset = 0; return render(); }, true));
        page = allowed[0]?.[0] || 'Dashboard';
        $('signout').onclick = async () => { try {
            await api('logout', 'POST', {});
        }
        finally {
            sessionStorage.removeItem('katkee.csrf');
            location.assign('/admin/login');
        } };
        // Step-up for sensitive changes: password plus the current authenticator (or backup) code.
        $('reauth').onclick = () => { const dialog = el('dialog', undefined, 'card'); const form = el('form'); form.append(el('h2', 'Verify it\'s you'), el('p', 'Authorize sensitive changes for five minutes.')); const password = field(form, 'password', 'Password', 'password'); password.autocomplete = 'current-password'; const code = field(form, 'code', 'Authenticator code', 'text'); code.autocomplete = 'one-time-code'; code.required = principal.mfaVerified; form.append(button('Verify', async () => { await api('reauthenticate', 'POST', { password: password.value, code: code.value.trim() }); password.value = ''; code.value = ''; dialog.close(); dialog.remove(); message('Verified for five minutes.'); }), button('Cancel', () => { dialog.close(); dialog.remove(); }, true)); dialog.append(form); document.body.append(dialog); dialog.showModal(); password.focus(); };
        if (!allowed.length) {
            $('content').replaceChildren(el('p', 'No console permissions are assigned. Contact a Super Admin.'));
            return;
        }
        await render();
    }
    catch (e) {
        message(e.message);
    } })();
}
function editCampaignForm(item) { const c = $('content'); c.replaceChildren(); const f = el('form', undefined, 'card'); f.append(el('h2', 'Edit campaign'), el('p', 'Saving resets approval and invalidates outstanding deliveries. Submit for a new independent review before activation.', 'muted')); field(f, 'name', 'Campaign name', 'text', item.name); field(f, 'caption', 'Caption', 'textarea', item.creative.caption); field(f, 'cta', 'Call to action', 'text', item.creative.cta, ['Learn More', 'Visit Website', 'Shop Now', 'Install']); field(f, 'destination', 'Public HTTPS destination', 'url', item.creative.destination); field(f, 'startAt', 'Start (ISO date/time)', 'text', item.start_at); field(f, 'endAt', 'End (ISO date/time)', 'text', item.end_at); f.append(button('Save and reset approval', () => mutate('campaigns/' + item.id + '/edit', { ...values(f), version: item.version }, 'Save changes and revoke approval?')), button('Cancel', render, true)); c.append(f); }
