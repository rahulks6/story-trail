#!/usr/bin/env node
// The Google Play feature graphic (1024 x 500, no transparency): Katkee's name and line on the
// left, two real app screens (Postcard look: cream paper, dark ink, amber highlight) (from screenshots/raw/) in phone frames on the right.
// Run: node brand/store/make-feature-graphic.cjs
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const DIR = __dirname;
const MARK = fs.readFileSync(path.join(DIR, "../katkee-mark.svg"), "utf8").replace(/<\?xml[^>]*>/, "");
const img = (name) => `data:image/png;base64,${fs.readFileSync(path.join(DIR, "screenshots/raw", `${name}.png`)).toString("base64")}`;
const [BACK, FRONT] = (process.argv[2] ?? "phone-chat,phone-home").split(",");

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@800&family=Inter:wght@500;800;900&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1024px; height: 500px; overflow: hidden; font-family: Inter, sans-serif; color: #1E1A16;
    background: radial-gradient(ellipse 55% 80% at 82% 60%, rgba(255,200,0,0.26), transparent 70%), #FBF6EC; }
  .brand { position: absolute; left: 64px; top: 66px; display: flex; align-items: center; gap: 14px; font-family: 'Baloo 2', sans-serif; font-size: 42px; font-weight: 800; }
  .brand span { color: #7F5600; }
  h1 { position: absolute; left: 64px; top: 146px; width: 520px; font-family: 'Baloo 2', sans-serif; font-size: 70px; font-weight: 800; line-height: 1.0; }
  h1 em { font-style: normal; background: linear-gradient(transparent 58%, #FFC800 62%, #FFC800 88%, transparent 88%); padding: 0 6px; margin: 0 -6px; }
  .sub { position: absolute; left: 64px; top: 320px; width: 470px; font-size: 22px; line-height: 1.4; color: #6B6155; font-weight: 500; }
  .phone { position: absolute; width: 214px; height: 470px; border-radius: 34px; padding: 8px;
    background: #1E1A16; box-shadow: 0 26px 60px rgba(80,56,0,0.30), 0 4px 14px rgba(30,26,22,0.2); }
  .phone div { width: 100%; height: 100%; border-radius: 27px; overflow: hidden; background: #FBF6EC; }
  .phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .back { left: 790px; top: 62px; transform: rotate(6deg); }
  .front { left: 600px; top: 40px; transform: rotate(-4deg); }
</style></head><body>
  <div class="brand">${MARK.replace("<svg", '<svg height="46"')}<div>Kat<span>kee</span></div></div>
  <h1>Your day,<br>in <em>Stories.</em></h1>
  <div class="sub">Share moments, chat and call the people who matter.</div>
  <div class="phone back"><div><img src="${img(BACK)}"></div></div>
  <div class="phone front"><div><img src="${img(FRONT)}"></div></div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle" }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(DIR, "google-play-feature-graphic-1024x500.png");
  await page.screenshot({ path: out, type: "png", omitBackground: false });
  await browser.close();
  console.log(out);
})();
