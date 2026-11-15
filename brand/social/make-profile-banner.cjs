// Founder profile banners: LinkedIn (1584x396) and X (1500x500). The left of each stays quiet,
// where the profile photo sits over the banner. Real app screens (demo accounts) on the right.
//   node brand/social/make-profile-banner.cjs [outDir]
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT = process.argv[2] || path.join(__dirname, "profile-banner");
const RAW = path.join(__dirname, "..", "store", "screenshots", "raw");
const raw = (n) => `data:image/png;base64,${fs.readFileSync(path.join(RAW, `${n}.png`)).toString("base64")}`;
const MARK = fs.readFileSync(path.join(__dirname, "..", "katkee-mark.svg"), "utf8").replace(/<\?xml[^>]*>/, "");

const phone = (screen, left, top, h, tilt) => `<div style="position:absolute;left:${left}px;top:${top}px;width:${h * 0.45}px;height:${h}px;border-radius:${h * 0.065}px;padding:${h * 0.016}px;background:#0A0D13;box-shadow:0 30px 70px rgba(0,0,0,.6),0 0 0 2px #2A3344;transform:rotate(${tilt}deg)"><div style="width:100%;height:100%;border-radius:${h * 0.052}px;overflow:hidden"><img src="${raw(screen)}" style="width:100%;height:100%;object-fit:cover;object-position:top;display:block"></div></div>`;

const SIZES = {
  // LinkedIn: the photo covers roughly the left 400 px of the bottom half on desktop.
  linkedin: { w: 1584, h: 396, textLeft: 470, textTop: 52, textWidth: 660, title: 54, sub: 21, phones: [["phone-home", 1170, 46, 470, -6], ["phone-chat", 1360, 70, 470, 5]] },
  x: { w: 1500, h: 500, textLeft: 90, textTop: 110, textWidth: 860, title: 64, sub: 25, phones: [["phone-home", 1000, 60, 560, -6], ["phone-chat", 1220, 90, 560, 5]] },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, s] of Object.entries(SIZES)) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">
      <style>*{margin:0;padding:0;box-sizing:border-box}body{width:${s.w}px;height:${s.h}px;overflow:hidden;position:relative;font-family:Inter;color:#fff;
        background:radial-gradient(ellipse 55% 120% at 80% 60%,rgba(255,200,0,.22),transparent 70%),radial-gradient(ellipse 40% 80% at 0% 0%,rgba(255,61,110,.16),transparent 70%),#080C14}
        em{font-style:normal;background:linear-gradient(90deg,#FFC800,#FF8A00 60%,#FF3D6E);-webkit-background-clip:text;background-clip:text;color:transparent}</style></head><body>
      <div style="position:absolute;left:${s.textLeft}px;top:${s.textTop}px;width:${s.textWidth}px">
        <div style="display:flex;align-items:center;gap:12px;font:800 ${s.sub + 6}px Inter;letter-spacing:-.5px">${MARK.replace("<svg", `<svg height="${s.sub + 12}"`)}<span>Kat<span style="color:#FFC800">kee</span></span>
          <span style="margin-left:10px;padding:5px 12px;border-radius:999px;border:1.5px solid rgba(255,200,0,.6);font:700 ${s.sub - 6}px Inter;color:#FFC800">Founder</span></div>
        <div style="margin-top:14px;font:900 ${s.title}px/1.02 Inter;letter-spacing:-2px">Stories for <em>your people.</em></div>
        <div style="margin-top:14px;font:500 ${s.sub}px/1.35 Inter;color:#C9D1DE">Building India's Stories app for close friends: music, chats and video calls.</div>
        <div style="margin-top:16px;display:flex;gap:10px;font:700 ${s.sub - 4}px Inter">
          <span style="padding:8px 16px;border-radius:999px;background:#FFC800;color:#0B0F17">Free on Google Play</span>
          <span style="padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.1)">katkee.com</span></div>
      </div>
      ${s.phones.map(([n, l, t, h, r]) => phone(n, l, t, h, r)).join("")}
    </body></html>`, { waitUntil: "networkidle" }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, `katkee-${name}-banner-${s.w}x${s.h}.png`);
    await page.screenshot({ path: file, type: "png" });
    await page.close();
    console.log(file);
  }
  await browser.close();
})();
