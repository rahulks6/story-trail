'use strict';
const $ = id => document.getElementById(id);
let principal, permissionCatalog = [], page = 'Dashboard', offset = 0, objectUrls = [], renderVersion = 0;
const has = p => principal?.role === 'SUPER_ADMIN' || principal?.permissions.includes(p);
function el(tag, text, cls) { const n = document.createElement(tag); if (tag === 'form')
    n.addEventListener('submit', e => e.preventDefault()); if (text !== undefined)
    n.textContent = String(text); if (cls)
    n.className = cls; return n; }
function message(text) { $('message').textContent = text; }
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
    for (const v of options)
        n.append(el('option', v)); n.value = value; n.required = true; l.append(n); form.append(l); return n; }
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
const sections = [['Dashboard', 'reports.read'], ['Reports', 'reports.read'], ['Moderation', 'moderation.history.read'], ['Users', 'users.view'], ['Ads', 'ads.analytics.read'], ['Appeals', 'reports.review'], ['Admins', 'admins.read'], ['Audit Logs', 'audit.read'], ['Security', 'security.alerts.read'], ['Settings', 'ads.analytics.read']];
async function render() { const version = ++renderVersion; for (const url of objectUrls)
    URL.revokeObjectURL(url); objectUrls = []; $('title').textContent = page; const c = $('content'); c.replaceChildren(el('p', 'Loading…', 'muted')); for (const n of $('navigation').children)
    n.setAttribute('aria-current', n.textContent === page ? 'page' : 'false'); try {
    if (page === 'Dashboard') {
        const data = await api('dashboard');
        c.replaceChildren();
        const grid = el('div', undefined, 'grid');
        for (const [label, key] of [['Moderation queue', 'queue'], ['High priority', 'highPriority'], ['Reports today', 'reportsToday'], ['Resolved today', 'resolvedToday'], ['Pending ad reviews', 'pendingAds'], ['Restricted accounts', 'restricted']]) {
            const box = card(label);
            box.append(el('p', data[key] ?? 0, 'metric'));
            grid.append(box);
        }
        c.append(grid);
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
    field(filters, 'status', 'Status', 'text', '', ['', 'pending', 'under_review', 'actioned', 'dismissed']);
    field(filters, 'reason', 'Reason', 'text', '', ['', 'spam', 'harassment', 'nudity', 'violence', 'hate_speech', 'other']);
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
    if (page === 'Appeals' && item.status === 'OPEN')
        for (const decision of ['UPHELD', 'DENIED'])
            a.append(button(decision, () => { const reason = prompt('Resolution. An upheld appeal requires a separate authorized restore action.'); if (reason)
                return mutate('appeals/' + item.id, { decision, version: item.version, reason }, 'Resolve this appeal?'); }));
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
    return; const c = el('div'); c.replaceChildren(); const box = card('Report review'); fields(box, data.report); box.append(el('p', 'Reports on this item: ' + data.counts.count)); if (data.target) {
    fields(box, data.target);
    if (data.target.mediaId)
        await preview(box, '/api/v1/admin/evidence/' + id, data.target.caption || '', 'Reported content');
} const notes = el('textarea'); notes.placeholder = 'Reason and moderator notes'; box.append(notes); const a = actions(box); for (const [label, action, perm] of [['Keep content', 'keep', 'reports.review'], ['Remove content', 'remove', 'content.remove'], ['Restrict account', 'restrict', 'users.restrict'], ['Suspend account', 'suspend', 'users.suspend']]) {
    if (!has(perm) || !has('reports.review'))
        continue;
    if (['restrict', 'suspend'].includes(action) && data.report.target_type !== 'user')
        continue;
    if (action === 'remove' && data.report.target_type === 'user')
        continue;
    a.append(button(label, () => mutate('moderate', { reportId: id, version: data.report.version, action, reason: notes.value }, label + '?')));
} a.append(button('Back', render, true)); c.append(box); if (has('moderation.history.read')) {
    const history = await api('history?limit=20&target=' + encodeURIComponent(data.report.target_id));
    const h = card('Previous moderation history');
    for (const item of history.items)
        fields(h, item);
    if (!history.items.length)
        h.append(el('p', 'No prior actions.'));
    c.append(h);
} if (version === renderVersion)
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
async function campaignForm(c) { c.replaceChildren(); const advertisers = await api('advertisers?limit=50'); if (!advertisers.items.length) {
    c.append(el('p', 'No advertisers yet. Create a public advertiser account first.'), button('New advertiser', () => advertiserForm(c)), button('Back', render, true));
    return;
} const f = el('form', undefined, 'card'); f.append(el('h2', 'Create campaign'), el('p', 'Audience: broad eligible users. No personal targeting. Budget is a planning value; the hard delivery allocation is reserved impressions.', 'muted')); const grid = el('div', undefined, 'form-grid'); field(grid, 'name', 'Campaign name'); const select = field(grid, 'advertiserId', 'Advertiser', 'text', '', advertisers.items.map(a => a.id)); for (const option of select.options)
    option.textContent = advertisers.items.find(a => a.id === option.value).name; let advertiserOffset = 50; if (advertisers.items.length === 50) {
    const more = button('Load more advertisers', async () => { const next = await api('advertisers?limit=50&offset=' + advertiserOffset); advertiserOffset += 50; for (const a of next.items) {
        const option = el('option', a.name);
        option.value = a.id;
        select.append(option);
    } if (next.items.length < 50)
        more.remove(); }, true);
    grid.append(more);
} const file = field(grid, 'file', 'Photo / video', 'file'); file.accept = 'image/jpeg,image/png,video/mp4,video/quicktime'; field(grid, 'caption', 'Caption', 'textarea'); field(grid, 'cta', 'Call to action', 'text', 'Learn More', ['Learn More', 'Visit Website', 'Shop Now', 'Install']); field(grid, 'destination', 'Public HTTPS destination', 'url'); field(grid, 'startAt', 'Start', 'datetime-local'); field(grid, 'endAt', 'End', 'datetime-local'); field(grid, 'budgetMinor', 'Planning budget (minor currency units)', 'number', '0'); field(grid, 'currency', 'Currency', 'text', 'INR'); field(grid, 'impressionLimit', 'Hard reservation allocation', 'number', '1000'); field(grid, 'userCap', 'Per-user campaign cap', 'number', '3'); field(grid, 'dailyCap', 'Per-user daily campaign cap', 'number', '1'); f.append(grid); const previewBox = el('div'); file.onchange = () => { previewBox.replaceChildren(); const selected = file.files[0]; if (!selected)
    return; const url = URL.createObjectURL(selected); objectUrls.push(url); const box = el('div', undefined, 'preview'); box.append(el('strong', 'Creative preview'), el('span', 'Sponsored', 'tag')); const m = el(selected.type.startsWith('video/') ? 'video' : 'img'); m.src = url; if (m.tagName === 'VIDEO')
    m.controls = true; box.append(m); previewBox.append(box); }; f.append(previewBox, button('Upload and save draft', async () => { if (!f.reportValidity())
    return; const v = values(f); const selected = file.files[0]; if (!selected)
    throw Error('Select a photo or video.'); if (!confirm('Upload this creative and save a draft for independent review?'))
    return; const uploaded = await api('media/' + (selected.type.startsWith('video/') ? 'video' : 'photo'), 'POST', selected); delete v.file; for (const k of ['budgetMinor', 'impressionLimit', 'userCap', 'dailyCap'])
    v[k] = Number(v[k]); v.startAt = new Date(v.startAt).toISOString(); v.endAt = new Date(v.endAt).toISOString(); await api('campaigns', 'POST', { ...v, mediaId: uploaded.media.id, confirmed: true }); await render(); }), button('Cancel', render, true)); c.append(f); }
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
