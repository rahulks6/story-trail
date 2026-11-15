// Katkee's own social profiles: a profile picture that survives a round crop, and covers for
// LinkedIn (company page), X, Facebook and YouTube, each keeping its words inside the part every
// device shows. Real app screens (demo accounts).
//   node brand/social/make-brand-profiles.cjs [outDir]
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT = process.argv[2] || path.join(__dirname, "brand-profiles");
const RAW = path.join(__dirname, "..", "store", "screenshots", "raw");
const raw = (n) => `data:image/png;base64,${fs.readFileSync(path.join(RAW, `${n}.png`)).toString("base64")}`;
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "..", "katkee-app-icon-1024.png")).toString("base64")}`;
const MARK = fs.readFileSync(path.join(__dirname, "..", "katkee-mark.svg"), "utf8").replace(/<\?xml[^>]*>/, "");
const BG = "radial-gradient(ellipse 55% 120% at 80% 60%,rgba(255,200,0,.22),transparent 70%),radial-gradient(ellipse 40% 80% at 0% 0%,rgba(255,61,110,.16),transparent 70%),#080C14";

const phone = (screen, cx, top, h, tilt) => `<div style="position:absolute;left:${cx - h * 0.225}px;top:${top}px;width:${h * 0.45}px;height:${h}px;border-radius:${h * 0.065}px;padding:${h * 0.016}px;background:#0A0D13;box-shadow:0 30px 70px rgba(0,0,0,.6),0 0 0 2px #2A3344;transform:rotate(${tilt}deg)"><div style="width:100%;height:100%;border-radius:${h * 0.052}px;overflow:hidden"><img src="${raw(screen)}" style="width:100%;height:100%;object-fit:cover;object-position:top;display:block"></div></div>`;

/** The words: logo, line, sub-line and the two pills, `u` scaling everything. */
const words = (u, left, top, width) => `<div style="position:absolute;left:${left}px;top:${top}px;width:${width}px">
  <div style="display:flex;align-items:center;gap:${10 * u}px;font:800 ${30 * u}px Inter;letter-spacing:-.5px">${MARK.replace("<svg", `<svg height="${34 * u}"`)}<span>Kat<span style="color:#FFC800">kee</span></span></div>
  <div style="margin-top:${12 * u}px;font:900 ${58 * u}px/1.02 Inter;letter-spacing:${-2 * u}px">Stories for <em>your people.</em></div>
  <div style="margin-top:${12 * u}px;font:500 ${22 * u}px/1.35 Inter;color:#C9D1DE">Close Friends, music, chats and video calls.</div>
  <div style="margin-top:${16 * u}px;display:flex;gap:${10 * u}px;font:700 ${18 * u}px Inter">
    <span style="padding:${8 * u}px ${16 * u}px;border-radius:999px;background:#FFC800;color:#0B0F17">Free on Google Play</span>
    <span style="padding:${8 * u}px ${16 * u}px;border-radius:999px;background:rgba(255,255,255,.1)">katkee.com</span></div></div>`;

const COVERS = {
  // LinkedIn company page: short and wide; the logo sits below the left edge.
  "linkedin-company-1128x191": [1128, 191, () => `${words(0.5, 300, 22, 520)}${phone("phone-home", 900, 18, 300, -6)}${phone("phone-chat", 1020, 30, 300, 5)}`],
  "x-1500x500": [1500, 500, () => `${words(1.05, 90, 100, 900)}${phone("phone-home", 1130, 60, 560, -6)}${phone("phone-chat", 1340, 90, 560, 5)}`],
  // Facebook: phones crop the sides, so everything stays in the middle 1100 px.
  "facebook-1640x624": [1640, 624, () => `${words(1.0, 260, 160, 760)}${phone("phone-home", 1200, 70, 600, -6)}${phone("phone-chat", 1380, 100, 600, 5)}`],
  // YouTube: only the centre 1546 x 423 shows on every device.
  "youtube-2560x1440": [2560, 1440, () => `${words(1.25, 540, 560, 900)}${phone("phone-home", 1650, 470, 640, -6)}${phone("phone-chat", 1890, 500, 640, 5)}`],
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const render = async (name, w, h, body, scale = 2) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">
      <style>*{margin:0;padding:0;box-sizing:border-box}body{width:${w}px;height:${h}px;overflow:hidden;position:relative;font-family:Inter;color:#fff;background:${BG}}
      em{font-style:normal;background:linear-gradient(90deg,#FFC800,#FF8A00 60%,#FF3D6E);-webkit-background-clip:text;background-clip:text;color:transparent}</style></head><body>${body}</body></html>`, { waitUntil: "networkidle" }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, `katkee-${name}.png`);
    await page.screenshot({ path: file, type: "png" });
    await page.close();
    console.log(file);
  };
  // Profile picture: the icon inside the circle every app crops to, on Katkee yellow.
  await render("profile-picture-1080", 1080, 1080, `<div style="position:absolute;inset:0;background:#FFC800"></div><img src="${ICON}" style="position:absolute;left:190px;top:190px;width:700px;height:700px;border-radius:160px;box-shadow:0 30px 60px rgba(0,0,0,.25)">`, 1);
  for (const [name, [w, h, body]] of Object.entries(COVERS)) await render(name, w, h, body(), name.startsWith("youtube") ? 1 : 2);
  await browser.close();
})();
