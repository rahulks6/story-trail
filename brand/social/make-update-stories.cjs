// Instagram Stories announcing what's new in Katkee (1080x1920 PNGs), with Kee.
//
//   node brand/social/make-update-stories.cjs [outDir]
//
// Text stays inside the Story safe area (clear of the top bar and the reply box). No real
// people: the profile and text examples are made up.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { kee, C } = require("../mascot/kee.cjs");

const OUT = process.argv[2] || path.join(__dirname, "update-stories");
const W = 1080;
const H = 1920;
const FONT = "Inter, sans-serif";
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "..", "katkee-app-icon-1024.png")).toString("base64")}`;
const STAR = "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

const bg = (accent = 0.08) => `<svg width="${W}" height="${H}" style="position:absolute;inset:0">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="80%"><stop offset="0" stop-color="#1B2433"/><stop offset="1" stop-color="#080C14"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="${W / 2}" cy="1250" r="460" fill="${C.amber}" opacity="${accent}"/></svg>`;
const keeAt = (opts, x, ground, s) => `<svg width="${W}" height="${H}" style="position:absolute;inset:0">
  <ellipse cx="${x}" cy="${ground + 8}" rx="${115 * s}" ry="${17 * s}" fill="#000" opacity="0.3"/>
  <g transform="translate(${x - 200 * s},${ground - 452 * s}) scale(${s})">${kee(opts)}</g></svg>`;
const line = (html, y, size, { color = "#fff", weight = 900, extra = "" } = {}) =>
  `<div style="position:absolute;left:70px;right:70px;top:${y}px;text-align:center;font:${weight} ${size}px/1.1 ${FONT};color:${color};letter-spacing:-0.02em;${extra}">${html}</div>`;
const amber = (s) => `<span style="color:${C.amber}">${s}</span>`;
const kicker = (text, y = 250) => `<div style="position:absolute;left:0;right:0;top:${y}px;display:flex;justify-content:center">
  <div style="padding:12px 26px;border-radius:999px;background:rgba(255,200,0,.14);border:2px solid ${C.amber};color:${C.amber};font:800 30px ${FONT};letter-spacing:.06em">${text}</div></div>`;
const brand = `<div style="position:absolute;left:0;right:0;bottom:330px;display:flex;justify-content:center;align-items:center;gap:14px">
  <img src="${ICON}" style="width:56px;height:56px;border-radius:14px"><span style="font:800 36px ${FONT};color:#fff">Katkee</span></div>`;
const card = (inner, top, height, extra = "") => `<div style="position:absolute;left:110px;right:110px;top:${top}px;height:${height}px;border-radius:44px;overflow:hidden;${extra}">${inner}</div>`;
const photo = (hue = 0) => `background:linear-gradient(160deg, hsl(${205 + hue},45%,68%), hsl(${30 + hue},75%,74%) 55%, hsl(${105 + hue},22%,46%))`;

const STORIES = {
  "1-whats-new": () => `${bg(0.1)}
    ${line("What's new on", 330, 96)}${line(amber("Katkee"), 440, 150)}
    ${line("6 updates you'll love 👇", 640, 52, { weight: 700, color: "#C9D1DE" })}
    ${keeAt({ eyes: "star", mouth: "grin", armL: 150, armR: 150, spark: "star", glow: 1 }, W / 2, 1460, 1.55)}
    ${line("Tap to see →", 1500, 40, { weight: 700, color: "rgba(255,255,255,.7)" })}`,

  "2-google-sign-in": () => `${bg()}
    ${kicker("NEW")}
    ${line("Sign in with", 360, 92)}${line(amber("Google"), 465, 120)}
    ${line("One tap. No password to remember.", 620, 46, { weight: 700, color: "#C9D1DE" })}
    <div style="position:absolute;left:170px;right:170px;top:760px;height:120px;border-radius:24px;background:#fff;display:flex;align-items:center;justify-content:center;font:700 44px ${FONT};color:#1F1F1F;box-shadow:0 24px 60px rgba(0,0,0,.45)">Sign in with Google</div>
    ${keeAt({ eyes: "happy", mouth: "grin", armR: 160, armL: 25, spark: "dot", glow: 0.8 }, W / 2, 1440, 1.2)}${brand}`,

  "3-text-looks": () => `${bg()}
    ${kicker("NEW")}
    ${line("Make your words", 360, 84)}${line(amber("pop"), 460, 120)}
    ${line("Highlighter & border for text, in any font", 610, 42, { weight: 700, color: "#C9D1DE" })}
    ${card(`<div style="height:100%;${photo()};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px">
      <div style="font:800 64px/1.3 ${FONT};text-align:center;max-width:640px"><span style="background:${C.amber};color:#000;padding:2px 18px;border-radius:14px;box-decoration-break:clone;-webkit-box-decoration-break:clone">Sunday chai with the gang</span></div>
      <div style="font:900 70px/1.2 ${FONT};color:#fff;-webkit-text-stroke:9px #000;paint-order:stroke fill;text-align:center">Best day ever!</div></div>`, 720, 620)}
    ${line("Tap <b style=\"color:#fff\">A</b> in the text tool", 1380, 42, { weight: 700, color: "#C9D1DE" })}${brand}`,

  "4-music": () => `${bg()}
    ${kicker("MUSIC")}
    ${line(amber("100+"), 350, 170)}${line("free songs", 530, 96)}
    ${line("Clips up to 60 seconds", 660, 44, { weight: 700, color: "#C9D1DE" })}
    ${line("🎵 Song sticker for any song you love", 740, 42, { weight: 800 })}
    ${keeAt({ eyes: "closed", mouth: "smile", spark: "note", armL: 140, armR: 100, tilt: -6, legs: "walkA", glow: 1 }, W / 2, 1500, 1.15)}${brand}`,

  "5-filters-carousel": () => `${bg()}
    ${kicker("CREATE")}
    ${line("Retro filters &", 350, 84)}${line(amber("carousels"), 450, 112)}
    ${line("Film, Instant, Sepia, Noir · 10 photos per Story", 600, 40, { weight: 700, color: "#C9D1DE" })}
    <div style="position:absolute;left:0;right:0;top:720px;display:flex;justify-content:center;gap:26px">
      ${[["sepia(.75) saturate(1.2)", 0, "Retro"], ["grayscale(1) contrast(1.3)", 20, "Noir"], ["contrast(.9) brightness(1.08) saturate(.8)", -15, "Instant"]].map(([f, h, n], i) => `
      <div style="width:250px;height:400px;border-radius:30px;${photo(h)};filter:${f};transform:rotate(${(i - 1) * 6}deg) translateY(${i === 1 ? -20 : 0}px);box-shadow:0 20px 50px rgba(0,0,0,.5);position:relative">
        <div style="position:absolute;left:0;right:0;bottom:18px;text-align:center;font:800 32px ${FONT};color:#fff;filter:none;text-shadow:0 2px 10px rgba(0,0,0,.6)">${n}</div></div>`).join("")}
    </div>
    ${line("No more cropped photos: pinch to fit", 1210, 42, { weight: 800 })}${brand}`,

  "6-founding-member": () => `${bg(0.1)}
    ${kicker("ONLY 1,000")}
    ${line("Be a", 370, 84)}${line(amber("Founding member"), 470, 104)}
    ${line("A numbered badge on your profile", 620, 44, { weight: 700, color: "#C9D1DE" })}
    <div style="position:absolute;left:0;right:0;top:760px;display:flex;justify-content:center">
      <div style="display:inline-flex;align-items:center;gap:18px;padding:18px 40px;border-radius:999px;border:4px solid ${C.amber};color:${C.amber};font:800 58px ${FONT};background:rgba(255,200,0,.07)">
        <svg width="56" height="56" viewBox="0 0 24 24"><path d="${STAR}" fill="${C.amber}" stroke="${C.amber}" stroke-width="2" stroke-linejoin="round"/></svg>Founding member #?</div></div>
    ${keeAt({ eyes: "star", mouth: "grin", armL: 150, armR: 150, spark: "star", glow: 1, legs: "jump" }, W / 2, 1440, 1.2)}${brand}`,

  "7-update-now": () => `${bg(0.12)}
    <img src="${ICON}" style="position:absolute;left:${W / 2 - 110}px;top:300px;width:220px;height:220px;border-radius:52px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
    ${line("Update", 580, 110)}${line(amber("Katkee"), 700, 130)}
    ${line("All of this is live now", 870, 50, { weight: 700, color: "#C9D1DE" })}
    <div style="position:absolute;left:0;right:0;top:980px;display:flex;justify-content:center">
      <div style="padding:26px 56px;border-radius:999px;background:${C.amber};color:#0B0F17;font:900 50px ${FONT}">Free on Google Play</div></div>
    ${line("Link in bio 🔗", 1120, 46, { weight: 800 })}
    ${keeAt({ eyes: "open", mouth: "grin", armR: 175, armL: 30, look: [3, -7], spark: "star", glow: 1 }, W / 2, 1580, 0.8)}`,
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [name, html] of Object.entries(STORIES)) {
    await page.setContent(`<!doctype html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative">${html()}</body>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, `katkee-update-${name}.png`) });
  }
  await browser.close();
  console.log(`stories → ${OUT}`);
})();
