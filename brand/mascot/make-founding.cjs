// The Founding member reel (20 s, 1080x1920, music + sound effects), for Instagram and WhatsApp.
//
//   node brand/mascot/make-founding.cjs <music.mp3> [out.mp4]
//
// Music: "Special Spotlight" by Kevin MacLeod (incompetech.com), CC BY 4.0, the same licence as the
// app's music catalogue: credit it in the post's caption. Sound effects are synthesised by ffmpeg.
// Scenes: only 1,000 people → the badge → on your profile → numbers in sign-up order → claim yours.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");
const { kee, C } = require("./kee.cjs");

const MUSIC = process.argv[2];
if (!MUSIC) throw new Error("Pass the music file: node brand/mascot/make-founding.cjs <music.mp3> [out.mp4]");
const OUT = process.argv[3] || path.join(process.cwd(), "katkee-founding-member-reel.mp4");
const W = 1080;
const H = 1920;
const FPS = 30;
const SECONDS = 20;
const FONT = "Inter, sans-serif";
const GROUND = 1500; // Kee's feet stay above the Reels caption and buttons
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, "..", "katkee-app-icon-1024.png")).toString("base64")}`;
// The app's own star icon (Lucide), as the badge draws it.
const STAR = "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

// ---------- easing ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t) => (t = clamp(t), t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const backOut = (t) => {
  t = clamp(t);
  const c1 = 1.9;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const pop = (t, t0, d = 0.35) => (t < t0 ? 0 : backOut((t - t0) / d));

// ---------- pieces ----------
const placeKee = (opts, x, y, s) => `<g transform="translate(${x - 200 * s},${y - 452 * s}) scale(${s})">${kee(opts)}</g>`;
const shadow = (x, y, s, lift = 0) => {
  const k = 1 - clamp(lift / 400) * 0.6;
  return `<ellipse cx="${x}" cy="${y + 8}" rx="${120 * s * k}" ry="${18 * s * k}" fill="#000" opacity="${0.3 * k}"/>`;
};
function text(str, { y, size = 96, color = "#fff", scale = 1, weight = 900, opacity = 1 }) {
  if (scale <= 0.001 || opacity <= 0.001) return "";
  return `<div style="position:absolute;left:40px;right:40px;top:${y}px;text-align:center;font:${weight} ${size}px/1.08 ${FONT};
            color:${color};letter-spacing:-0.02em;white-space:nowrap;opacity:${opacity};transform:scale(${scale});transform-origin:50% 50%">${str}</div>`;
}
const amber = (s) => `<span style="color:${C.amber}">${s}</span>`;

/** The badge exactly as the app draws it (ProfileHeader.tsx), at `k` times its size. */
function badge(number, k, shine = -1) {
  const sweep = shine >= 0 && shine <= 1
    ? `<div style="position:absolute;top:-20%;bottom:-20%;width:30%;left:${lerp(-40, 120, shine)}%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg)"></div>`
    : "";
  return `<div style="position:relative;overflow:hidden;display:inline-flex;align-items:center;gap:${4 * k}px;padding:${3 * k}px ${9 * k}px;border-radius:999px;
            border:${Math.max(1, 0.8 * k)}px solid ${C.amber};color:${C.amber};font:700 ${12 * k}px/1.2 ${FONT};white-space:nowrap;background:rgba(255,200,0,.06)">
            <svg width="${12 * k}" height="${12 * k}" viewBox="0 0 24 24"><path d="${STAR}" fill="${C.amber}" stroke="${C.amber}" stroke-width="2" stroke-linejoin="round"/></svg>
            Founding member #${number}${sweep}</div>`;
}

function centered(html, y, scale = 1, opacity = 1) {
  if (scale <= 0.001) return "";
  return `<div style="position:absolute;left:0;right:0;top:${y}px;display:flex;justify-content:center;opacity:${opacity};transform:scale(${scale});transform-origin:50% 50%">${html}</div>`;
}

/** A profile like the app's (a placeholder person, no real user), with the badge popping in. */
function profileCard(y, badgeScale, shine) {
  const k = 2.6; // the phone's points → video pixels
  const person = `<svg width="${86 * k}" height="${86 * k}" viewBox="0 0 24 24" style="border-radius:50%;background:#3A3F4A;flex:none">
      <circle cx="12" cy="9.4" r="4.3" fill="#8C929E"/><path d="M3.6 24.5c0-5.2 3.8-9.1 8.4-9.1s8.4 3.9 8.4 9.1z" fill="#8C929E"/></svg>`;
  const stat = (n, l) => `<div style="text-align:center"><div style="font:700 ${17 * k}px ${FONT}">${n}</div><div style="font:400 ${13 * k}px ${FONT};color:#C9D1DE">${l}</div></div>`;
  return `<div style="position:absolute;left:${(W - 980) / 2}px;top:${y}px;width:980px;box-sizing:border-box;padding:46px 40px 50px;border-radius:56px;
              background:#0B0B0B;border:3px solid #232833;box-shadow:0 40px 120px rgba(0,0,0,.6);color:#fff">
      <div style="text-align:center;font:700 ${17 * k}px ${FONT};margin-bottom:34px">you</div>
      <div style="display:flex;align-items:center;gap:40px">${person}
        <div style="display:flex;flex:1;justify-content:space-around">${stat(12, "Stories")}${stat(148, "Followers")}${stat(96, "Following")}</div></div>
      <div style="margin-top:28px;font:700 ${16 * k}px ${FONT}">Your name</div>
      <div style="height:${30 * k}px;margin-top:12px">${badgeScale > 0.001 ? `<div style="display:inline-block;transform:scale(${badgeScale});transform-origin:0 50%">${badge(27, k, shine)}</div>` : ""}</div>
      <div style="margin-top:12px;font:400 ${14 * k}px ${FONT};color:#E4E8F0">Stories with my people ✨</div>
    </div>`;
}

function confetti(t, seed = 11, count = 80) {
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const colors = [C.amber, C.red, "#FFFFFF", "#4FC3F7", C.amberDeep];
  let out = "";
  for (let i = 0; i < count; i++) {
    const x0 = rnd() * W, delay = rnd() * 1.4, speed = 420 + rnd() * 520, sway = 30 + rnd() * 50, spin = rnd() * 720;
    const c = colors[Math.floor(rnd() * colors.length)];
    const tt = t - delay;
    if (tt < 0) continue;
    const y = -60 + tt * speed;
    if (y > H + 40) continue;
    out += `<rect x="-9" y="-16" width="18" height="32" rx="4" fill="${c}" transform="translate(${x0 + Math.sin(tt * 4 + i) * sway},${y}) rotate(${spin + tt * 360})"/>`;
  }
  return out;
}

/** Soft sparkles around a point, for the badge's moments. */
function sparkles(t, cx, cy, spread) {
  let out = "";
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + t * 0.6;
    const p = (t * 1.3 + i * 0.37) % 1;
    const d = spread * (0.7 + 0.4 * Math.sin(i * 3.1));
    const s = Math.sin(p * Math.PI) * 18;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.55;
    out += `<path d="M${x},${y - s} L${x + s * 0.3},${y - s * 0.3} L${x + s},${y} L${x + s * 0.3},${y + s * 0.3} L${x},${y + s} L${x - s * 0.3},${y + s * 0.3} L${x - s},${y} L${x - s * 0.3},${y - s * 0.3}Z" fill="${i % 3 ? C.amber : "#fff"}" opacity="${0.9 * Math.sin(p * Math.PI)}"/>`;
  }
  return out;
}

// ---------- the reel ----------
const SCENES = [0, 3.6, 8.0, 12.5, 16.2, SECONDS];
function frame(t) {
  const i = SCENES.findIndex((s, n) => t >= s && t < SCENES[n + 1]);
  const lt = t - SCENES[i];
  const out = SCENES[i + 1] - t; // seconds left in this scene
  const fade = clamp(out / 0.25); // every scene's text fades out over its last quarter second
  let svg = "";
  let html = "";

  if (i === 0) {
    // Kee drops in, surprised: only 1,000 people will ever get this.
    const lift = lt < 0.65 ? lerp(1400, 0, easeOut(lt / 0.65) ** 2) : 0;
    const squash = lt >= 0.65 && lt < 0.85 ? 0.86 : 1;
    const opts = { eyes: lt > 0.9 ? "wide" : "closed", mouth: "o", spark: "bang", armL: 150, armR: 150, squash, look: [0, -5], glow: 1, t };
    svg = shadow(W / 2, GROUND, 1.75, lift) + placeKee(opts, W / 2, GROUND - lift, 1.75);
    html = text("Psst… only", { y: 300, size: 92, weight: 800, scale: pop(lt, 1.0), opacity: fade }) +
      text(amber("1,000 people"), { y: 420, size: 150, scale: pop(lt, 1.4), opacity: fade }) +
      text("will ever get this", { y: 600, size: 84, weight: 800, scale: pop(lt, 2.1), opacity: fade });
  } else if (i === 1) {
    // The badge stamps in, shines; Kee is starstruck.
    const stamp = lt < 0.3 ? 0 : lt < 0.55 ? lerp(2.4, 1, easeOut((lt - 0.3) / 0.25)) : 1;
    const opts = { eyes: "star", mouth: "grin", spark: "star", armL: 150 + 8 * Math.sin(lt * 9), armR: 150 - 8 * Math.sin(lt * 9), bob: -Math.abs(Math.sin(lt * 5)) * 16, glow: 1, t };
    svg = sparkles(lt, W / 2, 740, 430 * clamp((lt - 0.5) * 2)) + shadow(W / 2, 1600, 1.2) + placeKee(opts, W / 2, 1600, 1.2);
    html = text("Introducing the", { y: 290, size: 80, weight: 800, scale: pop(lt, 0.9), opacity: fade }) +
      text(amber("Founding member"), { y: 385, size: 108, scale: pop(lt, 1.1), opacity: fade }) +
      text("badge", { y: 500, size: 108, scale: pop(lt, 1.3), opacity: fade }) +
      centered(badge(1, 5.2, (lt - 0.8) / 0.7), 690, stamp, fade) +
      text("for Katkee's first 1,000 people", { y: 900, size: 58, weight: 700, color: "#C9D1DE", scale: pop(lt, 2.0), opacity: fade });
  } else if (i === 2) {
    // On your profile, for everyone to see: the card rises, the badge pops in, Kee points at it.
    const y = lerp(H, 500, easeOut(lt / 0.6));
    const opts = { eyes: "happy", mouth: "grin", spark: "star", armR: 165 - 5 * Math.sin(t * 10), armL: 30, look: [-4, -7], tilt: -5, glow: 1, t };
    svg = shadow(W - 200, 1640, 1.0) + placeKee(opts, W - 200, 1640, 1.0);
    html = text("Right on your profile", { y: 250, size: 86, scale: pop(lt, 0.3), opacity: fade }) +
      text(amber("for everyone to see"), { y: 360, size: 86, scale: pop(lt, 0.6), opacity: fade }) +
      `<div style="opacity:${fade}">${profileCard(y, pop(lt, 1.0, 0.4), (lt - 1.5) / 0.7)}</div>`;
    if (lt > 1.0) svg += sparkles(lt, 330, y + 790, 230);
  } else if (i === 3) {
    // Numbers go in sign-up order: a counter runs from #1 to #1000.
    const n = Math.max(1, Math.round(lerp(1, 1000, easeInOut((lt - 0.4) / 2.2))));
    const done = lt > 2.6;
    const opts = { eyes: done ? "wink" : "open", mouth: done ? "smirk" : "smile", spark: done ? "star" : "dot", armL: done ? 40 : 25, armR: done ? 160 : 25, look: [0, -6], bob: -Math.abs(Math.sin(lt * 6)) * 10, glow: 0.8, t };
    svg = shadow(W / 2, 1600, 1.3) + placeKee(opts, W / 2, 1600, 1.3);
    html = text("Numbers go in", { y: 290, size: 92, scale: pop(lt, 0.1), opacity: fade }) +
      text(amber("sign-up order"), { y: 400, size: 110, scale: pop(lt, 0.3), opacity: fade }) +
      text(`#${n.toLocaleString("en-IN")}`, { y: 610, size: 230, color: done ? C.amber : "#fff", scale: pop(lt, 0.4) * (done ? 1 + 0.06 * Math.sin((lt - 2.6) * 12) * clamp(1 - (lt - 2.6) * 2) : 1), opacity: fade }) +
      text("Join early. Get a lower number.", { y: 880, size: 62, weight: 800, color: "#C9D1DE", scale: pop(lt, 2.7), opacity: fade });
  } else {
    // Finale: confetti, the app icon, claim yours.
    const pointing = lt > 2.0;
    const k = (lt % 0.7) / 0.7;
    const lift = pointing ? 0 : Math.sin(k * Math.PI) * 100;
    const air = lift > 20;
    const opts = pointing
      ? { eyes: "open", mouth: "grin", armR: 178 - 6 * Math.sin(t * 10), armL: 30, look: [3, -7], spark: "star", glow: 1, t }
      : { eyes: "happy", mouth: "grin", legs: air ? "jump" : "stand", armL: air ? 165 : 120, armR: air ? 165 : 120, spark: "star", squash: air ? 1.04 : 0.92, glow: 1, t };
    svg = confetti(lt) + shadow(W / 2, 1600, 1.35, lift) + placeKee(opts, W / 2, 1600 - lift, 1.35);
    const ic = pop(lt, 0.2, 0.45);
    html = (ic ? `<img src="${ICON}" style="position:absolute;left:${W / 2 - 100}px;top:230px;width:200px;height:200px;border-radius:46px;box-shadow:0 20px 60px rgba(0,0,0,.5);transform:scale(${ic})">` : "") +
      text("Claim your number", { y: 470, size: 104, scale: pop(lt, 0.5) }) +
      centered(badge("?", 4.2, (lt - 1.2) / 0.7), 620, pop(lt, 0.9)) +
      text(`Free on Google Play · ${amber("Link in bio")}`, { y: 790, size: 56, weight: 800, scale: pop(lt, 1.6) }) +
      `<div style="position:absolute;left:0;right:0;bottom:36px;text-align:center;font:500 22px ${FONT};color:rgba(255,255,255,.45)">Music: "Special Spotlight" by Kevin MacLeod (incompetech.com), CC BY 4.0</div>`;
  }
  return { svg, html };
}

// ---------- sound: music + synthesised effects ----------
const WHOOSH = [0.1, 3.5, 7.9, 12.4, 16.1];
const DING = [3.95, 9.05, 15.15, 16.4];
const POP = [1.05, 1.45, 2.15, 4.75, 8.35, 8.65, 12.65, 12.85, 16.75, 17.85];

function sound(file) {
  const fx = [];
  const ms = (s) => Math.round(s * 1000);
  // A whoosh: pink noise swept through a band-pass, quick in and out.
  for (const s of WHOOSH) fx.push(`anoisesrc=d=0.45:c=pink:a=0.6,bandpass=f=1800:w=1400,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.25,volume=0.55,adelay=${ms(s)}|${ms(s)}`);
  // A ding: two bell partials with a long tail.
  for (const s of DING) fx.push(`sine=f=1568:d=1.1,volume=0.35,afade=t=out:st=0.02:d=1.05:curve=exp[a${fx.length}];sine=f=2349:d=0.8,volume=0.15,afade=t=out:st=0.02:d=0.75:curve=exp[b${fx.length}];[a${fx.length}][b${fx.length}]amix=inputs=2:normalize=0,adelay=${ms(s)}|${ms(s)}`);
  // A pop: a short falling tone for each word that lands.
  for (const s of POP) fx.push(`sine=f=520:d=0.09,volume=0.35,afade=t=out:st=0:d=0.09,adelay=${ms(s)}|${ms(s)}`);
  const graph = [
    `[0:a]atrim=0:${SECONDS},asetpts=PTS-STARTPTS,volume=0.6,afade=t=in:d=0.3,afade=t=out:st=${SECONDS - 1.6}:d=1.6[m]`,
    ...fx.map((f, n) => `${f},aformat=sample_rates=44100:channel_layouts=stereo[f${n}]`),
    `[m]${fx.map((_, n) => `[f${n}]`).join("")}amix=inputs=${fx.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[out]`,
  ].join(";");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", MUSIC, "-filter_complex", graph, "-map", "[out]", "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-t", String(SECONDS), file]);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-founding-"));
  const video = path.join(tmp, "video.mp4");
  const audio = path.join(tmp, "audio.m4a");
  if (!process.env.PREVIEW) sound(audio);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative">
    <svg width="${W}" height="${H}" style="position:absolute;inset:0">
      <defs><radialGradient id="g" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#1B2433"/><stop offset="1" stop-color="#080C14"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="${W / 2}" cy="1000" r="460" fill="${C.amber}" opacity="0.07"/><g id="layer"></g></svg>
    <div id="txt" style="position:absolute;inset:0"></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  // PREVIEW=2.5,5,10 writes those moments as PNGs next to the output instead of the video.
  if (process.env.PREVIEW) {
    for (const s of process.env.PREVIEW.split(",").map(Number)) {
      const f = frame(s);
      await page.evaluate(([a, b]) => {
        document.getElementById("layer").innerHTML = a;
        document.getElementById("txt").innerHTML = b;
      }, [f.svg, f.html]);
      await page.screenshot({ path: OUT.replace(/\.mp4$/, `-${s}s.png`) });
    }
    await browser.close();
    return;
  }
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "19", video]);
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  for (let n = 0; n < SECONDS * FPS; n++) {
    const f = frame(n / FPS);
    await page.evaluate(([s, h]) => {
      document.getElementById("layer").innerHTML = s;
      document.getElementById("txt").innerHTML = h;
    }, [f.svg, f.html]);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  await browser.close();

  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-i", audio, "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", OUT]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`reel → ${OUT}`);
})();
