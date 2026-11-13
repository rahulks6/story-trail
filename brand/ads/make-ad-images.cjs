// Google Ads App campaign images, in the sizes Google asks for: landscape 1200x628, square
// 1200x1200 and portrait 1200x1500. Two designs each (Kee + the app's promise, and the
// Founding member badge), so Google can mix and test them.
//
//   node brand/ads/make-ad-images.cjs [outDir]
//
// Google prefers little text on the picture (the headlines and descriptions carry the words), so
// each image has one short line. No real people.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { kee, C } = require("../mascot/kee.cjs");

const OUT = process.argv[2] || path.join(__dirname, "ad-images");
const FONT = "Inter, sans-serif";
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "..", "katkee-app-icon-1024.png")).toString("base64")}`;
const STAR = "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";
const SIZES = { landscape: [1200, 628], square: [1200, 1200], portrait: [1200, 1500] };

const bg = (w, h) => `<svg width="${w}" height="${h}" style="position:absolute;inset:0">
  <defs><radialGradient id="g" cx="50%" cy="45%" r="80%"><stop offset="0" stop-color="#1B2433"/><stop offset="1" stop-color="#080C14"/></radialGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.72}" cy="${h * 0.62}" r="${Math.min(w, h) * 0.42}" fill="${C.amber}" opacity="0.08"/></svg>`;
const keeSvg = (opts, x, ground, s, w, h) => `<svg width="${w}" height="${h}" style="position:absolute;inset:0">
  <ellipse cx="${x}" cy="${ground + 8}" rx="${115 * s}" ry="${17 * s}" fill="#000" opacity="0.3"/>
  <g transform="translate(${x - 200 * s},${ground - 452 * s}) scale(${s})">${kee(opts)}</g></svg>`;

function design(kind, [w, h]) {
  const wide = w / h > 1.4;
  // Text block on the left for landscape, on top for square and portrait.
  const textBox = wide
    ? `position:absolute;left:70px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center;gap:22px`
    : `position:absolute;left:70px;right:70px;top:${h * 0.09}px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:24px`;
  const keeX = wide ? w * 0.78 : w / 2;
  const ground = wide ? h * 0.9 : h * 0.92;
  const scale = wide ? 1.05 : (h > 1300 ? 1.75 : 1.4);
  const brandRow = `<div style="display:flex;align-items:center;gap:16px;${wide ? "" : "justify-content:center"}">
    <img src="${ICON}" style="width:${wide ? 76 : 96}px;height:${wide ? 76 : 96}px;border-radius:${wide ? 18 : 22}px">
    <span style="font:900 ${wide ? 52 : 64}px ${FONT};color:${C.amber};letter-spacing:-0.02em">Katkee</span></div>`;
  if (kind === "stories") {
    return `${bg(w, h)}
      <div style="${textBox}">${brandRow}
        <div style="font:900 ${wide ? 64 : 84}px/1.05 ${FONT};color:#fff;letter-spacing:-0.02em">Stories with<br>your people</div>
        <div style="font:700 ${wide ? 30 : 38}px/1.3 ${FONT};color:#C9D1DE">Music · filters · chat</div></div>
      ${keeSvg({ eyes: "happy", mouth: "grin", armR: 155, armL: 25, spark: "note", glow: 1 }, keeX, ground, scale, w, h)}`;
  }
  return `${bg(w, h)}
    <div style="${textBox}">${brandRow}
      <div style="font:900 ${wide ? 60 : 80}px/1.05 ${FONT};color:#fff;letter-spacing:-0.02em">Be one of the<br><span style="color:${C.amber}">first 1,000</span></div>
      <div style="display:inline-flex;align-self:${wide ? "flex-start" : "center"};align-items:center;gap:12px;padding:12px 26px;border-radius:999px;border:3px solid ${C.amber};color:${C.amber};font:800 ${wide ? 30 : 40}px ${FONT}">
        <svg width="${wide ? 30 : 40}" height="${wide ? 30 : 40}" viewBox="0 0 24 24"><path d="${STAR}" fill="${C.amber}" stroke="${C.amber}" stroke-width="2" stroke-linejoin="round"/></svg>Founding member</div></div>
    ${keeSvg({ eyes: "star", mouth: "grin", armL: 150, armR: 150, spark: "star", glow: 1 }, keeX, ground, scale, w, h)}`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const kind of ["stories", "founding"]) {
    for (const [name, size] of Object.entries(SIZES)) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await page.setContent(`<!doctype html><body style="margin:0;width:${size[0]}px;height:${size[1]}px;overflow:hidden;position:relative">${design(kind, size)}</body>`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(OUT, `katkee-ad-${kind}-${name}-${size[0]}x${size[1]}.jpg`), type: "jpeg", quality: 90 });
    }
  }
  await browser.close();
  console.log(`ad images → ${OUT}`);
})();
