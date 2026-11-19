// Google Ads App campaign images (November 2026): four ideas, each in the three sizes Google
// asks for — landscape 1200x628, square 1200x1200, portrait 1200x1500. Real app screens from
// brand/store/screenshots/raw (demo accounts only, never real users), one short line each:
// Google prefers little text on images, since the headlines and descriptions carry the words.
// No fake buttons, no store badges, no other apps' names.
//
//   node brand/ads/make-google-ads.cjs [outDir]
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT = process.argv[2] || path.join(__dirname, "google");
const RAW = path.join(__dirname, "..", "store", "screenshots", "raw");
const raw = (n) => `data:image/png;base64,${fs.readFileSync(path.join(RAW, `${n}.png`)).toString("base64")}`;
const MARK = fs.readFileSync(path.join(__dirname, "..", "katkee-mark.svg"), "utf8").replace(/<\?xml[^>]*>/, "");

const SIZES = { landscape: [1200, 628], square: [1200, 1200], portrait: [1200, 1500] };

/** Chats keep their messages at the bottom; those screens are shown from there. */
const BOTTOM = new Set(["phone-chat", "phone-group"]);

/** A phone showing one real screen; cx is its centre, h its height. */
const phone = (screen, cx, top, h, tilt = 0) => {
  const w = h * 0.45;
  return `<div style="position:absolute;left:${cx - w / 2}px;top:${top}px;width:${w}px;height:${h}px;border-radius:${h * 0.065}px;padding:${h * 0.016}px;background:#0A0D13;box-shadow:0 40px 90px rgba(0,0,0,.6),0 0 0 2px #2A3344;transform:rotate(${tilt}deg)">
    <div style="width:100%;height:100%;border-radius:${h * 0.052}px;overflow:hidden"><img src="${raw(screen)}" style="width:100%;height:100%;object-fit:cover;object-position:${BOTTOM.has(screen) ? "bottom" : "top"};display:block"></div></div>`;
};

/** Logo, headline and the line under it. */
const words = (idea, size, left, top, width) => `<div style="position:absolute;left:${left}px;top:${top}px;width:${width}px">
  <div style="display:flex;align-items:center;gap:${12 * size}px;font:800 ${30 * size}px Inter;letter-spacing:-.5px">${MARK.replace("<svg", `<svg height="${36 * size}"`)}<span>Kat<span style="color:#FFC800">kee</span></span></div>
  <div style="margin-top:${18 * size}px;font:900 ${66 * size}px/1.02 Inter;letter-spacing:${-2 * size}px">${idea.title}</div>
  <div style="margin-top:${16 * size}px;font:500 ${26 * size}px/1.35 Inter;color:#C9D1DE">${idea.sub}</div></div>`;

// Each idea: two screens (front, back) and its words.
const IDEAS = {
  "close-friends": { screens: ["phone-home", "phone-chat"], title: "Stories for<br><em>your close friends</em>", sub: "Share your day with the people who matter." },
  "music": { screens: ["phone-editor", "phone-home-music"], title: "Add any <em>song</em><br>to your Story", sub: "Pick the best part, add text and stickers." },
  "chat": { screens: ["phone-chat", "phone-group"], title: "Chat &amp; <em>video call</em><br>your gang", sub: "Messages, voice notes and group chats." },
  "who-sees": { screens: ["phone-settings", "phone-profile"], title: "You choose<br><em>who sees it</em>", sub: "Everyone, followers or Close Friends." },
};

const LAYOUT = {
  landscape: (i) => `${words(i, 0.78, 60, 120, 600)}${phone(i.screens[1], 1010, 70, 600, 6)}${phone(i.screens[0], 840, 40, 640, -5)}`,
  square: (i) => `${words(i, 1, 80, 70, 1040)}${phone(i.screens[1], 790, 470, 860, 6)}${phone(i.screens[0], 460, 430, 900, -5)}`,
  portrait: (i) => `${words(i, 1.05, 80, 80, 1040)}${phone(i.screens[1], 800, 560, 1040, 6)}${phone(i.screens[0], 450, 520, 1080, -5)}`,
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, idea] of Object.entries(IDEAS)) {
    for (const [size, [w, h]] of Object.entries(SIZES)) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">
        <style>*{margin:0;padding:0;box-sizing:border-box}body{width:${w}px;height:${h}px;overflow:hidden;position:relative;font-family:Inter;color:#fff;
          background:radial-gradient(ellipse 60% 70% at 70% 85%,rgba(255,200,0,.24),transparent 70%),radial-gradient(ellipse 50% 45% at 0% 0%,rgba(255,61,110,.16),transparent 70%),#080C14}
          em{font-style:normal;background:linear-gradient(90deg,#FFC800,#FF8A00 60%,#FF3D6E);-webkit-background-clip:text;background-clip:text;color:transparent}</style></head>
        <body>${LAYOUT[size](idea)}</body></html>`, { waitUntil: "networkidle" }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(OUT, `katkee-${name}-${size}-${w}x${h}.png`);
      await page.screenshot({ path: file, type: "png" });
      await page.close();
      console.log(file);
    }
  }
  await browser.close();
})();
