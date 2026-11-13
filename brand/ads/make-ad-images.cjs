// Google Ads App campaign images, in the sizes Google asks for: landscape 1200x628, square
// 1200x1200 and portrait 1200x1500. Two designs each (a Story on a phone, and a profile with the
// Founding member badge), so Google can mix and test them. The app itself is shown, not the
// mascot; the photos are painted gradients, never real people.
//
//   node brand/ads/make-ad-images.cjs [outDir]
//
// Google prefers little text on the picture (the headlines and descriptions carry the words), so
// each image has one short line. No real people.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { C } = require("../mascot/kee.cjs");

const OUT = process.argv[2] || path.join(__dirname, "ad-images");
const FONT = "Inter, sans-serif";
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "..", "katkee-app-icon-1024.png")).toString("base64")}`;
const STAR = "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";
/** Real photos (brand/ads/photos, Unsplash License; no faces), as data URIs. */
const photo = (name) => `data:image/jpeg;base64,${fs.readFileSync(path.join(__dirname, "photos", `${name}.jpg`)).toString("base64")}`;
const img = (name, style) => `<img src="${photo(name)}" style="object-fit:cover;${style}">`;
const SIZES = { landscape: [1200, 628], square: [1200, 1200], portrait: [1200, 1500] };

const bg = (w, h) => `<svg width="${w}" height="${h}" style="position:absolute;inset:0">
  <defs><radialGradient id="g" cx="50%" cy="45%" r="80%"><stop offset="0" stop-color="#1B2433"/><stop offset="1" stop-color="#080C14"/></radialGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.72}" cy="${h * 0.62}" r="${Math.min(w, h) * 0.42}" fill="${C.amber}" opacity="0.08"/></svg>`;
/** A phone at `h` pixels tall showing `screen` (HTML), slightly tilted. */
const phone = (screen, x, y, h, tilt = 0) => {
  const w = h * 0.49;
  return `<div style="position:absolute;left:${x - w / 2}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${h * 0.07}px;background:#0B0F17;
    padding:${h * 0.018}px;box-sizing:border-box;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 2px #2A3344;transform:rotate(${tilt}deg)">
    <div style="position:relative;width:100%;height:100%;border-radius:${h * 0.055}px;overflow:hidden">${screen(h)}</div></div>`;
};
/** A Story: a sunset photo, highlighted text, a song and a friend's reply. */
const storyScreen = (h) => {
  const u = h / 1000;
  return `${img("story-coffee", "position:absolute;inset:0;width:100%;height:100%")}
    <div style="position:absolute;left:0;right:0;top:0;height:22%;background:linear-gradient(180deg,rgba(0,0,0,.5),transparent)"></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:34%;background:linear-gradient(180deg,transparent,rgba(10,8,12,.8))"></div>
    <div style="position:absolute;left:${18 * u}px;right:${18 * u}px;top:${22 * u}px;display:flex;gap:${6 * u}px">${[1, 0.4, 0.4].map((o) => `<div style="flex:1;height:${5 * u}px;border-radius:9px;background:rgba(255,255,255,${o})"></div>`).join("")}</div>
    <div style="position:absolute;left:${18 * u}px;top:${44 * u}px;display:flex;align-items:center;gap:${12 * u}px">
      ${img("avatar-cat", `width:${52 * u}px;height:${52 * u}px;border-radius:50%;border:${4 * u}px solid ${C.amber};box-sizing:border-box`)}
      <span style="font:800 ${30 * u}px ${FONT};color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.4)">priya</span><span style="font:600 ${26 * u}px ${FONT};color:rgba(255,255,255,.8)">2h</span></div>
    <div style="position:absolute;left:${24 * u}px;top:${130 * u}px;display:inline-flex;align-items:center;gap:${10 * u}px;padding:${10 * u}px ${20 * u}px;border-radius:999px;background:rgba(0,0,0,.45);font:700 ${26 * u}px ${FONT};color:#fff">♫ Sunday Vibes</div>
    <div style="position:absolute;left:${36 * u}px;right:${36 * u}px;top:${300 * u}px;text-align:center;font:900 ${58 * u}px/1.32 ${FONT}">
      <span style="background:${C.amber};color:#0B0F17;padding:${2 * u}px ${16 * u}px;border-radius:${12 * u}px;box-decoration-break:clone;-webkit-box-decoration-break:clone">Sunday coffee with the gang ☕</span></div>
    <div style="position:absolute;left:${24 * u}px;right:${24 * u}px;bottom:${36 * u}px;display:flex;align-items:center;gap:${14 * u}px">
      <div style="flex:1;padding:${18 * u}px ${24 * u}px;border-radius:999px;border:${2 * u}px solid rgba(255,255,255,.7);font:600 ${26 * u}px ${FONT};color:rgba(255,255,255,.85)">Reply to priya…</div>
      <span style="font-size:${46 * u}px">❤️</span></div>
    <div style="position:absolute;left:${36 * u}px;bottom:${150 * u}px;padding:${16 * u}px ${22 * u}px;border-radius:${26 * u}px;background:rgba(255,255,255,.95);font:700 ${26 * u}px ${FONT};color:#0B0F17;box-shadow:0 6px 18px rgba(0,0,0,.3)">rahul: Save me a cup! 😄</div>`;
};
/** A profile with the Founding member badge. */
const profileScreen = (h) => {
  const u = h / 1000;
  return `<div style="position:absolute;inset:0;background:#0B0B0B"></div>
    ${img("cover-mountains", `position:absolute;left:0;top:0;width:100%;height:${230 * u}px`)}
    ${img("avatar-dog", `position:absolute;left:${30 * u}px;top:${160 * u}px;width:${150 * u}px;height:${150 * u}px;border-radius:50%;border:${6 * u}px solid #0B0B0B;box-sizing:border-box`)}
    <div style="position:absolute;left:${196 * u}px;right:${12 * u}px;top:${250 * u}px;display:flex;justify-content:space-between;color:#fff;text-align:center">
      ${[["12", "Stories"], ["148", "Followers"], ["96", "Following"]].map(([n, l]) => `<div style="flex:1"><div style="font:800 ${32 * u}px ${FONT}">${n}</div><div style="font:500 ${18 * u}px ${FONT};color:#C9D1DE">${l}</div></div>`).join("")}</div>
    <div style="position:absolute;left:${30 * u}px;top:${340 * u}px;font:800 ${36 * u}px ${FONT};color:#fff">You</div>
    <div style="position:absolute;left:${30 * u}px;top:${396 * u}px;display:inline-flex;align-items:center;gap:${10 * u}px;padding:${8 * u}px ${18 * u}px;border-radius:999px;border:${3 * u}px solid ${C.amber};color:${C.amber};font:800 ${26 * u}px ${FONT};background:rgba(255,200,0,.08)">
      <svg width="${26 * u}" height="${26 * u}" viewBox="0 0 24 24"><path d="${STAR}" fill="${C.amber}" stroke="${C.amber}" stroke-width="2" stroke-linejoin="round"/></svg>Founding member #27</div>
    <div style="position:absolute;left:${30 * u}px;top:${470 * u}px;font:500 ${26 * u}px ${FONT};color:#E4E8F0">Chai, friends & late-night Stories ✨</div>
    <div style="position:absolute;left:${30 * u}px;right:${30 * u}px;top:${560 * u}px;display:grid;grid-template-columns:repeat(3,1fr);gap:${14 * u}px">
      ${[["hl-taj", "Agra"], ["hl-beach", "Goa"], ["hl-pizza", "Food"], ["hl-lake", "Trips"], ["hl-chai", "Chai"], ["hl-road", "Roads"]].map(([n, label]) => `<div>
        ${img(n, `display:block;width:100%;height:${165 * u}px;border-radius:${18 * u}px`)}
        <div style="text-align:center;font:700 ${20 * u}px ${FONT};color:#fff;margin-top:${6 * u}px">${label}</div></div>`).join("")}</div>`;
};

function design(kind, [w, h]) {
  const wide = w / h > 1.4;
  // Text block on the left for landscape, on top for square and portrait.
  const textBox = wide
    ? `position:absolute;left:70px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center;gap:22px`
    : `position:absolute;left:70px;right:70px;top:${h * 0.09}px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:24px`;
  // The phone: right of the text when wide, below it otherwise.
  const ph = wide ? h * 1.0 : h > 1300 ? h * 0.58 : h * 0.52;
  const px = wide ? w * 0.78 : w / 2;
  const py = wide ? h * 0.08 : h - ph - h * 0.04;
  const brandRow = `<div style="display:flex;align-items:center;gap:16px;${wide ? "" : "justify-content:center"}">
    <img src="${ICON}" style="width:${wide ? 76 : 96}px;height:${wide ? 76 : 96}px;border-radius:${wide ? 18 : 22}px">
    <span style="font:900 ${wide ? 52 : 64}px ${FONT};color:${C.amber};letter-spacing:-0.02em">Katkee</span></div>`;
  if (kind === "stories") {
    return `${bg(w, h)}
      <div style="${textBox}">${brandRow}
        <div style="font:900 ${wide ? 64 : 84}px/1.05 ${FONT};color:#fff;letter-spacing:-0.02em">Stories with<br>your people</div>
        <div style="font:700 ${wide ? 30 : 38}px/1.3 ${FONT};color:#C9D1DE">Music · filters · chat</div></div>
      ${phone(storyScreen, px, py, ph, wide ? 4 : 0)}`;
  }
  return `${bg(w, h)}
    <div style="${textBox}">${brandRow}
      <div style="font:900 ${wide ? 60 : 80}px/1.05 ${FONT};color:#fff;letter-spacing:-0.02em">Be one of the<br><span style="color:${C.amber}">first 1,000</span></div>
      <div style="display:inline-flex;align-self:${wide ? "flex-start" : "center"};align-items:center;gap:12px;padding:12px 26px;border-radius:999px;border:3px solid ${C.amber};color:${C.amber};font:800 ${wide ? 30 : 40}px ${FONT}">
        <svg width="${wide ? 30 : 40}" height="${wide ? 30 : 40}" viewBox="0 0 24 24"><path d="${STAR}" fill="${C.amber}" stroke="${C.amber}" stroke-width="2" stroke-linejoin="round"/></svg>Founding member</div></div>
    ${phone(profileScreen, px, py, ph, wide ? -4 : 0)}`;
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
