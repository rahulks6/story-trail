// Vertical video ad for Android installs (Google App campaigns, YouTube Shorts, Instagram Reels):
// 1080 x 1920, 30 fps, about 18 s. The hook in the first 2.5 s: "You posted your day… and 2,481
// people you don't know watched it?" — a crowd of faceless strangers fills the screen; then
// "On Katkee, you choose." and the app itself: Stories just for your people, music and stickers,
// Layouts, chat and calls, and an install card.
//
//   node brand/promo/make-ad-video.cjs <music.mp3> [out.mp4] [en|hi]
//
// App screens: brand/store/screenshots/raw (demo accounts, no real people). Music: any track
// from the app's catalogue (Kevin MacLeod, CC BY 4.0); the end card credits it. Strangers are
// drawn silhouettes, never faces.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");
const { kee } = require("../mascot/kee.cjs");

const MUSIC = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, "katkee-ad-vertical.mp4");
const LANG = process.argv[4] || "en";
const TRACK = process.env.TRACK || "Funkorama";
if (!MUSIC) throw new Error("Pass the music file: node brand/promo/make-ad-video.cjs <music.mp3> [out.mp4] [en|hi]");

const W = 1080, H = 1920, FPS = 30, SECONDS = 18;
const RAW = path.join(__dirname, "..", "store", "screenshots", "raw");
const ICON = path.join(__dirname, "..", "katkee-app-icon-1024.png");
const data = (f) => `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;

const T = {
  en: {
    posted: "You posted your day…",
    strangers: "…and <em>2,481 strangers</em> watched it? 😬",
    not: "On <b>Katkee</b>,<br>you choose.",
    s1: ["Stories for<br><em>your people</em> only", "You choose who sees every Story"],
    chips: ["Everyone", "Followers", "Close Friends"],
    s2: ["Add <em>music</em>, text<br>&amp; stickers", "Pick a song and the best part of it"],
    s3: ["Six photos,<br><em>one Story</em>", "Katkee lays them out for you"],
    s4: ["Chat, voice notes<br>&amp; <em>video calls</em>", "With the people who matter"],
    cta: "Install free",
    store: "on Google Play",
    line: "Your day. Your people.",
  },
  hi: {
    posted: "आपने अपना दिन पोस्ट किया…",
    strangers: "…और <em>2,481 अनजान लोगों</em> ने देख लिया? 😬",
    not: "<b>Katkee</b> पर,<br>आप तय करें।",
    s1: ["स्टोरीज़ सिर्फ़<br><em>अपनों</em> के लिए", "हर स्टोरी कौन देखे, आप तय करें"],
    chips: ["सब", "फ़ॉलोअर", "क्लोज़ फ़्रेंड्स"],
    s2: ["<em>म्यूज़िक</em>, टेक्स्ट<br>और स्टिकर", "गाना चुनें, उसका बेस्ट हिस्सा भी"],
    s3: ["छह फ़ोटो,<br><em>एक स्टोरी</em>", "Katkee ख़ुद सजा देता है"],
    s4: ["चैट, वॉइस नोट<br>और <em>वीडियो कॉल</em>", "अपनों के साथ"],
    cta: "फ़्री इंस्टॉल करें",
    store: "Google Play पर",
    line: "आपका दिन। आपके लोग।",
  },
}[LANG];
if (!T) throw new Error(`no text for ${LANG}`);

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeIn = (t) => Math.pow(clamp(t), 3);
const backOut = (t) => { t = clamp(t); const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const pop = (t, t0, d = 0.3) => (t < t0 ? 0 : backOut((t - t0) / d));

const SCREENS = ["phone-home", "phone-editor", "phone-home-music", "phone-layout", "phone-chat", "phone-profile"];

// The crowd: faceless silhouettes that pile up while the view count runs.
let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const CROWD = Array.from({ length: 70 }, (_, i) => ({ x: 60 + rnd() * (W - 120), y: 700 + rnd() * 1150, s: 0.85 + rnd() * 0.8, at: 0.5 + i * 0.024 + rnd() * 0.1, hue: Math.floor(rnd() * 3) }));
const SIL = ["#3A4150", "#4A5263", "#2F3542"];

// Scenes after the hook: [start, end, [title, sub], phones [{s, x, y, w, r}], extra]
const SCENES = [
  [3.2, 6.4, T.s1, [{ s: "phone-home", x: 540, y: 650, w: 600, r: 0 }], "chips"],
  [6.4, 9.6, T.s2, [{ s: "phone-home-music", x: 330, y: 700, w: 500, r: -6 }, { s: "phone-editor", x: 750, y: 660, w: 500, r: 5 }]],
  [9.6, 12.6, T.s3, [{ s: "phone-layout", x: 540, y: 650, w: 600, r: 0 }]],
  [12.6, 15.0, T.s4, [{ s: "phone-chat", x: 330, y: 700, w: 500, r: -5 }, { s: "phone-profile", x: 750, y: 660, w: 500, r: 5 }]],
];

function frame(t) {
  const st = { phones: {}, texts: "", crowd: [], counter: null, flash: 0, kee: null, icon: 0, cta: 0, credit: 0, shake: 0 };

  if (t < 3.2) {
    // Hook: the text, the counter racing up, the crowd piling in; then it's all swept away.
    const sweep = easeIn((t - 2.55) / 0.4);
    const o = 1 - sweep;
    st.texts += txt(T.posted, 210, 76, pop(t, 0.05), o);
    st.texts += txt(T.strangers, 330, 76, pop(t, 0.75), o);
    const views = Math.floor(easeOut(clamp((t - 0.4) / 1.9)) * 2481);
    st.counter = t > 0.35 ? { n: views.toLocaleString("en-IN"), o, s: pop(t, 0.35) * (1 + 0.04 * Math.sin(t * 30) * (t < 2.3 ? 1 : 0)) } : null;
    st.crowd = CROWD.map((c) => ({ ...c, k: Math.min(pop(t, c.at, 0.25), 1 + 0) * (1 - sweep), o }));
    st.shake = t > 2.0 && t < 2.5 ? Math.sin(t * 80) * 6 : 0;
    if (t >= 2.6) {
      st.flash = clamp(1 - (t - 2.6) / 0.25);
      st.texts += txt(T.not, 700, 120, pop(t, 2.62, 0.3), 1 - easeIn((t - 3.0) / 0.2), "center", 900, "#fff");
    }
    return st;
  }

  for (const [a, b, [title, sub], phones, extra] of SCENES) {
    if (t < a || t >= b) continue;
    const lt = t - a;
    const out = easeIn((t - (b - 0.35)) / 0.35);
    const o = 1 - out;
    phones.forEach((p, i) => {
      const inT = easeOut((lt - i * 0.12) / 0.5);
      st.phones[p.s] = { x: p.x, y: H - inT * (H - p.y) - out * 80 + Math.sin(lt * 1.6 + i) * 6, w: p.w, r: p.r + (1 - inT) * 8, o: Math.min(inT, o) };
    });
    st.texts += txt(title, 170, 100, pop(lt, 0.1, 0.35), o, "center");
    st.texts += txt(sub, 420, 40, pop(lt, 0.4), o, "center", 600, "#C9D1DE");
    if (extra === "chips") {
      st.texts += `<div style="position:absolute;left:0;right:0;top:${H - 300}px;display:flex;justify-content:center;gap:16px;opacity:${o}">${T.chips.map((c, i) => {
        const on = i === 2 && lt > 1.2;
        const k = pop(lt, 0.7 + i * 0.12);
        return `<div style="transform:scale(${k});padding:16px 26px;border-radius:40px;font:800 34px Inter,'Noto Sans Devanagari';${on ? "background:#2BB673;color:#fff;box-shadow:0 0 0 6px rgba(43,182,115,.3)" : "background:rgba(8,12,20,.78);color:#fff"}">${on ? "★ " : ""}${c}</div>`;
      }).join("")}</div>`;
    }
    return st;
  }

  // End card: icon, name, the line, a pulsing install button, Kee cheering, confetti.
  const lt = t - 15.0;
  st.icon = pop(lt, 0.05, 0.4);
  st.texts += txt("<b>Katkee</b>", 640, 150, pop(lt, 0.3), 1, "center");
  st.texts += txt(T.line, 820, 54, pop(lt, 0.6), 1, "center", 700, "#C9D1DE");
  st.cta = pop(lt, 0.9, 0.35) * (1 + (lt > 1.4 ? 0.04 * Math.sin((lt - 1.4) * 7) : 0));
  const hop = Math.abs(Math.sin(lt * 5)) * 50;
  st.kee = { x: W / 2, y: 1760 - hop, s: 0.9, o: easeOut((lt - 0.2) / 0.3), opts: { eyes: "happy", mouth: "grin", armL: 160, armR: 160, legs: hop > 20 ? "jump" : undefined, spark: "star", glow: 1, t } };
  st.confetti = confetti(lt);
  st.credit = clamp((lt - 0.6) / 0.4);
  return st;
}

function confetti(t) {
  let r = 11;
  const rr = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const cols = ["#FFC800", "#FF3D6E", "#FFFFFF", "#4FC3F7", "#FF8A00"];
  let out = "";
  for (let i = 0; i < 80; i++) {
    // Down the sides only, so it never crosses the name, the line or the button.
    const side = rr(), x0 = side < 0.5 ? side * 2 * 190 : W - 190 + (side - 0.5) * 2 * 190, delay = rr() * 1.2, speed = 420 + rr() * 420, sway = 20 + rr() * 40, spin = rr() * 720;
    const c = cols[Math.floor(rr() * cols.length)];
    const tt = t - delay;
    if (tt < 0) continue;
    const y = -40 + tt * speed;
    if (y > H + 40) continue;
    out += `<rect x="-8" y="-15" width="16" height="30" rx="3" fill="${c}" transform="translate(${x0 + Math.sin(tt * 4 + i) * sway},${y}) rotate(${spin + tt * 360})"/>`;
  }
  return out;
}

function txt(html, top, size, scale, opacity, align = "center", weight = 900, color = "#fff") {
  if (scale <= 0.001 || opacity <= 0.001) return "";
  return `<div style="position:absolute;top:${top}px;left:70px;right:70px;text-align:${align};transform-origin:50% 50%;font:${weight} ${size}px/1.08 Inter,'Noto Sans Devanagari',sans-serif;letter-spacing:-0.02em;color:${color};opacity:${opacity};transform:scale(${scale})">${html}</div>`;
}

const silhouette = (c) => `<svg viewBox="0 0 100 110" width="100" height="110"><circle cx="50" cy="34" r="22" fill="${c}"/><path d="M8 110c0-26 19-44 42-44s42 18 42 44z" fill="${c}"/><text x="50" y="40" text-anchor="middle" font-size="22" font-family="Inter" font-weight="900" fill="#8A93A6">?</text></svg>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const phonesHtml = SCREENS.map((s) => `<div id="${s}" class="phone"><div class="scr"><img src="${data(path.join(RAW, `${s}.png`))}"></div></div>`).join("");
  const crowdHtml = CROWD.map((c, i) => `<div id="c${i}" class="sil" style="left:${c.x - 50}px;top:${c.y - 55}px">${silhouette(SIL[c.hue])}</div>`).join("");
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800;900&family=Noto+Sans+Devanagari:wght@600;700;800;900&display=swap" rel="stylesheet">
    <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:Inter,sans-serif;
      background:radial-gradient(ellipse 80% 45% at 50% 80%,rgba(255,200,0,.18),transparent 70%),
                 radial-gradient(ellipse 60% 40% at 0% 0%,rgba(255,61,110,.14),transparent 70%),#080C14}
    em{font-style:normal;background:linear-gradient(90deg,#FFC800,#FF8A00 60%,#FF3D6E);-webkit-background-clip:text;background-clip:text;color:transparent}
    b{color:#FFC800}
    #stage{position:absolute;inset:0}
    .phone{position:absolute;aspect-ratio:1080/2400;border-radius:9%/4%;padding:2.2%;opacity:0;transform-origin:50% 0;
      background:linear-gradient(160deg,#2a2d34,#121418);box-shadow:0 40px 100px rgba(0,0,0,.7),inset 0 0 0 2px rgba(255,255,255,.09)}
    .scr{width:100%;height:100%;border-radius:7.5%/3.4%;overflow:hidden;background:#000}
    .scr img{width:100%;height:100%;object-fit:cover;display:block}
    .sil{position:absolute;opacity:0}
    #counter{position:absolute;left:0;right:0;top:520px;display:flex;justify-content:center;opacity:0}
    #counter div{padding:18px 34px;border-radius:50px;background:rgba(255,61,110,.18);border:3px solid #FF3D6E;color:#fff;font:900 64px Inter;display:flex;gap:16px;align-items:center}
    #flash{position:absolute;inset:0;background:#FFC800;opacity:0}
    #kee{position:absolute;width:400px;height:500px;transform-origin:0 0}
    #icon{position:absolute;left:${W / 2 - 150}px;top:290px;width:300px;height:300px;border-radius:68px;box-shadow:0 26px 70px rgba(0,0,0,.6);opacity:0}
    #cta{position:absolute;left:0;right:0;top:960px;display:flex;justify-content:center;opacity:0}
    #cta div{padding:30px 60px;border-radius:60px;background:#FFC800;color:#0B0B0B;text-align:center;box-shadow:0 18px 50px rgba(255,200,0,.35)}
    #cta .a{font:900 60px Inter,'Noto Sans Devanagari'}
    #cta .b{font:700 38px Inter,'Noto Sans Devanagari';margin-top:6px}
    #credit{position:absolute;left:0;right:0;bottom:24px;text-align:center;font:500 24px Inter;color:#8E99AB;opacity:0}
  </style></head><body>
    <div id="stage">${crowdHtml}${phonesHtml}
      <div id="counter"><div><span>👁</span><span id="n">0</span></div></div>
      <svg id="conf" width="${W}" height="${H}" style="position:absolute;inset:0"></svg>
      <div id="txt" style="position:absolute;inset:0"></div>
      <img id="icon" src="${data(ICON)}">
      <div id="cta"><div><div class="a">${T.cta}</div><div class="b">${T.store}</div></div></div>
      <svg id="kee" viewBox="0 0 400 500"></svg>
      <div id="credit">Music: “${TRACK}” by Kevin MacLeod (incompetech.com), CC BY 4.0</div>
    </div>
    <div id="flash"></div>
  </body></html>`, { waitUntil: "networkidle" }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);

  const silent = OUT.replace(/\.mp4$/, ".silent.mp4");
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "19", silent]);
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));

  for (let i = 0; i < SECONDS * FPS; i++) {
    const t = i / FPS;
    const st = frame(t);
    const keeSvg = st.kee ? kee(st.kee.opts) : "";
    await page.evaluate(([st, keeSvg, screens, n]) => {
      document.getElementById("stage").style.transform = `translateX(${st.shake}px)`;
      for (const s of screens) {
        const el = document.getElementById(s);
        const p = st.phones[s];
        if (!p) { el.style.opacity = 0; continue; }
        el.style.opacity = p.o;
        el.style.width = `${p.w}px`;
        el.style.left = `${p.x - p.w / 2}px`;
        el.style.top = `${p.y}px`;
        el.style.transform = `rotate(${p.r}deg)`;
      }
      for (let i = 0; i < n; i++) {
        const el = document.getElementById(`c${i}`);
        const c = st.crowd[i];
        if (!c || c.k <= 0) { el.style.opacity = 0; continue; }
        el.style.opacity = c.o;
        el.style.transform = `scale(${c.k * c.s})`;
      }
      const ct = document.getElementById("counter");
      if (st.counter) { ct.style.opacity = st.counter.o; ct.style.transform = `scale(${st.counter.s})`; document.getElementById("n").textContent = st.counter.n; } else ct.style.opacity = 0;
      document.getElementById("txt").innerHTML = st.texts;
      document.getElementById("conf").innerHTML = st.confetti || "";
      document.getElementById("flash").style.opacity = st.flash;
      const k = document.getElementById("kee");
      if (st.kee) {
        k.innerHTML = keeSvg;
        k.style.opacity = st.kee.o;
        k.style.left = `${st.kee.x - 200 * st.kee.s}px`;
        k.style.top = `${st.kee.y - 452 * st.kee.s}px`;
        k.style.transform = `scale(${st.kee.s})`;
      } else k.style.opacity = 0;
      const ic = document.getElementById("icon");
      ic.style.opacity = st.icon ? 1 : 0;
      ic.style.transform = `scale(${st.icon})`;
      const cta = document.getElementById("cta");
      cta.style.opacity = st.cta ? 1 : 0;
      cta.style.transform = `scale(${st.cta})`;
      document.getElementById("credit").style.opacity = st.credit;
    }, [st, keeSvg, SCREENS, CROWD.length]);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  await browser.close();

  // Music from its opening, a quick fade in and out over the last 1.5 s.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", MUSIC,
    "-filter_complex", `[1:a]atrim=0:${SECONDS},asetpts=PTS-STARTPTS,afade=t=in:d=0.2,afade=t=out:st=${SECONDS - 1.5}:d=1.5,volume=0.9[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", OUT]);
  fs.unlinkSync(silent);
  console.log(`ad → ${OUT}`);
})();
