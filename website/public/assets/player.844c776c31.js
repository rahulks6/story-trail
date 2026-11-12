/* The web Story player on katkee.com/u/<username> and /s/<story id>: the site's only script.
   It plays the public Stories the page carries as JSON (#web-data, filled in by the API), and
   builds every element itself with textContent and CSSOM, so nothing in a Story is ever parsed
   as HTML and the Content-Security-Policy needs no inline scripts or styles. It sends nothing
   anywhere: no views, no analytics, no cookies. Full screen on phones, a centred 9:16 frame on
   larger screens. Tap or arrow keys to move, hold or Space to pause, Esc to close. */
(function () {
  'use strict';
  var dataEl = document.getElementById('web-data');
  var root = document.getElementById('web-profile');
  if (!dataEl || !root) return;
  var data;
  try { data = JSON.parse(dataEl.textContent || '{}'); } catch (e) { return; }
  if (!data || !data.owner) return;

  var PHOTO_MS = 5000;
  var HOLD_MS = 220;
  /** Story text and stickers are sized against a phone-sized frame, like the app. */
  var REFERENCE_HEIGHT = 740;
  var STICKER_GLYPHS = { spark: '✦', 'heart-line': '♡', 'star-outline': '☆', wave: '〰', flame: '🔥', confetti: '✺', ring: '◯', bolt: '⚡' };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  var SVG = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }
  function badge() {
    var svg = svgEl('svg', { viewBox: '0 0 24 24', width: '16', height: '16', 'class': 'verified-badge', role: 'img', 'aria-label': 'Verified' });
    svg.appendChild(svgEl('path', { fill: 'currentColor', d: 'M12 1.5l2.6 1.9 3.2-.1 1 3.1 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3.1-3.2-.1L12 22.5l-2.6-1.9-3.2.1-1-3.1-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3.1 3.2.1z' }));
    svg.appendChild(svgEl('path', { fill: 'none', stroke: '#0B0B0B', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', d: 'M7.5 12.3l3 3 6-6.3' }));
    return svg;
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function remaining(iso) {
    var ms = new Date(iso).getTime() - Date.now();
    if (!(ms > 0)) return 'Ended';
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + (m % 60) + 'm' : Math.max(1, m) + 'm';
  }
  function hostOf(url) {
    try { return new URL(url).host.replace(/^www\./, ''); } catch (e) { return url; }
  }

  // --- The player's elements, made once ---------------------------------------------------------

  var player = el('div', 'player');
  player.hidden = true;
  player.setAttribute('role', 'dialog');
  player.setAttribute('aria-modal', 'true');
  player.setAttribute('aria-label', 'Stories by ' + data.owner.name);
  var backdrop = el('div', 'player-backdrop');
  var stage = el('div', 'player-stage');
  var media = el('div', 'player-media');
  var drawing = svgEl('svg', { 'class': 'player-drawing', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  var overlays = el('div', 'player-overlays');
  var progress = el('div', 'player-progress');
  var top = el('div', 'player-top');
  var owner = el('a', 'player-owner');
  owner.href = '/u/' + data.owner.username;
  var ownerPhoto = data.owner.photo ? el('img', 'player-owner-photo') : el('span', 'player-owner-photo is-initial', (data.owner.name || data.owner.username).charAt(0).toUpperCase());
  if (data.owner.photo) { ownerPhoto.src = data.owner.photo; ownerPhoto.alt = ''; ownerPhoto.width = 32; ownerPhoto.height = 32; }
  var ownerName = el('span', 'player-owner-name', data.owner.name);
  if (data.owner.verified) ownerName.appendChild(badge());
  var when = el('span', 'player-when');
  owner.appendChild(ownerPhoto);
  owner.appendChild(ownerName);
  owner.appendChild(when);
  var muteButton = el('button', 'player-icon player-mute');
  muteButton.type = 'button';
  var closeButton = el('button', 'player-icon player-close');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.appendChild(icon('M6 6l12 12M18 6L6 18'));
  top.appendChild(owner);
  top.appendChild(muteButton);
  top.appendChild(closeButton);
  var tapPrev = el('button', 'player-tap player-tap-prev');
  tapPrev.type = 'button';
  tapPrev.setAttribute('aria-label', 'Previous');
  var tapNext = el('button', 'player-tap player-tap-next');
  tapNext.type = 'button';
  tapNext.setAttribute('aria-label', 'Next');
  var bottom = el('div', 'player-bottom');
  var caption = el('p', 'player-caption');
  var music = el('p', 'player-music');
  var cta = el('div', 'player-cta');
  var openApp = el('a', 'button', 'Open in the app');
  var getApp = el('a', 'button button-quiet', 'Get Katkee');
  getApp.href = '#get-katkee';
  cta.appendChild(openApp);
  cta.appendChild(getApp);
  bottom.appendChild(caption);
  bottom.appendChild(music);
  bottom.appendChild(cta);
  var status = el('p', 'player-status');
  status.setAttribute('role', 'status');
  var navPrev = el('button', 'player-nav player-nav-prev');
  navPrev.type = 'button';
  navPrev.setAttribute('aria-label', 'Previous Story');
  navPrev.appendChild(icon('M15 5l-7 7 7 7'));
  var navNext = el('button', 'player-nav player-nav-next');
  navNext.type = 'button';
  navNext.setAttribute('aria-label', 'Next Story');
  navNext.appendChild(icon('M9 5l7 7-7 7'));
  [media, drawing, overlays, tapPrev, tapNext, progress, top, bottom, status].forEach(function (n) { stage.appendChild(n); });
  player.appendChild(backdrop);
  player.appendChild(navPrev);
  player.appendChild(stage);
  player.appendChild(navNext);
  document.body.appendChild(player);

  function icon(d) {
    var svg = svgEl('svg', { viewBox: '0 0 24 24', width: '22', height: '22', 'aria-hidden': 'true' });
    svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return svg;
  }

  // --- State ----------------------------------------------------------------------------------

  var items = [];
  var index = 0;
  var opener = null;
  var ringSeen = null;
  var current = null;
  var started = 0;
  var elapsed = 0;
  var duration = PHOTO_MS;
  var paused = false;
  var held = false;
  var loading = false;
  var frame = 0;
  var soundOn = false;
  var bars = [];

  function setPaused(next) {
    if (paused === next) return;
    paused = next;
    player.classList.toggle('is-paused', paused);
    if (paused) elapsed += started ? performance.now() - started : 0;
    started = paused ? 0 : performance.now();
    var video = current && current.video;
    if (video) { if (paused) video.pause(); else video.play().catch(function () {}); }
  }

  function open(list, at, from, onSeen) {
    if (!list.length) return;
    items = list;
    opener = from || null;
    ringSeen = onSeen || null;
    progress.textContent = '';
    bars = items.map(function () {
      var bar = el('span', 'player-bar');
      bar.appendChild(el('i'));
      progress.appendChild(bar);
      return bar.firstChild;
    });
    player.hidden = false;
    document.documentElement.classList.add('player-open');
    show(Math.max(0, Math.min(at, items.length - 1)));
    closeButton.focus({ preventScroll: true });
  }

  function close() {
    if (player.hidden) return;
    stop();
    media.textContent = '';
    player.hidden = true;
    document.documentElement.classList.remove('player-open');
    if (ringSeen) ringSeen();
    if (opener && opener.focus) opener.focus({ preventScroll: true });
  }

  function stop() {
    cancelAnimationFrame(frame);
    if (current && current.video) { current.video.pause(); current.video.removeAttribute('src'); current.video.load(); }
    current = null;
  }

  function show(i) {
    stop();
    index = i;
    var story = items[i];
    bars.forEach(function (b, n) { b.style.transform = 'scaleX(' + (n < i ? 1 : 0) + ')'; });
    media.textContent = '';
    status.textContent = '';
    paused = false;
    player.classList.remove('is-paused', 'is-failed');
    loading = true;
    player.classList.add('is-loading');
    elapsed = 0;
    started = 0;
    when.textContent = ago(story.createdAt);
    caption.textContent = story.caption || '';
    caption.hidden = !story.caption;
    music.textContent = story.music ? '♪ ' + story.music.title + ' · ' + story.music.artist : '';
    music.hidden = !story.music;
    openApp.href = 'katkee://story/' + story.id;
    navPrev.disabled = i === 0;
    navNext.disabled = i === items.length - 1;

    var image = el('img');
    image.alt = story.caption ? 'Story: ' + story.caption : 'A Story by ' + data.owner.name;
    image.decoding = 'async';
    current = { story: story, image: image, video: null };
    var entry = current;
    if (story.kind === 'video' && story.video) {
      var video = el('video');
      video.muted = !soundOn || story.muted;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.preload = 'auto';
      video.poster = story.image;
      video.src = story.video;
      entry.video = video;
      media.appendChild(video);
      video.addEventListener('loadedmetadata', function () {
        if (entry !== current) return;
        duration = isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : (story.durationMs || PHOTO_MS);
      });
      video.addEventListener('playing', function () { if (entry === current) ready(); });
      video.addEventListener('ended', function () { if (entry === current) next(); });
      video.addEventListener('error', function () { if (entry === current) failed(); });
      video.play().catch(function () {
        // Autoplay with sound can be refused: try once more without it.
        if (entry !== current) return;
        video.muted = true;
        video.play().catch(function () { if (entry === current) ready(); });
      });
      muteButton.hidden = story.muted;
    } else {
      duration = PHOTO_MS;
      image.addEventListener('load', function () { if (entry === current) ready(); });
      image.addEventListener('error', function () { if (entry === current) failed(); });
      image.src = story.image;
      media.appendChild(image);
      muteButton.hidden = true;
    }
    updateMute();
    applyCrop(story);
    layout();
    // The next one starts loading now, so moving on is instant.
    var upcoming = items[i + 1];
    if (upcoming) { var pre = new Image(); pre.src = upcoming.image; }
    frame = requestAnimationFrame(tick);
  }

  function ready() {
    if (!loading) return;
    loading = false;
    player.classList.remove('is-loading');
    if (!paused) started = performance.now();
  }

  function failed() {
    loading = false;
    player.classList.remove('is-loading');
    player.classList.add('is-failed');
    status.textContent = 'This Story isn’t available any more.';
    duration = 2500;
    elapsed = 0;
    started = performance.now();
  }

  function tick() {
    if (!current) return;
    if (!loading) {
      var video = current.video;
      var done = video && !player.classList.contains('is-failed') && isFinite(video.duration) && video.duration > 0
        ? video.currentTime / video.duration
        : (elapsed + (started ? performance.now() - started : 0)) / duration;
      bars[index].style.transform = 'scaleX(' + Math.min(1, done) + ')';
      if (done >= 1 && !(video && !player.classList.contains('is-failed'))) { next(); return; }
    }
    frame = requestAnimationFrame(tick);
  }

  function next() {
    if (index < items.length - 1) show(index + 1);
    else close();
  }
  function previous() {
    if (index > 0) show(index - 1);
    else show(0);
  }

  function updateMute() {
    var on = soundOn && !(current && current.story.muted);
    muteButton.textContent = '';
    muteButton.setAttribute('aria-label', on ? 'Mute' : 'Turn sound on');
    muteButton.setAttribute('aria-pressed', String(on));
    muteButton.appendChild(icon(on ? 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4 4 0 0 0-2-3.5v7a4 4 0 0 0 2-3.5z' : 'M4 9v6h4l5 4V5L8 9H4zm12 0l5 6m0-6l-5 6'));
  }

  // --- Drawing a Story's layout -------------------------------------------------------------------

  function applyCrop(story) {
    var c = story.crop || { zoom: 1, offsetX: 0, offsetY: 0 };
    var target = current && (current.video || current.image);
    if (!target) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    var tx = c.offsetX * (w * (c.zoom - 1)) / 2, ty = c.offsetY * (h * (c.zoom - 1)) / 2;
    target.style.transform = c.zoom > 1 ? 'translate(' + tx + 'px, ' + ty + 'px) scale(' + c.zoom + ')' : '';
  }

  function place(node, o) {
    node.style.left = (o.x * 100) + '%';
    node.style.top = (o.y * 100) + '%';
    node.style.zIndex = String(o.z || 0);
    node.style.transform = 'translate(-50%, -50%) scale(' + o.scale + ') rotate(' + o.rotation + 'deg)';
    return node;
  }

  function sticker(o, w) {
    var card = el('div', 'ov ov-card ov-' + o.type.toLowerCase());
    card.style.width = Math.round(w * 0.62) + 'px';
    var note;
    if (o.type === 'poll' || o.type === 'quiz') {
      card.appendChild(el('p', 'ov-card-title', o.question));
      var list = el('ul', 'ov-options');
      o.options.forEach(function (option) { list.appendChild(el('li', null, option)); });
      card.appendChild(list);
      note = o.type === 'poll' ? 'Open in the app to vote' : 'Open in the app to answer';
    } else if (o.type === 'question') {
      card.appendChild(el('p', 'ov-card-title', o.prompt));
      card.appendChild(el('p', 'ov-card-field', 'Type something…'));
      note = 'Open in the app to reply';
    } else if (o.type === 'countdown') {
      card.appendChild(el('p', 'ov-card-title', o.title));
      card.appendChild(el('p', 'ov-card-big', remaining(o.endsAt)));
      note = 'Open in the app for a reminder';
    } else {
      card.appendChild(el('p', 'ov-card-kicker', 'Add yours'));
      card.appendChild(el('p', 'ov-card-title', o.prompt));
      note = 'Open in the app to join';
    }
    card.appendChild(el('p', 'ov-card-note', note));
    return card;
  }

  /** The see-through label: the colour at 55% (the app's SOFT_ALPHA). */
  function softColor(hex) {
    var n = parseInt(String(hex).slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',0.55)';
  }

  /** Text that comes in: typed out, popped in, faded up or bouncing (site.css .ov-anim-*). */
  function animateText(node, textNode, o) {
    if (!o.animation || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    if (o.animation === 'typewriter') {
      var chars = Array.from(o.text), shown = 0;
      var step = Math.max(16, Math.min(55, 1800 / Math.max(1, chars.length)));
      textNode.textContent = '';
      var timer = setInterval(function () {
        shown += 1;
        textNode.textContent = chars.slice(0, shown).join('');
        if (shown >= chars.length) clearInterval(timer);
      }, step);
      return;
    }
    node.classList.add('ov-anim-' + o.animation);
  }

  function overlay(o, w, h, unit) {
    var node;
    switch (o.type) {
      case 'text': {
        var size = o.fontSize * h;
        var marker = o.effect === 'marker' && o.background;
        var border = !o.background && (o.effect === 'outline' || o.style === 'Outline');
        node = el('div', 'ov ov-text ov-style-' + String(o.style).toLowerCase(), marker ? '' : o.text);
        node.style.fontSize = size + 'px';
        node.style.textAlign = o.align;
        node.style.maxWidth = (w * 0.8) + 'px';
        var neon = o.style === 'Highlight' && !o.background && !border;
        if (marker) {
          // A highlighter behind each line: the background on an inline span, repeated per line.
          var span = el('span', 'ov-marker', o.text);
          span.style.backgroundColor = o.background;
          span.style.padding = (size * 0.04) + 'px ' + (size * 0.28) + 'px';
          span.style.borderRadius = (size * 0.22) + 'px';
          span.style.boxDecorationBreak = 'clone';
          span.style.webkitBoxDecorationBreak = 'clone';
          node.appendChild(span);
        } else if (o.background) {
          node.style.backgroundColor = o.effect === 'soft' ? softColor(o.background) : o.background;
          node.style.padding = (size * 0.12) + 'px ' + (size * 0.35) + 'px';
          node.style.borderRadius = (size * 0.3) + 'px';
        }
        node.style.color = o.color;
        if (neon) node.style.textShadow = '0 0 ' + Math.max(6, size * 0.4) + 'px ' + o.color + ', 0 0 ' + Math.max(3, size * 0.2) + 'px ' + o.color;
        if (border) {
          // The stroke is drawn behind the letters (paint-order), as the app draws it.
          node.style.webkitTextStroke = (Math.max(1.5, size * 0.07) * 2) + 'px ' + contrastOn(o.color);
          node.style.paintOrder = 'stroke fill';
        }
        animateText(node, marker ? span : node, o);
        break;
      }
      case 'emoji':
        node = el('div', 'ov ov-emoji', o.emoji);
        node.style.fontSize = (0.09 * h) + 'px';
        break;
      case 'sticker':
        node = el('div', 'ov ov-sticker', STICKER_GLYPHS[o.sticker] || '✦');
        node.style.fontSize = (0.08 * h) + 'px';
        break;
      case 'mention':
        node = el('a', 'ov ov-chip', '@' + o.username);
        node.href = '/u/' + o.username;
        break;
      case 'location':
        node = el('div', 'ov ov-chip', '📍 ' + o.label);
        break;
      case 'datetime':
        node = el('div', 'ov ov-chip', o.label);
        break;
      case 'link':
        node = el('a', 'ov ov-chip ov-link', '🔗 ' + (o.label || hostOf(o.url)));
        node.href = o.url;
        node.target = '_blank';
        node.rel = 'noopener noreferrer nofollow ugc';
        break;
      default:
        node = sticker(o, w);
    }
    if (node.classList.contains('ov-chip') || node.classList.contains('ov-card')) node.style.fontSize = (14 * unit) + 'px';
    return place(node, o);
  }

  function contrastOn(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#FFFFFF';
    var n = parseInt(m[1], 16);
    var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { var s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.4 ? '#000000' : '#FFFFFF';
  }

  function layout() {
    if (!current) return;
    var story = current.story;
    var w = stage.clientWidth, h = stage.clientHeight;
    var unit = h / REFERENCE_HEIGHT;
    overlays.textContent = '';
    story.overlays.forEach(function (o) { overlays.appendChild(overlay(o, w, h, unit)); });
    while (drawing.firstChild) drawing.removeChild(drawing.firstChild);
    drawing.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    story.drawing.forEach(function (s) {
      var mult = s.tool === 'highlighter' ? 3 : s.tool === 'marker' ? 1.8 : 1;
      var d = s.points.map(function (p, n) { return (n ? 'L' : 'M') + (p[0] * w).toFixed(1) + ' ' + (p[1] * h).toFixed(1); }).join('');
      if (s.points.length === 1) d += 'l0.1 0';
      drawing.appendChild(svgEl('path', {
        d: d, fill: 'none', stroke: s.color, 'stroke-opacity': s.tool === 'highlighter' ? '0.4' : '1',
        'stroke-width': String(Math.max(1, s.width * w * mult)), 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }));
    });
    applyCrop(story);
  }
  if (window.ResizeObserver) new ResizeObserver(function () { layout(); }).observe(stage);
  else window.addEventListener('resize', layout);

  // --- Input ------------------------------------------------------------------------------------

  var holdTimer = 0;
  function pressStart(e) {
    if (e.button !== undefined && e.button !== 0) return;
    held = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () { held = true; setPaused(true); }, HOLD_MS);
  }
  function pressEnd(direction) {
    return function (e) {
      clearTimeout(holdTimer);
      if (held) { held = false; setPaused(false); e.preventDefault(); return; }
      if (direction < 0) previous(); else next();
    };
  }
  [tapPrev, tapNext].forEach(function (zone, n) {
    zone.addEventListener('pointerdown', pressStart);
    zone.addEventListener('pointerup', pressEnd(n === 0 ? -1 : 1));
    zone.addEventListener('pointercancel', function () { clearTimeout(holdTimer); if (held) { held = false; setPaused(false); } });
    zone.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Keyboard activation (Enter on the focused zone): a click with no pointer before it.
    zone.addEventListener('click', function (e) { if (e.detail === 0) { if (n === 0) previous(); else next(); } });
  });
  navPrev.addEventListener('click', previous);
  navNext.addEventListener('click', next);
  closeButton.addEventListener('click', close);
  getApp.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  muteButton.addEventListener('click', function () {
    soundOn = !soundOn;
    if (current && current.video) {
      current.video.muted = !soundOn || current.story.muted;
      if (!paused) current.video.play().catch(function () {});
    }
    updateMute();
  });
  // Links inside a Story (a mention, a link sticker) leave the player paused, not moving on.
  overlays.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) setPaused(true); });
  document.addEventListener('keydown', function (e) {
    if (player.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); previous(); }
    else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); setPaused(!paused); }
    else if (e.key === 'm' && current && current.video) muteButton.click();
    else if (e.key === 'Tab') trapFocus(e);
  });
  function trapFocus(e) {
    var focusable = [].slice.call(player.querySelectorAll('a[href], button:not([disabled])')).filter(function (n) { return !n.hidden && n.offsetParent !== null; });
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !player.hidden) setPaused(true);
  });
  if (reduceMotion) player.classList.add('is-reduced');

  // --- The profile's own buttons ---------------------------------------------------------------

  var ring = root.querySelector('[data-play="stories"]');
  if (ring && data.stories.length) {
    ring.addEventListener('click', function (e) {
      e.preventDefault();
      open(data.stories, 0, ring, function () { ring.classList.add('is-seen'); });
    });
  }
  [].forEach.call(root.querySelectorAll('[data-play^="highlight:"]'), function (button) {
    var id = button.getAttribute('data-play').slice('highlight:'.length);
    var highlight = data.highlights.filter(function (h) { return h.id === id; })[0];
    if (!highlight) return;
    button.addEventListener('click', function () { open(highlight.items, 0, button); });
  });

  // /s/<story id>: that Story plays straight away, then the rest of the ring.
  var start = root.getAttribute('data-start');
  if (start) {
    var at = -1;
    data.stories.forEach(function (s, n) { if (s.id === start) at = n; });
    if (at >= 0) open(data.stories, at, ring, function () { if (ring) ring.classList.add('is-seen'); });
  }
})();
