#!/usr/bin/env node
'use strict';
/**
 * Katkee's icons, launch images and store graphics, all made from one master: the approved app
 * icon, brand/katkee-app-icon-1024.png (1024 x 1024, opaque). After the master changes, run:
 *
 *   node scripts/brand-assets.cjs
 *
 * - The mark (the K and its amber dot) is traced into vector paths, so Android's adaptive and
 *   notification icons, the website logo and the in-app logo stay sharp at every size. The
 *   tracing is checked against the master's own pixels and refused if it drifts.
 * - Bitmaps (the iOS icon, legacy Android icons, the iOS launch logo, favicons, store graphics)
 *   are cut from the master's pixels.
 *
 * Needs sharp, which backend/ already installs (npm ci in backend/ first).
 * verification/brand-assets.cjs checks the results without it.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sharp = require(require.resolve('sharp', { paths: [path.join(root, 'backend')] }));

const MASTER = path.join(root, 'brand/katkee-app-icon-1024.png');
const SIZE = 1024;
/** The master's three colours (BRAND.md): the icon background, the K and the dot. */
const BACKGROUND = [8, 12, 20];
const LIGHT = [228, 232, 240];
const AMBER = [252, 176, 32];
const hex = (rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
/** The app's own background (mobile/src/theme/colors.ts), behind the launch logo and splash. */
const APP_BACKGROUND = '#0B0B0B';
/** iOS-style corner radius for a rounded icon, as a share of its side. */
const CORNER = 0.2237;

const out = (relative) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
};
const written = [];
function write(relative, data) {
  fs.writeFileSync(out(relative), data);
  written.push(relative);
}

// ---------------------------------------------------------------------------------------------
// 1. Separate the mark from the background. Every pixel is a blend of the background with the
//    K's colour or with the dot's colour (the edges are anti-aliased); recover which, and how
//    much, so edges stay smooth on any background.

function unblend(rgb) {
  const light = new Float32Array(SIZE * SIZE);
  const amber = new Float32Array(SIZE * SIZE);
  const dl = LIGHT.map((c, i) => c - BACKGROUND[i]);
  const da = AMBER.map((c, i) => c - BACKGROUND[i]);
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const nl = dot(dl, dl), na = dot(da, da);
  const clamp = (t) => Math.min(1, Math.max(0, t));
  for (let p = 0; p < SIZE * SIZE; p++) {
    const v = [rgb[p * 3] - BACKGROUND[0], rgb[p * 3 + 1] - BACKGROUND[1], rgb[p * 3 + 2] - BACKGROUND[2]];
    const tl = clamp(dot(v, dl) / nl), ta = clamp(dot(v, da) / na);
    const el = (v[0] - tl * dl[0]) ** 2 + (v[1] - tl * dl[1]) ** 2 + (v[2] - tl * dl[2]) ** 2;
    const ea = (v[0] - ta * da[0]) ** 2 + (v[1] - ta * da[1]) ** 2 + (v[2] - ta * da[2]) ** 2;
    if (el <= ea) light[p] = tl;
    else amber[p] = ta;
  }
  return { light, amber };
}

/** The mark alone, as straight-alpha RGBA in the master's own pixels; `colour` replaces both inks. */
function markPixels({ light, amber }, colour) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let p = 0; p < SIZE * SIZE; p++) {
    const isAmber = amber[p] > light[p];
    const ink = colour ?? (isAmber ? AMBER : LIGHT);
    rgba[p * 4] = ink[0];
    rgba[p * 4 + 1] = ink[1];
    rgba[p * 4 + 2] = ink[2];
    rgba[p * 4 + 3] = Math.round(Math.max(light[p], amber[p]) * 255);
  }
  return rgba;
}

// ---------------------------------------------------------------------------------------------
// 2. Trace each ink into closed outlines (marching squares on its coverage, at 50%, with
//    sub-pixel interpolation), then drop points that change nothing visible.

function trace(field, threshold = 0.5) {
  const W = SIZE, H = SIZE;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : field[y * W + x]);
  // A crossing lives on a grid edge between two pixel centres; key it by that edge.
  const stride = W + 2;
  const key = (x, y, vertical) => (((y + 1) * stride + (x + 1)) << 1) | (vertical ? 1 : 0);
  const points = new Map();
  const crossing = (x, y, vertical) => {
    const k = key(x, y, vertical);
    if (!points.has(k)) {
      const a = at(x, y), b = vertical ? at(x, y + 1) : at(x + 1, y);
      const t = (threshold - a) / (b - a);
      // Pixel (x, y) covers [x, x + 1]: its centre is at x + 0.5.
      points.set(k, vertical ? [x + 0.5, y + t + 0.5] : [x + t + 0.5, y + 0.5]);
    }
    return k;
  };
  const neighbours = new Map();
  const link = (p, q) => {
    for (const [from, to] of [[p, q], [q, p]]) {
      if (!neighbours.has(from)) neighbours.set(from, []);
      neighbours.get(from).push(to);
    }
  };
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
      const index = (a > threshold ? 8 : 0) | (b > threshold ? 4 : 0) | (c > threshold ? 2 : 0) | (d > threshold ? 1 : 0);
      if (index === 0 || index === 15) continue;
      const top = () => crossing(x, y, false), bottom = () => crossing(x, y + 1, false);
      const left = () => crossing(x, y, true), right = () => crossing(x + 1, y, true);
      const centre = (a + b + c + d) / 4 > threshold;
      switch (index) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(top(), left()); break;
        case 5: if (centre) { link(top(), left()); link(bottom(), right()); } else { link(left(), bottom()); link(top(), right()); } break;
        case 10: if (centre) { link(top(), right()); link(left(), bottom()); } else { link(top(), left()); link(bottom(), right()); } break;
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of neighbours.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let previous = null, current = start;
    while (!seen.has(current)) {
      seen.add(current);
      loop.push(points.get(current));
      const next = neighbours.get(current).find((n) => n !== previous && !seen.has(n));
      if (next === undefined) break;
      previous = current;
      current = next;
    }
    if (loop.length > 8) loops.push(loop);
  }
  return loops;
}

function simplify(loop, tolerance) {
  const distance = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    return length === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length;
  };
  const rdp = (points) => {
    let worst = 0, index = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const d = distance(points[i], points[0], points[points.length - 1]);
      if (d > worst) { worst = d; index = i; }
    }
    if (worst <= tolerance) return [points[0], points[points.length - 1]];
    return [...rdp(points.slice(0, index + 1)).slice(0, -1), ...rdp(points.slice(index))];
  };
  // Split the closed loop at its two most distant points, simplify both halves.
  let far = 0, farthest = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > farthest) { farthest = d; far = i; }
  }
  const first = rdp(loop.slice(0, far + 1));
  const second = rdp([...loop.slice(far), loop[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** Least-squares circle; the dot is drawn as an exact circle when it is one. */
function fitCircle(loop) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of loop) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  const n = loop.length;
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [D E F] = -[sxz syz sz].
  const m = [[sxx, sxy, sx, -sxz], [sxy, syy, sy, -syz], [sx, sy, n, -sz]];
  for (let i = 0; i < 3; i++) {
    const pivot = m[i][i];
    for (let j = i; j < 4; j++) m[i][j] /= pivot;
    for (let k = 0; k < 3; k++) if (k !== i) { const f = m[k][i]; for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j]; }
  }
  const [D, E, F] = [m[0][3], m[1][3], m[2][3]];
  const cx = -D / 2, cy = -E / 2, r = Math.sqrt(cx * cx + cy * cy - F);
  const worst = Math.max(...loop.map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r)));
  return { cx, cy, r, worst };
}

const num = (v) => {
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
};
const polygonPath = (loops) => loops.map((loop) => 'M' + loop.map(([x, y]) => num(x) + ',' + num(y)).join('L') + 'Z').join('');
const circlePath = ({ cx, cy, r }) =>
  `M${num(cx - r)},${num(cy)}A${num(r)},${num(r)} 0 1,0 ${num(cx + r)},${num(cy)}A${num(r)},${num(r)} 0 1,0 ${num(cx - r)},${num(cy)}Z`;

function bounds(loops) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of loops) for (const [x, y] of loop) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------------------------
// 3. Small file-format helpers.

/** An .ico holding PNG images (every browser since IE Vista-era reads these). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const png = (image) => image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
const roundedMask = (size, radius) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"/></svg>`);
const circleMask = (size) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);

/** The master at `size`, with rounded corners (transparent outside). */
async function roundedIcon(size) {
  const icon = await sharp(MASTER).removeAlpha().resize(size, size, { kernel: 'lanczos3' }).ensureAlpha().toBuffer();
  return sharp(icon).composite([{ input: roundedMask(size, size * CORNER), blend: 'dest-in' }]);
}

/** A legacy (Android 7) launcher icon: the master in a rounded square or a circle, with a 1/48 margin. */
async function legacyLauncher(size, shape) {
  const inset = Math.max(1, Math.round(size / 48));
  const inner = size - inset * 2;
  const icon = await sharp(MASTER).removeAlpha().resize(inner, inner, { kernel: 'lanczos3' }).ensureAlpha().toBuffer();
  const mask = shape === 'round' ? circleMask(inner) : roundedMask(inner, inner * 0.16);
  const masked = await sharp(icon).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return png(sharp(masked).extend({ top: inset, bottom: inset, left: inset, right: inset, background: { r: 0, g: 0, b: 0, alpha: 0 } }));
}

/** The mark's own pixels, cropped to it and scaled to `height`, centred on a transparent canvas. */
async function markBitmap(rgba, box, canvasWidth, canvasHeight, height) {
  // One pixel beyond the traced outline keeps the faint outer edge of the anti-aliasing.
  const left0 = Math.floor(box.minX) - 1, top0 = Math.floor(box.minY) - 1;
  const crop = { left: left0, top: top0, width: Math.ceil(box.maxX) + 1 - left0, height: Math.ceil(box.maxY) + 1 - top0 };
  const width = Math.round((crop.width / crop.height) * height);
  const scaled = await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .extract(crop).resize(width, height, { kernel: 'lanczos3', fit: 'fill' }).png().toBuffer();
  const left = Math.floor((canvasWidth - width) / 2), top = Math.floor((canvasHeight - height) / 2);
  return png(sharp(scaled).extend({ left, top, right: canvasWidth - width - left, bottom: canvasHeight - height - top, background: { r: 0, g: 0, b: 0, alpha: 0 } }));
}

/** A dark promotional canvas with the rounded icon in the middle and a faint amber glow. */
async function promo(width, height, iconSize, flatten) {
  const glow = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${hex(AMBER)}" stop-opacity="0.16"/><stop offset="1" stop-color="${hex(AMBER)}" stop-opacity="0"/></radialGradient></defs>
<rect width="${width}" height="${height}" fill="${APP_BACKGROUND}"/>
<circle cx="${width / 2}" cy="${height / 2}" r="${iconSize * 1.25}" fill="url(#g)"/></svg>`);
  const icon = await png(await roundedIcon(iconSize));
  const image = sharp(glow).composite([{ input: icon, left: Math.round((width - iconSize) / 2), top: Math.round((height - iconSize) / 2) }]);
  return png(flatten ? sharp(await image.png().toBuffer()).flatten({ background: APP_BACKGROUND }).removeAlpha() : image);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const { data: rgb, info } = await sharp(MASTER).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SIZE || info.height !== SIZE) throw new Error(`The master icon must be ${SIZE} x ${SIZE}; it is ${info.width} x ${info.height}.`);

  const inks = unblend(rgb);
  const lightLoops = trace(inks.light).map((loop) => simplify(loop, 0.3));
  const amberLoops = trace(inks.amber);
  if (lightLoops.length < 2 || amberLoops.length !== 1) throw new Error(`Unexpected mark shape: ${lightLoops.length} outlines for the K, ${amberLoops.length} for the dot.`);
  const circle = fitCircle(amberLoops[0]);
  if (circle.worst > 0.75) throw new Error(`The dot is not a circle (off by up to ${circle.worst.toFixed(2)} px).`);
  const lightPath = polygonPath(lightLoops);
  const dotPath = circlePath(circle);
  const box = bounds([...lightLoops, ...amberLoops]);

  const svgMark = (fillLight, fillDot, extra = '') =>
    `<path fill="${fillLight}" fill-rule="evenodd" d="${lightPath}"/><path fill="${fillDot}" d="${dotPath}"/>${extra}`;

  // The tracing must reproduce the master: rasterise it and compare pixel by pixel.
  const traced = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="${hex(BACKGROUND)}"/>${svgMark(hex(LIGHT), hex(AMBER))}</svg>`)).removeAlpha().raw().toBuffer();
  let total = 0, off = 0;
  for (let i = 0; i < rgb.length; i++) {
    const d = Math.abs(rgb[i] - traced[i]);
    total += d;
    if (d > 64) off++;
  }
  const meanDifference = total / rgb.length;
  const offPixels = off / rgb.length;
  if (meanDifference > 1 || offPixels > 0.0005) throw new Error(`The traced mark differs from the master (mean ${meanDifference.toFixed(3)} levels, ${(offPixels * 100).toFixed(3)}% of values off by > 64).`);

  const markRgba = markPixels(inks);

  // --- brand/ : the mark and the icon as vectors, and the store graphics -------------------
  const margin = 8;
  const vb = [box.minX - margin, box.minY - margin, box.width + margin * 2, box.height + margin * 2].map(num).join(' ');
  write('brand/katkee-mark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><title>Katkee</title>${svgMark(hex(LIGHT), hex(AMBER))}</svg>\n`);
  const roundedIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}"><title>Katkee</title><rect width="${SIZE}" height="${SIZE}" rx="${num(SIZE * CORNER)}" fill="${hex(BACKGROUND)}"/>${svgMark(hex(LIGHT), hex(AMBER))}</svg>\n`;
  write('brand/katkee-icon.svg', roundedIconSvg);
  // Google Play asks for a 32-bit PNG (with alpha), full square: it rounds the corners itself.
  write('brand/store/google-play-icon-512.png', await png(sharp(MASTER).removeAlpha().resize(512, 512, { kernel: 'lanczos3' }).ensureAlpha(1)));
  write('brand/store/google-play-feature-graphic-1024x500.png', await promo(1024, 500, 236, true));

  // --- iOS ---------------------------------------------------------------------------------
  const assets = 'mobile/ios/KatkeeMobile/Images.xcassets';
  // App Store Connect refuses an icon with an alpha channel: opaque RGB only.
  write(`${assets}/AppIcon.appiconset/AppIcon-1024.png`, await png(sharp(MASTER).removeAlpha().toColourspace('srgb')));
  // The launch screen's logo: the mark 112 points tall on an 84 x 112 point canvas.
  const launch = { width: 84, height: 112 };
  for (const scale of [1, 2, 3]) {
    const suffix = scale === 1 ? '' : `@${scale}x`;
    write(`${assets}/LaunchLogo.imageset/LaunchLogo${suffix}.png`, await markBitmap(markRgba, box, launch.width * scale, launch.height * scale, launch.height * scale));
  }
  write(`${assets}/LaunchLogo.imageset/Contents.json`, JSON.stringify({
    images: [1, 2, 3].map((scale) => ({ filename: `LaunchLogo${scale === 1 ? '' : `@${scale}x`}.png`, idiom: 'universal', scale: `${scale}x` })),
    info: { author: 'xcode', version: 1 },
  }, null, 2) + '\n');

  // --- Android -----------------------------------------------------------------------------
  const res = 'mobile/android/app/src/main/res';
  const generated = '<!-- Generated by scripts/brand-assets.cjs from brand/katkee-app-icon-1024.png; do not edit. -->';
  // Adaptive icon (Android 8+): the master's 1024 square maps to the 72 dp visible area of the
  // 108 dp canvas, so the mark sits exactly as it does on the iPhone icon, inside the safe zone.
  const vector = (dp, viewport, translate, body) =>
    `<?xml version="1.0" encoding="utf-8"?>\n${generated}\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="${dp}dp"\n    android:height="${dp}dp"\n    android:viewportWidth="${num(viewport)}"\n    android:viewportHeight="${num(viewport)}">\n    <group android:translateX="${num(translate[0])}" android:translateY="${num(translate[1])}">\n${body}    </group>\n</vector>\n`;
  const vectorPaths = (light, dot) =>
    `        <path android:fillColor="${light}" android:fillType="evenOdd" android:pathData="${lightPath}" />\n        <path android:fillColor="${dot}" android:pathData="${dotPath}" />\n`;
  const adaptiveViewport = SIZE * 108 / 72;
  const adaptiveOffset = (adaptiveViewport - SIZE) / 2;
  write(`${res}/drawable/ic_launcher_foreground.xml`, vector(108, adaptiveViewport, [adaptiveOffset, adaptiveOffset], vectorPaths('#FF' + hex(LIGHT).slice(1), '#FF' + hex(AMBER).slice(1))));
  write(`${res}/drawable/ic_launcher_monochrome.xml`, vector(108, adaptiveViewport, [adaptiveOffset, adaptiveOffset], vectorPaths('#FFFFFFFF', '#FFFFFFFF')));
  // Status-bar icon: shape only (Android tints it), the mark 20 dp tall in 24 dp.
  const notificationViewport = box.height * 24 / 20;
  write(`${res}/drawable/ic_notification.xml`, vector(24, notificationViewport, [
    (notificationViewport - box.width) / 2 - box.minX, (notificationViewport - box.height) / 2 - box.minY,
  ], vectorPaths('#FFFFFFFF', '#FFFFFFFF')));
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n${generated}\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background" />\n    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n</adaptive-icon>\n`;
  write(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
  write(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);
  write(`${res}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>\n${generated}\n<resources>\n    <color name="ic_launcher_background">${hex(BACKGROUND)}</color>\n</resources>\n`);
  // Android 7 has no adaptive icons: bitmaps per density.
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    write(`${res}/mipmap-${density}/ic_launcher.png`, await legacyLauncher(size, 'square'));
    write(`${res}/mipmap-${density}/ic_launcher_round.png`, await legacyLauncher(size, 'round'));
  }

  // --- The app's own logo (react-native-svg) ----------------------------------------------
  write('mobile/src/components/brandMarkPaths.ts', [
    '/** Generated by scripts/brand-assets.cjs from brand/katkee-app-icon-1024.png; do not edit. */',
    `export const BRAND_MARK = {`,
    `  viewBox: ${JSON.stringify(vb)},`,
    `  width: ${num(box.width + margin * 2)},`,
    `  height: ${num(box.height + margin * 2)},`,
    `  /** The K (even-odd: the inner outline is a hole). */`,
    `  k: ${JSON.stringify(lightPath)},`,
    `  dot: ${JSON.stringify(dotPath)},`,
    `  kColor: ${JSON.stringify(hex(LIGHT))},`,
    `  dotColor: ${JSON.stringify(hex(AMBER))},`,
    `} as const;`,
    '',
  ].join('\n'));

  // --- Website -----------------------------------------------------------------------------
  write('website/src/images/katkee-icon.svg', roundedIconSvg);
  write('website/src/images/apple-touch-icon.png', await png(sharp(MASTER).removeAlpha().resize(180, 180, { kernel: 'lanczos3' })));
  const favicons = [];
  for (const size of [16, 32, 48]) favicons.push({ size, data: await png(await roundedIcon(size)) });
  write('website/src/images/favicon.ico', ico(favicons));
  write('website/src/images/social-card.png', await promo(1200, 630, 300, true));

  console.log(`Traced mark: ${lightLoops.length} outlines (${lightLoops.reduce((n, l) => n + l.length, 0)} points) and a dot of radius ${circle.r.toFixed(1)} px; ` +
    `against the master: mean difference ${meanDifference.toFixed(3)} levels, ${(offPixels * 100).toFixed(4)}% of values off by more than 64.`);
  console.log(`Wrote ${written.length} files:\n` + written.map((f) => '  ' + f).join('\n'));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
