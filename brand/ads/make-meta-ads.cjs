// Meta (Facebook and Instagram) ad posters: four ideas, each in Meta's three sizes —
// 1080x1080 (Feed), 1080x1350 (Feed, 4:5) and 1080x1920 (Stories and Reels, with the top and
// bottom 14% left clear for Instagram's own buttons). The real app screens from
// brand/store/screenshots/raw (demo accounts), no real people.
//
//   node brand/ads/make-meta-ads.cjs [outDir]
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT = process.argv[2] || path.join(__dirname, "meta");
const RAW = path.join(__dirname, "..", "store", "screenshots", "raw");
const raw = (n) => `data:image/png;base64,${fs.readFileSync(path.join(RAW, `${n}.png`)).toString("base64")}`;
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "..", "katkee-app-icon-1024.png")).toString("base64")}`;
const SIZES = { square: [1080, 1080], feed: [1080, 1350], story: [1080, 1920] };
const Y = "#FFC800";

const phone = (screen, cx, top, h, tilt = 0) => {
  const w = h * 0.45;
  return `<div style="position:absolute;left:${cx - w / 2}px;top:${top}px;width:${w}px;height:${h}px;border-radius:${h * 0.065}px;padding:${h * 0.016}px;background:#0A0D13;box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 2px #2A3344;transform:rotate(${tilt}deg)">
    <div style="width:100%;height:100%;border-radius:${h * 0.052}px;overflow:hidden"><img src="${raw(screen)}" style="width:100%;height:100%;object-fit:cover;object-position:top;display:block"></div></div>`;
};
const chip = (html, style) => `<div style="position:absolute;padding:16px 26px;border-radius:999px;font:800 34px Inter;box-shadow:0 14px 34px rgba(0,0,0,.35);white-space:nowrap;${style}">${html}</div>`;
const badge = (x, y, s = 1) => `<div style="position:absolute;left:${x}px;top:${y}px;transform:scale(${s});transform-origin:0 0;display:flex;align-items:center;gap:16px">
  <img src="${ICON}" style="width:76px;height:76px;border-radius:18px"><div><div style="font:900 40px Inter;color:#fff;letter-spacing:-1px">Katkee</div><div style="font:700 22px Inter;color:#C9D1DE">Free on Google Play</div></div></div>`;
const bgDark = (w, h) => `<div style="position:absolute;inset:0;background:radial-gradient(ellipse 70% 55% at 75% 70%,rgba(255,200,0,.20),transparent 70%),radial-gradient(ellipse 60% 40% at 0% 0%,rgba(255,61,110,.14),transparent 70%),#0B0F17"></div>`;
const bgYellow = () => `<div style="position:absolute;inset:0;background:${Y}"></div>`;

/** The headline and line under it, stacked so a long headline pushes the line down. */
const text = (title, sub, kind, ink = "#fff", subInk = "#C9D1DE") => {
  const sq = kind === "square", story = kind === "story";
  return `<div style="position:absolute;left:70px;top:${story ? 290 : 80}px;width:${sq ? 540 : 940}px">
    <div style="font:900 ${sq ? 76 : 96}px/1.02 Inter;color:${ink};letter-spacing:-3px">${title}</div>
    <div style="font:${ink === "#fff" ? 600 : 700} ${sq ? 30 : 38}px/1.3 Inter;color:${subInk};margin-top:${sq ? 22 : 26}px">${sub}</div></div>`;
};
/** Where the phone, the two chips and the Katkee badge go in each size. Stories keep the top and bottom 14% clear. */
const L = {
  square: { cx: 820, top: 150, h: 840, tilt: 4, chip1: [500, 770], chip2: [540, 880], badge: [70, 965, 0.9] },
  feed: { cx: 700, top: 470, h: 980, tilt: 0, chip1: [140, 1000], chip2: [180, 1110], badge: [70, 1230, 1] },
  story: { cx: 740, top: 760, h: 860, tilt: 0, chip1: [70, 1230], chip2: [110, 1340], badge: [70, 1470, 1] },
};

// Each idea lays itself out for a size: [w, h] → html.
const IDEAS = {
  // 1. Your 8, not 800 strangers (Close Friends).
  "1-your-people": (w, h, k) => { const l = L[k]; return `${bgDark(w, h)}
    ${text(`Post for your <span style="color:${Y}">8</span>.<br>Not 800 strangers.`, "Choose who sees every Story: Everyone, Followers or Close Friends.", k)}
    ${phone("phone-home", l.cx, l.top, l.h, l.tilt)}
    ${chip("★ Close Friends", `left:${l.chip1[0]}px;top:${l.chip1[1]}px;background:#2BB673;color:#fff`)}
    ${badge(...l.badge)}`; },
  // 2. Music on Stories.
  "2-add-music": (w, h, k) => { const l = L[k]; return `${bgYellow()}
    ${text("Your day,<br>with a song. 🎵", "Pick a song and the best part of it, add text and stickers. In seconds.", k, "#0B0F17", "#3B3000")}
    ${phone("phone-editor", l.cx, l.top, l.h, l.tilt)}
    ${chip("♫ Bright Wish · Kevin MacLeod", `left:${l.chip1[0]}px;top:${l.chip1[1]}px;background:#0B0F17;color:#fff;font-size:30px`)}
    <div style="position:absolute;left:${l.badge[0]}px;top:${l.badge[1]}px;display:flex;align-items:center;gap:16px;transform:scale(${l.badge[2]});transform-origin:0 0"><img src="${ICON}" style="width:76px;height:76px;border-radius:18px"><div><div style="font:900 40px Inter;color:#0B0F17;letter-spacing:-1px">Katkee</div><div style="font:700 22px Inter;color:#3B3000">Free on Google Play</div></div></div>`; },
  // 3. Chai pe chalein? Chats, voice notes, calls (Hinglish).
  "3-chai-plans": (w, h, k) => { const l = L[k]; return `${bgDark(w, h)}
    ${text(`Chai pe<br><span style="color:${Y}">chalein?</span> ☕`, "Stories, chats, voice notes and video calls with your friends. Sab ek app mein.", k)}
    ${phone("phone-chat", l.cx, l.top, l.h, l.tilt)}
    ${chip("🎙 Voice note · 0:04", `left:${l.chip1[0]}px;top:${l.chip1[1]}px;background:${Y};color:#0B0F17`)}
    ${chip("📹 Video call", `left:${l.chip2[0]}px;top:${l.chip2[1]}px;background:#fff;color:#0B0F17`)}
    ${badge(...l.badge)}`; },
  // 4. Founding member: the first 1,000 accounts get a numbered badge for good.
  "4-founding": (w, h, k) => { const l = L[k]; return `${bgDark(w, h)}
    ${text(`Be one of the<br>first <span style="color:${Y}">1,000</span>.`, "The first 1,000 people on Katkee get a numbered Founding member badge on their profile. For good.", k)}
    ${phone("phone-profile", l.cx, l.top, l.h, l.tilt)}
    <div style="position:absolute;left:${l.chip1[0]}px;top:${l.chip1[1]}px;padding:18px 30px;border-radius:24px;background:linear-gradient(135deg,#FFD84D,#FF9F1C);color:#0B0F17;font:900 38px Inter;box-shadow:0 16px 40px rgba(0,0,0,.4);white-space:nowrap">★ Founding member #57</div>
    ${badge(...l.badge)}`; },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [idea, make] of Object.entries(IDEAS)) {
    for (const [kind, [w, h]] of Object.entries(SIZES)) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800;900&display=swap" rel="stylesheet">
        <style>*{margin:0;padding:0;box-sizing:border-box}body{width:${w}px;height:${h}px;overflow:hidden;position:relative;font-family:Inter}</style></head><body>${make(w, h, kind)}</body></html>`, { waitUntil: "networkidle" }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(OUT, `katkee-${idea}-${kind}-${w}x${h}.png`);
      await page.screenshot({ path: file, type: "png" });
      await page.close();
      console.log(file);
    }
  }
  await browser.close();
})();
