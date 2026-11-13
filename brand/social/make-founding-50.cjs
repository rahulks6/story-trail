// Instagram Stories celebrating the first 50 Founding members (1080x1920 PNGs).
//
//   node brand/social/make-founding-50.cjs [outDir]
//
// Numbers only: no member's name, photo or username appears (tag people by hand only if they
// agree). Text stays inside the Story safe area.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { C } = require("../mascot/kee.cjs");

const OUT = process.argv[2] || path.join(__dirname, "founding-50");
const W = 1080;
const H = 1920;
const FONT = "Inter, sans-serif";
const JOINED = 50;
const TOTAL = 1000;
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "..", "katkee-app-icon-1024.png")).toString("base64")}`;
const STAR = "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

const bg = (glow = 0.1) => `<svg width="${W}" height="${H}" style="position:absolute;inset:0">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="80%"><stop offset="0" stop-color="#1B2433"/><stop offset="1" stop-color="#080C14"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="${W / 2}" cy="900" r="480" fill="${C.amber}" opacity="${glow}"/></svg>`;
const line = (html, y, size, { color = "#fff", weight = 900 } = {}) =>
  `<div style="position:absolute;left:70px;right:70px;top:${y}px;text-align:center;font:${weight} ${size}px/1.1 ${FONT};color:${color};letter-spacing:-0.02em">${html}</div>`;
const amber = (s) => `<span style="color:${C.amber}">${s}</span>`;
const kicker = (text, y = 250) => `<div style="position:absolute;left:0;right:0;top:${y}px;display:flex;justify-content:center">
  <div style="padding:12px 26px;border-radius:999px;background:rgba(255,200,0,.14);border:2px solid ${C.amber};color:${C.amber};font:800 30px ${FONT};letter-spacing:.06em">${text}</div></div>`;
const brand = `<div style="position:absolute;left:0;right:0;bottom:330px;display:flex;justify-content:center;align-items:center;gap:14px">
  <img src="${ICON}" style="width:56px;height:56px;border-radius:14px"><span style="font:800 36px ${FONT};color:#fff">Katkee</span></div>`;
const star = (size, fill = C.amber) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${STAR}" fill="${fill}" stroke="${fill}" stroke-width="2" stroke-linejoin="round"/></svg>`;
const badge = (n, size = 58) => `<div style="display:inline-flex;align-items:center;gap:${size * 0.3}px;padding:${size * 0.3}px ${size * 0.7}px;border-radius:999px;border:${Math.max(3, size / 14)}px solid ${C.amber};color:${C.amber};font:800 ${size}px ${FONT};background:rgba(255,200,0,.07)">${star(size)}Founding member #${n}</div>`;

// 50 numbered gold stars, 10 a row.
const wall = (top) => `<div style="position:absolute;left:110px;right:110px;top:${top}px;display:grid;grid-template-columns:repeat(10,1fr);gap:14px">
  ${Array.from({ length: JOINED }, (_, i) => `<div style="aspect-ratio:1;border-radius:18px;background:rgba(255,200,0,.13);border:2px solid rgba(255,200,0,.55);display:flex;align-items:center;justify-content:center;font:800 26px ${FONT};color:${C.amber}">${i + 1}</div>`).join("")}</div>`;

const STORIES = {
  "1-fifty": () => `${bg(0.14)}
    ${kicker("THANK YOU")}
    ${line(amber(String(JOINED)), 340, 300)}
    ${line("Founding members", 680, 92)}
    ${line("are already on Katkee 🎉", 790, 52, { weight: 700, color: "#C9D1DE" })}
    ${wall(930)}
    ${line("Every number is a real person who joined early", 1410, 36, { weight: 700, color: "rgba(255,255,255,.7)" })}${brand}`,

  "2-thank-you": () => `${bg()}
    ${kicker("TO OUR FIRST 50")}
    ${line("You believed in", 380, 88)}${line(amber("Katkee"), 490, 130)}
    ${line("before anyone else did.", 650, 56, { weight: 700, color: "#C9D1DE" })}
    ${line("Your Stories, your feedback and your<br>bug reports shaped every update. 🙏", 780, 42, { weight: 700 })}
    <div style="position:absolute;left:0;right:0;top:1010px;display:flex;justify-content:center">${badge(1, 50)}</div>
    <div style="position:absolute;left:0;right:0;top:1120px;display:flex;justify-content:center;opacity:.75">${badge(25, 44)}</div>
    <div style="position:absolute;left:0;right:0;top:1220px;display:flex;justify-content:center;opacity:.5">${badge(50, 38)}</div>
    ${line("Your badge stays on your profile forever", 1350, 40, { weight: 700, color: "#C9D1DE" })}${brand}`,

  "3-next": () => `${bg(0.12)}
    ${kicker(`ONLY ${TOTAL - JOINED} LEFT`)}
    ${line("Who's", 360, 96)}${line(amber(`#${JOINED + 1}`), 470, 200)}
    ${line("going to be?", 700, 96)}
    <div style="position:absolute;left:0;right:0;top:880px;display:flex;justify-content:center">${badge(JOINED + 1, 56)}</div>
    ${line(`${TOTAL.toLocaleString("en-IN")} badges. Never again after that.`, 1030, 42, { weight: 700, color: "#C9D1DE" })}
    <div style="position:absolute;left:0;right:0;top:1150px;display:flex;justify-content:center">
      <div style="padding:26px 56px;border-radius:999px;background:${C.amber};color:#0B0F17;font:900 50px ${FONT}">Free on Google Play</div></div>
    ${line("Link in bio 🔗 · Send this to a friend 👀", 1300, 44, { weight: 800 })}${brand}`,
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [name, html] of Object.entries(STORIES)) {
    await page.setContent(`<!doctype html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative">${html()}</body>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, `katkee-founding-${name}.png`) });
  }
  await browser.close();
  console.log(`stories → ${OUT}`);
})();
