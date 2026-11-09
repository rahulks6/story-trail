// Google Play promo video (YouTube): 30 s, 1920x1080, Kee + real app screens + licensed music.
//
//   node brand/promo/make-promo.cjs <music.mp3> [out.mp4]
//
// Music: "Carefree" by Kevin MacLeod (incompetech.com), CC BY 4.0 — the same track the app's
// music catalogue ships (backend/migrations/music/catalogue.json). Credit it in the YouTube
// description; the end card also shows the credit.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");
const { kee, C } = require("../mascot/kee.cjs");

const MUSIC = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, "katkee-promo.mp4");
if (!MUSIC) throw new Error("Pass the music file: node brand/promo/make-promo.cjs <music.mp3> [out.mp4]");

const W = 1920;
const H = 1080;
const FPS = 30;
const SECONDS = 30;
const RAW = path.join(__dirname, "..", "store", "screenshots", "raw");
const ICON = path.join(__dirname, "..", "katkee-app-icon-1024.png");
const data = (f) => `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeIn = (t) => Math.pow(clamp(t), 3);
const backOut = (t) => { t = clamp(t); const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const pop = (t, t0, d = 0.35) => (t < t0 ? 0 : backOut((t - t0) / d));

const SCREENS = ["phone-home", "phone-editor", "phone-home-music", "phone-layout", "phone-chat", "phone-group", "phone-profile"];

// Feature scenes: [start, end, title, subtitle, phones [{screen, x, rot}], Kee pose]
const FEATURES = [
  [4.5, 10, "Share your day<br>in <em>Stories</em>", "Photos, videos and Boomerang", [{ s: "phone-home", x: 1380, r: 0 }], { eyes: "open", mouth: "grin", phone: "R", armR: 150, look: [6, -4] }],
  [10, 15.5, "Add <em>music</em>, text<br>&amp; stickers", "Pick a song and the best part of it", [{ s: "phone-home-music", x: 1200, r: -6 }, { s: "phone-editor", x: 1580, r: 5 }], { eyes: "closed", mouth: "smile", spark: "note", armL: 130, armR: 70, tilt: -6 }],
  [15.5, 21, "Six photos,<br><em>one Story</em>", "Katkee lays them out for you", [{ s: "phone-layout", x: 1380, r: 0 }], { eyes: "star", mouth: "grin", spark: "star", armL: 150, armR: 150, legs: "jump" }],
  [21, 26, "Chat &amp; video call<br><em>your people</em>", "Groups, voice notes, reactions and calls", [{ s: "phone-chat", x: 1200, r: -5 }, { s: "phone-group", x: 1580, r: 5 }], { eyes: "heart", mouth: "smile", spark: "heart", armL: 60, armR: 60 }],
];

function confetti(t) {
  let r = 11;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const cols = [C.amber, C.red, "#FFFFFF", "#4FC3F7", C.amberDeep];
  let out = "";
  for (let i = 0; i < 90; i++) {
    const x0 = rnd() * W, delay = rnd() * 1.5, speed = 300 + rnd() * 380, sway = 20 + rnd() * 40, spin = rnd() * 720;
    const c = cols[Math.floor(rnd() * cols.length)];
    const tt = t - delay;
    if (tt < 0) continue;
    const y = -40 + tt * speed;
    if (y > H + 40) continue;
    out += `<rect x="-7" y="-13" width="14" height="26" rx="3" fill="${c}" transform="translate(${x0 + Math.sin(tt * 4 + i) * sway},${y}) rotate(${spin + tt * 360})"/>`;
  }
  return out;
}

// Everything a frame needs: which phones show where, Kee, texts, confetti.
function frame(t) {
  const st = { phones: {}, kee: null, texts: "", confetti: "", icon: null, credit: 0 };

  if (t < 4.5) {
    // Intro: Kee drops in under the spark and waves; "Meet Katkee".
    const fade = 1 - easeIn((t - 4.0) / 0.5);
    const lift = t < 0.9 ? (1 - easeOut((t - 0.3) / 0.6) ** 2) * 900 : 0;
    const awake = t > 1.2;
    st.kee = {
      x: W / 2, y: 1000 - (t < 0.3 ? 2000 : lift), s: 1.25, o: fade,
      opts: awake ? { eyes: t > 2.6 && t < 2.75 ? "closed" : "happy", mouth: "grin", armR: 150 + 22 * Math.sin(t * 12), glow: 1, t } : { eyes: "closed", mouth: "o", glow: 1, t },
    };
    st.texts = txt("Meet <b style='color:#FFC800'>Katkee</b>", 110, 150, pop(t, 1.3), fade, "center") +
      txt("Stories with your people", 300, 50, pop(t, 1.9), fade, "center", 600, "#C9D1DE");
    return st;
  }

  for (const [a, b, title, sub, phones, pose] of FEATURES) {
    if (t < a || t >= b) continue;
    const lt = t - a;
    const out = easeIn((t - (b - 0.45)) / 0.45); // leave over the last 0.45 s
    const o = 1 - out;
    phones.forEach((p, i) => {
      const inT = easeOut((lt - i * 0.15) / 0.6);
      st.phones[p.s] = { x: p.x, y: 1080 - inT * 990 - out * 60 + Math.sin(lt * 1.5 + i) * 6, r: p.r + (1 - inT) * 8, o: Math.min(inT, o) };
    });
    const kIn = easeOut(lt / 0.5);
    const hop = pose.legs === "jump" ? Math.abs(Math.sin(lt * 4.5)) * 40 : 0;
    st.kee = { x: 330, y: 1040 - hop, s: 0.82, o: Math.min(kIn, o), opts: { ...pose, bob: -Math.abs(Math.sin(lt * 3)) * 8, glow: 0.8, t } };
    st.texts = txt(title, 190, 96, pop(lt, 0.2, 0.4), o) + txt(sub, 420, 40, pop(lt, 0.55), o, "left", 600, "#C9D1DE");
    return st;
  }

  // Finale: icon, "Katkee", "Free on Google Play", Kee celebrates, confetti.
  const lt = t - 26;
  const k = (lt % 0.7) / 0.7;
  const lift = lt > 3.0 ? 0 : Math.sin(k * Math.PI) * 70;
  st.kee = { x: 330, y: 1000 - lift, s: 1.05, o: easeOut(lt / 0.4),
    opts: lift > 15 ? { eyes: "happy", mouth: "grin", armL: 165, armR: 165, legs: "jump", spark: "star", glow: 1, t } : { eyes: "happy", mouth: "grin", armL: 140, armR: 140, spark: "star", glow: 1, t } };
  st.phones["phone-profile"] = { x: 1590, y: 1080 - easeOut(lt / 0.6) * 990, r: 4, o: easeOut(lt / 0.6) };
  st.icon = pop(lt, 0.15, 0.45);
  st.texts = txt("<b style='color:#FFC800'>Katkee</b>", 400, 140, pop(lt, 0.45), 1, "center") +
    txt("Free on Google Play", 580, 58, pop(lt, 0.9), 1, "center", 800) +
    txt("iPhone coming soon", 670, 36, pop(lt, 1.4), 1, "center", 600, "#C9D1DE");
  st.confetti = confetti(lt);
  st.credit = clamp((lt - 0.5) / 0.5);
  return st;
}

function txt(html, top, size, scale, opacity, align = "left", weight = 900, color = "#fff") {
  if (scale <= 0.001 || opacity <= 0.001) return "";
  const pos = align === "center" ? "left:0;right:0;text-align:center;transform-origin:50% 50%" : "left:140px;width:860px;transform-origin:0 50%";
  return `<div style="position:absolute;top:${top}px;${pos};font:${weight} ${size}px/1.05 Inter,sans-serif;letter-spacing:-0.025em;color:${color};opacity:${opacity};transform:scale(${scale})">${html}</div>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const phonesHtml = SCREENS.map((s) => `
    <div id="${s}" class="phone"><div class="scr"><img src="${data(path.join(RAW, `${s}.png`))}"></div></div>`).join("");
  await page.setContent(`<!doctype html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:Inter,sans-serif;
      background:radial-gradient(ellipse 60% 70% at 75% 60%,rgba(255,200,0,.16),transparent 70%),
                 radial-gradient(ellipse 50% 50% at 0% 0%,rgba(255,61,110,.12),transparent 70%),#080C14}
    em{font-style:normal;background:linear-gradient(90deg,#FFC800,#FF8A00 60%,#FF3D6E);-webkit-background-clip:text;background-clip:text;color:transparent}
    .phone{position:absolute;width:420px;height:916px;margin-left:-210px;border-radius:62px;padding:13px;opacity:0;
      background:linear-gradient(160deg,#2a2d34,#121418);box-shadow:0 40px 100px rgba(0,0,0,.7),inset 0 0 0 2px rgba(255,255,255,.09)}
    .scr{width:100%;height:100%;border-radius:50px;overflow:hidden;background:#000}
    .scr img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
    #kee{position:absolute;width:400px;height:500px;transform-origin:0 0}
    #icon{position:absolute;left:${W / 2 - 100}px;top:170px;width:200px;height:200px;border-radius:46px;box-shadow:0 20px 60px rgba(0,0,0,.6);opacity:0}
    #credit{position:absolute;left:0;right:0;bottom:28px;text-align:center;font:500 22px Inter;color:#8E99AB;opacity:0}
  </style></head><body>
    <svg id="conf" width="${W}" height="${H}" style="position:absolute;inset:0"></svg>
    ${phonesHtml}
    <svg id="kee" viewBox="0 0 400 500"></svg>
    <img id="icon" src="${data(ICON)}">
    <div id="txt" style="position:absolute;inset:0"></div>
    <div id="credit">Music: “Carefree” by Kevin MacLeod (incompetech.com), CC BY 4.0</div>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);

  const silent = OUT.replace(/\.mp4$/, ".silent.mp4");
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", silent]);
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));

  for (let i = 0; i < SECONDS * FPS; i++) {
    const t = i / FPS;
    const st = frame(t);
    const keeSvg = st.kee ? kee(st.kee.opts) : "";
    await page.evaluate(([st, keeSvg, screens]) => {
      for (const s of screens) {
        const el = document.getElementById(s);
        const p = st.phones[s];
        if (!p) { el.style.opacity = 0; continue; }
        el.style.opacity = p.o;
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        el.style.transform = `rotate(${p.r}deg)`;
      }
      const k = document.getElementById("kee");
      if (st.kee) {
        k.innerHTML = keeSvg;
        k.style.opacity = st.kee.o;
        k.style.left = `${st.kee.x - 200 * st.kee.s}px`;
        k.style.top = `${st.kee.y - 452 * st.kee.s}px`;
        k.style.transform = `scale(${st.kee.s})`;
      } else k.style.opacity = 0;
      document.getElementById("txt").innerHTML = st.texts;
      document.getElementById("conf").innerHTML = st.confetti;
      const ic = document.getElementById("icon");
      ic.style.opacity = st.icon ? 1 : 0;
      ic.style.transform = `scale(${st.icon || 0})`;
      document.getElementById("credit").style.opacity = st.credit;
    }, [st, keeSvg, SCREENS]);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  await browser.close();

  // Music: the first 30 s of the track, faded in briefly and out over the last 2.5 s.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", MUSIC,
    "-filter_complex", `[1:a]atrim=0:${SECONDS},asetpts=PTS-STARTPTS,afade=t=in:d=0.4,afade=t=out:st=${SECONDS - 2.5}:d=2.5,volume=0.9[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", OUT]);
  fs.unlinkSync(silent);
  console.log(`promo → ${OUT}`);
})();
