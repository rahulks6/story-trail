// Video ad: a 15-second demo of the real app (Google Ads App campaigns, YouTube Shorts, Meta).
// Real screens from brand/store/screenshots/raw (demo accounts only, never real users) inside a
// phone, animated the way the app moves: a like on a Story, a song picked, who can see it switched
// to Followers only, a new message in a chat. One caption per scene, music and soft sound effects.
// Three shapes: vertical 1080x1920, square 1080x1080, landscape 1920x1080.
//
//   node brand/promo/make-app-demo.cjs <music.mp3> <sfxDir> [outDir]
// sfxDir holds tap.wav, pop.wav, whoosh.wav and ding.wav. The music credit is on the end card.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");

const [MUSIC, SFX, OUT = path.join(__dirname, "app-demo")] = process.argv.slice(2);
if (!MUSIC || !SFX) throw new Error("Usage: make-app-demo.cjs <music.mp3> <sfxDir> [outDir]");
const TRACK = process.env.TRACK || "Happy Alley";
const RAW = path.join(__dirname, "..", "store", "screenshots", "raw");
const img = (n) => `data:image/png;base64,${fs.readFileSync(path.join(RAW, `${n}.png`)).toString("base64")}`;
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "..", "katkee-app-icon-1024.png")).toString("base64")}`;
const FPS = 30;
const SECONDS = 15;

// Scene start times (seconds) and captions.
const T = { home: 0, editor: 3.4, settings: 6.7, chat: 10.0, end: 12.7 };
const CAPTIONS = [
  [T.home, "Stories for your<br><em>close friends</em>"],
  [T.editor, "Add any <em>song</em><br>to your Story"],
  [T.settings, "You choose<br><em>who sees it</em>"],
  [T.chat, "Chat &amp; <em>video&nbsp;call</em><br>your gang"],
];

const LAYOUTS = {
  vertical: { w: 1080, h: 1920, screenH: 1300, cx: 540, top: 500, cap: { left: 80, top: 150, width: 920, size: 96, align: "left" } },
  square: { w: 1080, h: 1080, screenH: 930, cx: 790, top: 75, cap: { left: 64, top: 340, width: 490, size: 64, align: "left" } },
  landscape: { w: 1920, h: 1080, screenH: 950, cx: 1420, top: 65, cap: { left: 150, top: 360, width: 820, size: 104, align: "left" } },
};

/** The page: everything positioned in screen pixels (1080 x 2400) and scaled into the phone. */
function html(L) {
  const sw = Math.round((L.screenH * 1080) / 2400);
  const pad = Math.round(L.screenH * 0.016);
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${L.w}px;height:${L.h}px;overflow:hidden;position:relative;font-family:Inter;color:#fff;
 background:radial-gradient(ellipse 65% 60% at 70% 85%,rgba(255,200,0,.22),transparent 70%),radial-gradient(ellipse 55% 45% at 0% 0%,rgba(255,61,110,.16),transparent 70%),#080C14}
em{font-style:normal;background:linear-gradient(90deg,#FFC800,#FF8A00 60%,#FF3D6E);-webkit-background-clip:text;background-clip:text;color:transparent}
.cap{position:absolute;left:${L.cap.left}px;top:${L.cap.top}px;width:${L.cap.width}px;font:900 ${L.cap.size}px/1.03 Inter;letter-spacing:-.03em;text-align:${L.cap.align}}
#phone{position:absolute;left:${L.cx - sw / 2 - pad}px;top:${L.top}px;width:${sw + 2 * pad}px;height:${L.screenH + 2 * pad}px;border-radius:${L.screenH * 0.065}px;padding:${pad}px;
 background:linear-gradient(160deg,#2a2d34,#121418);box-shadow:0 50px 120px rgba(0,0,0,.65),inset 0 0 0 2px rgba(255,255,255,.09)}
#screen{position:relative;width:${sw}px;height:${L.screenH}px;border-radius:${L.screenH * 0.052}px;overflow:hidden;background:#000}
#inner{position:absolute;left:0;top:0;width:1080px;height:2400px;transform-origin:0 0;transform:scale(${sw / 1080})}
.layer{position:absolute;left:0;top:0;width:1080px;height:2400px}
.shot{position:absolute;inset:0;background-size:1080px 2400px;background-repeat:no-repeat}
.ripple{position:absolute;width:160px;height:160px;margin:-80px 0 0 -80px;border-radius:50%;background:rgba(255,255,255,.55);opacity:0}
#end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${L.h * 0.02}px;opacity:0}
#end img{width:${Math.min(L.w, L.h) * 0.2}px;height:${Math.min(L.w, L.h) * 0.2}px;border-radius:22%;box-shadow:0 30px 70px rgba(0,0,0,.5)}
#end .name{font:900 ${Math.min(L.w, L.h) * 0.1}px Inter;letter-spacing:-.03em}
#end .line{font:800 ${Math.min(L.w, L.h) * 0.052}px/1.15 Inter;text-align:center;letter-spacing:-.02em}
#end .pill{margin-top:${L.h * 0.01}px;padding:${Math.min(L.w, L.h) * 0.022}px ${Math.min(L.w, L.h) * 0.05}px;border-radius:999px;background:#FFC800;color:#0B0F17;font:800 ${Math.min(L.w, L.h) * 0.042}px Inter}
#credit{position:absolute;left:0;right:0;bottom:${L.h * 0.025}px;text-align:center;font:500 ${Math.max(16, Math.min(L.w, L.h) * 0.019)}px Inter;color:rgba(255,255,255,.55);opacity:0}
</style></head><body>
${CAPTIONS.map((c, i) => `<div class="cap" id="cap${i}" style="opacity:0">${c[1]}</div>`).join("")}
<div id="phone"><div id="screen"><div id="inner">
  <div class="layer" id="home"><div class="shot" style="background-image:url(${img("phone-home")})"></div>
    <svg id="heart" viewBox="0 0 24 24" style="position:absolute;left:938px;top:1325px;width:80px;height:80px;opacity:0"><path fill="#FF3D6E" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.6 1.1 4.6 2.6l1 1.4 1-1.4C14 6.1 15.6 5 17.6 5 21 5 23.1 8.4 21.6 11.8 19.5 16.4 12 21 12 21z"/></svg>
    <div class="ripple" id="r-home" style="left:978px;top:1365px"></div></div>
  <div class="layer" id="editor"><div class="shot" style="background-image:url(${img("phone-editor")})"></div>
    <div id="rowflash" style="position:absolute;left:0;top:990px;width:1080px;height:150px;background:rgba(255,200,0,.28);opacity:0"></div>
    <div class="ripple" id="r-editor" style="left:420px;top:1044px;background:rgba(0,0,0,.18)"></div></div>
  <div class="layer" id="settings"><div class="shot" style="background-image:url(${img("phone-settings")})"></div>
    <svg viewBox="0 0 80 80" id="uncheck" style="position:absolute;left:926px;top:1163px;width:80px;height:80px;opacity:0"><circle cx="40" cy="40" r="36" fill="#EDEDF0"/><circle cx="40" cy="40" r="25" fill="none" stroke="#DADCE0" stroke-width="4"/></svg>
    <svg viewBox="0 0 80 80" id="check" style="position:absolute;left:926px;top:1301px;width:80px;height:80px;opacity:0"><circle cx="40" cy="40" r="36" fill="#EDEDF0"/><circle cx="40" cy="40" r="27" fill="#FFC800"/><path d="M28 41l8 8 16-17" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="ripple" id="r-settings" style="left:540px;top:1341px;background:rgba(0,0,0,.14)"></div></div>
  <div class="layer" id="chat"><div class="shot" style="background:#fff"></div>
    <div class="shot" id="chat-msgs" style="background-image:url(${img("phone-chat")});clip-path:inset(310px 0 200px 0)"></div>
    <div class="shot" style="background-image:url(${img("phone-chat")});clip-path:inset(0 0 2090px 0)"></div>
    <div class="shot" style="background-image:url(${img("phone-chat")});clip-path:inset(2225px 0 0 0)"></div>
    <div id="newmsg" style="position:absolute;right:45px;top:2078px;padding:26px 34px 20px;border-radius:38px 38px 10px 38px;background:#FFC800;color:#111;font:500 44px Inter;opacity:0;transform-origin:100% 100%">See you at 7! 🎉<div style="font-size:26px;text-align:right;opacity:.65;margin-top:6px">1:54 PM</div></div>
  </div>
</div></div></div>
<div id="end"><img src="${ICON}"><div class="name">Kat<span style="color:#FFC800">kee</span></div>
  <div class="line">Stories for your<br><em>close friends</em></div><div class="pill">Free on Google Play</div></div>
<div id="credit">Music: “${TRACK}” by Kevin MacLeod (incompetech.com), CC BY 4.0</div>
<script>
const T=${JSON.stringify(T)}, CAPS=${JSON.stringify(CAPTIONS.map((c) => c[0]))};
const clamp=(x)=>Math.max(0,Math.min(1,x)), ease=(x)=>1-Math.pow(1-clamp(x),3), $=(id)=>document.getElementById(id);
const pop=(x)=>{x=clamp(x);return x<.6?1.25*ease(x/.6):1.25-.25*ease((x-.6)/.4)};
function ripple(id,t,at){const e=$(id),k=(t-at)/0.45;e.style.opacity=k>0&&k<1?(1-k)*.9:0;e.style.transform='scale('+(0.3+k*1.2)+')';}
window.render=function(t){
  // Captions: in with a short rise, out before the next.
  CAPS.forEach((at,i)=>{const next=i+1<CAPS.length?CAPS[i+1]:T.end;const a=ease((t-at-.05)/.4),b=clamp((t-(next-.25))/.25);const e=$('cap'+i);e.style.opacity=t<at?0:a*(1-b);e.style.transform='translateY('+((1-a)*30)+'px)';});
  // The phone rises in, and steps aside for the end card.
  const up=ease(t/.6), out=ease((t-T.end)/.5);
  $('phone').style.transform='translateY('+((1-up)*120+out*80)+'%) scale('+(1-out*.15)+')';$('phone').style.opacity=1-out;
  // Screens slide in from the right.
  const order=['home','editor','settings','chat'];
  order.forEach((id,i)=>{const start=T[id],e=$(id);const k=i===0?1:ease((t-start)/.38);e.style.transform='translateX('+((1-k)*100)+'%)';e.style.zIndex=i;e.style.display=t>=start-0.01||i===0?'block':'none';});
  // Home: a like.
  ripple('r-home',t,1.5);const h=$('heart');h.style.opacity=t>1.6?1:0;h.style.transform='scale('+pop((t-1.6)/.35)+')';
  // Editor: a song picked.
  ripple('r-editor',t,4.7);$('rowflash').style.opacity=t>4.75?Math.max(0,1-(t-4.75)/1.2)*1:0;
  // Settings: Everyone -> Followers only.
  ripple('r-settings',t,8.0);$('uncheck').style.opacity=t>8.1?1:0;const c=$('check');c.style.opacity=t>8.1?1:0;c.style.transform='scale('+pop((t-8.1)/.35)+')';
  // Chat: the conversation moves up and a new message arrives.
  const m=ease((t-11.0)/.35);$('chat-msgs').style.transform='translateY('+(-m*150)+'px)';
  const n=$('newmsg');n.style.opacity=t>11.05?1:0;n.style.transform='scale('+pop((t-11.05)/.35)+')';
  // End card.
  const e=ease((t-T.end-.25)/.5);$('end').style.opacity=e;$('end').style.transform='scale('+(.92+.08*e)+')';$('credit').style.opacity=e;
};
</script></body></html>`;
}

async function renderLayout(browser, name, L) {
  const page = await browser.newPage({ viewport: { width: L.w, height: L.h }, deviceScaleFactor: 1 });
  await page.setContent(html(L), { waitUntil: "networkidle" }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  const silent = path.join(OUT, `.${name}-silent.mp4`);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", silent]);
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  for (let f = 0; f < FPS * SECONDS; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  await page.close();
  return silent;
}

/** Music under soft taps, pops and whooshes on the cues. */
function addSound(silent, out) {
  const cues = [["whoosh.wav", 0.05, 0.6], ["tap.wav", 1.5, 0.9], ["pop.wav", 1.6, 0.8], ["whoosh.wav", T.editor - 0.1, 0.6], ["tap.wav", 4.7, 0.9], ["ding.wav", 4.8, 0.5],
    ["whoosh.wav", T.settings - 0.1, 0.6], ["tap.wav", 8.0, 0.9], ["pop.wav", 8.1, 0.8], ["whoosh.wav", T.chat - 0.1, 0.6], ["ding.wav", 11.05, 0.7], ["whoosh.wav", T.end, 0.7]];
  const inputs = ["-i", silent, "-i", MUSIC, ...cues.flatMap(([f]) => ["-i", path.join(SFX, f)])];
  const fx = cues.map(([, at, vol], i) => `[${i + 2}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vol},adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)}[s${i}]`).join(";");
  const music = `[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${SECONDS},asetpts=PTS-STARTPTS,volume=0.7,afade=t=out:st=${SECONDS - 1.4}:d=1.4[mu]`;
  const mix = `[mu]${cues.map((_, i) => `[s${i}]`).join("")}amix=inputs=${cues.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${fx};${music};${mix}`, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(SECONDS), "-movflags", "+faststart", out]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(LAYOUTS);
  const browser = await chromium.launch();
  for (const name of only) {
    const L = LAYOUTS[name];
    const silent = await renderLayout(browser, name, L);
    const out = path.join(OUT, `katkee-app-demo-${name}-${L.w}x${L.h}.mp4`);
    addSound(silent, out);
    fs.rmSync(silent);
    console.log(out);
  }
  await browser.close();
})();
