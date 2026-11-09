#!/usr/bin/env node
// "Now on Google Play" launch images from real app screens (brand/store/screenshots/raw):
//   katkee-live-post.png   1080 x 1350  Instagram and LinkedIn feed
//   katkee-live-story.png  1080 x 1920  WhatsApp status and Instagram Story
// Plain text "Now on Google Play", not Google's badge artwork (the badge must be Google's own file).
// Run: node brand/social/make-live.cjs
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const DIR = __dirname;
const MARK = fs.readFileSync(path.join(DIR, "../katkee-mark.svg"), "utf8").replace(/<\?xml[^>]*>/, "");
const raw = (n) => `data:image/png;base64,${fs.readFileSync(path.join(DIR, "../store/screenshots/raw", `${n}.png`)).toString("base64")}`;

const css = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Inter, sans-serif; color: #fff; overflow: hidden;
    background: radial-gradient(ellipse 80% 45% at 50% 100%, rgba(255,200,0,0.25), transparent 70%),
                radial-gradient(ellipse 60% 35% at 0% 0%, rgba(255,61,110,0.16), transparent 70%), #0B0B0B; }
  .brand { display: flex; align-items: center; gap: 16px; font-weight: 800; letter-spacing: -0.02em; }
  .brand span { color: #FFC800; }
  .pill { display: inline-flex; align-items: center; gap: 12px; padding: 12px 24px; border-radius: 999px; font-weight: 700;
    color: #FFC800; background: rgba(255,200,0,0.12); border: 2px solid rgba(255,200,0,0.5); }
  .pill i { width: 12px; height: 12px; border-radius: 50%; background: #FFC800; box-shadow: 0 0 14px #FFC800; }
  h1 { font-weight: 900; letter-spacing: -0.035em; line-height: 1.02; }
  h1 em { font-style: normal; background: linear-gradient(90deg, #FFC800, #FF8A00 55%, #FF3D6E); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { color: rgba(255,255,255,0.75); font-weight: 500; line-height: 1.4; }
  .phone { position: absolute; border-radius: 56px; padding: 14px; background: linear-gradient(160deg, #2a2d34, #121418);
    box-shadow: 0 40px 100px rgba(0,0,0,0.7), inset 0 0 0 2px rgba(255,255,255,0.09); }
  .phone div { width: 100%; height: 100%; border-radius: 44px; overflow: hidden; background: #000; }
  .phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .search { display: inline-flex; align-items: center; gap: 14px; padding: 18px 30px; border-radius: 999px; background: #fff; color: #111; font-weight: 700; }
  .search svg { width: 30px; height: 30px; }
`;
const searchIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

const post = `<div style="position:relative;width:1080px;height:1350px">
  <div class="brand" style="position:absolute;left:80px;top:80px;font-size:46px">${MARK.replace("<svg", '<svg height="56"')}<div>Kat<span>kee</span></div></div>
  <div class="pill" style="position:absolute;left:80px;top:190px;font-size:28px"><i></i>Now on Google Play</div>
  <h1 style="position:absolute;left:80px;top:270px;font-size:96px">Your day,<br>in <em>Stories.</em></h1>
  <div class="sub" style="position:absolute;left:80px;top:490px;width:900px;font-size:34px">Share Stories, chat and video call the people who matter.</div>
  <div class="phone" style="left:120px;top:600px;width:400px;height:860px;transform:rotate(-5deg)"><div><img src="${raw("phone-home")}"></div></div>
  <div class="phone" style="left:560px;top:640px;width:400px;height:860px;transform:rotate(5deg)"><div><img src="${raw("phone-editor")}"></div></div>
</div>`;

const story = `<div style="position:relative;width:1080px;height:1920px">
  <div class="brand" style="position:absolute;left:0;right:0;top:120px;justify-content:center;font-size:54px">${MARK.replace("<svg", '<svg height="66"')}<div>Kat<span>kee</span></div></div>
  <div style="position:absolute;left:0;right:0;top:250px;text-align:center"><div class="pill" style="font-size:32px"><i></i>Now on Google Play</div></div>
  <h1 style="position:absolute;left:0;right:0;top:350px;text-align:center;font-size:110px">Your day,<br>in <em>Stories.</em></h1>
  <div class="sub" style="position:absolute;left:120px;right:120px;top:610px;text-align:center;font-size:38px">Share Stories, chat and video call the people who matter.</div>
  <div class="phone" style="left:300px;top:760px;width:480px;height:1000px"><div><img src="${raw("phone-home-music")}"></div></div>
  <div style="position:absolute;left:0;right:0;bottom:90px;text-align:center"><div class="search" style="font-size:34px">${searchIcon}Search “Katkee” on Google Play</div></div>
</div>`;

(async () => {
  const browser = await chromium.launch();
  for (const [name, html, w, h] of [["katkee-live-post", post, 1080, 1350], ["katkee-live-story", story, 1080, 1920]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">
      <style>${css}</style></head><body>${html}</body></html>`, { waitUntil: "networkidle" }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(DIR, `${name}.png`);
    await page.screenshot({ path: out });
    await page.close();
    console.log(out);
  }
  await browser.close();
})();
