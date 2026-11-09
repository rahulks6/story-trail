// Renders Kee, Katkee's mascot: transparent pose PNGs, a character sheet, and 9:16 reel clips.
//
//   node brand/mascot/make.cjs [outDir]        (videos go to outDir, default brand/mascot/videos)
//
// Poses and the sheet are written next to this file; videos are large, so they go to outDir.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const { kee, svg, POSES, C } = require("./kee.cjs");

const HERE = __dirname;
const OUT_VIDEO = process.argv[2] || path.join(HERE, "videos");
const W = 1080;
const H = 1920;
const FPS = 30;

const FONT = "Inter, sans-serif";
// Kee stands high enough that the Reels caption and buttons (bottom ~20%) never cover the feet.
const GROUND = 1500;
const SCALE = 1.75;

// ---------- easing ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const backOut = (t) => {
  t = clamp(t);
  const c1 = 1.9;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
// Scale for a word that pops in at time t0.
const pop = (t, t0, d = 0.35) => (t < t0 ? 0 : backOut((t - t0) / d));

// ---------- scene pieces ----------
function backdrop(kind) {
  if (kind === "amber") {
    return `<defs><radialGradient id="g" cx="50%" cy="38%" r="80%"><stop offset="0" stop-color="#FFD84D"/><stop offset="1" stop-color="#FFB300"/></radialGradient></defs>
            <rect width="${W}" height="${H}" fill="url(#g)"/>`;
  }
  return `<defs><radialGradient id="g" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#1B2433"/><stop offset="1" stop-color="#080C14"/></radialGradient></defs>
          <rect width="${W}" height="${H}" fill="url(#g)"/>
          <circle cx="${W / 2}" cy="1180" r="430" fill="${C.amber}" opacity="0.08"/>`;
}

function placeKee(opts, x, y, s) {
  // (x, y) is where Kee's feet touch the ground; s = scale (1 = 400px wide).
  return `<g transform="translate(${x - 200 * s},${y - 452 * s}) scale(${s})">${kee(opts)}</g>`;
}

function shadow(x, y, s, lift) {
  const k = 1 - clamp(lift / 400) * 0.6;
  return `<ellipse cx="${x}" cy="${y + 8}" rx="${120 * s * k}" ry="${18 * s * k}" fill="#000" opacity="${0.25 * k}"/>`;
}

function text(str, { y, size = 96, color = "#fff", scale = 1, weight = 900, stroke = "" }) {
  if (scale <= 0.001) return "";
  return `<div style="position:absolute;left:0;right:0;top:${y}px;text-align:center;font:${weight} ${size}px/1.05 ${FONT};
            color:${color};letter-spacing:-0.02em;transform:scale(${scale});transform-origin:50% 50%;
            ${stroke ? `-webkit-text-stroke:${stroke};paint-order:stroke fill;` : ""}">${str}</div>`;
}

// Deterministic confetti.
function confetti(t, seed = 7, count = 70) {
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const colors = [C.amber, C.red, "#FFFFFF", "#4FC3F7", C.amberDeep];
  let out = "";
  for (let i = 0; i < count; i++) {
    const x0 = rnd() * W;
    const delay = rnd() * 1.2;
    const speed = 420 + rnd() * 500;
    const sway = 30 + rnd() * 50;
    const spin = rnd() * 720;
    const c = colors[Math.floor(rnd() * colors.length)];
    const tt = t - delay;
    if (tt < 0) continue;
    const y = -60 + tt * speed;
    if (y > H + 40) continue;
    const x = x0 + Math.sin(tt * 4 + i) * sway;
    out += `<rect x="-9" y="-16" width="18" height="32" rx="4" fill="${c}" transform="translate(${x},${y}) rotate(${spin + tt * 360})"/>`;
  }
  return out;
}

// ---------- clips: each returns { bg, svg (scene layer), html (text layer) } for time t ----------
const CLIPS = {
  // "Hi! I'm Kee" — Kee walks in and waves.
  hello: {
    seconds: 5,
    bg: "dark",
    frame(t) {
      const ground = GROUND;
      const walkEnd = 1.3;
      const walking = t < walkEnd;
      const x = walking ? lerp(-260, W / 2, easeOut(t / walkEnd)) : W / 2;
      const step = Math.floor(t / 0.13) % 2 ? "walkA" : "walkB";
      const landing = t >= walkEnd && t < walkEnd + 0.25 ? 1 - 0.08 * Math.sin(((t - walkEnd) / 0.25) * Math.PI) : 1;
      const blink = Math.abs(t - 3.7) < 0.06;
      const opts = walking
        ? { legs: step, armL: step === "walkA" ? 35 : 10, armR: step === "walkA" ? 10 : 35, bob: -Math.abs(Math.sin(t * 24)) * 10, eyes: "open", mouth: "smile", look: [5, 0], t }
        : { eyes: blink ? "closed" : t < 3 ? "happy" : "open", mouth: "grin", armR: 150 + 22 * Math.sin((t - walkEnd) * 13), armL: 22, squash: landing, tilt: 3 * Math.sin(t * 6), glow: 0.5 + 0.5 * Math.sin(t * 5), t };
      return {
        svg: shadow(x, ground, SCALE, 0) + placeKee(opts, x, ground, SCALE),
        html:
          text("Hi! I'm Kee", { y: 300, size: 140, scale: pop(t, 1.45) }) +
          text(`from <span style="color:${C.amber}">Katkee</span>`, { y: 470, size: 84, weight: 800, scale: pop(t, 2.1) }) +
          text("Stories with your people", { y: 640, size: 60, weight: 700, color: "#C9D1DE", scale: pop(t, 3.0) }),
      };
    },
  },

  // Countdown: "3 days until Katkee is live". Rendered for 3, 2 and 1.
  countdown: {
    seconds: 4,
    bg: "amber",
    variants: [3, 2, 1],
    frame(t, n) {
      const ground = GROUND + 20;
      // Drop in, then hop twice.
      let lift = 0;
      let squash = 1;
      if (t < 0.45) lift = lerp(1400, 0, easeOut(t / 0.45) ** 2);
      else {
        const k = ((t - 0.45) % 0.9) / 0.9;
        lift = t > 3.15 ? 0 : Math.sin(k * Math.PI) * 100;
        if (k < 0.1 || k > 0.92) squash = 0.9;
      }
      const air = lift > 20;
      const opts = { eyes: t > 3.2 ? "wink" : "star", mouth: t > 3.2 ? "smirk" : "grin", legs: air ? "jump" : "stand", armL: air ? 160 : 60, armR: air ? 160 : t > 3.2 ? 140 : 60, spark: "bang", squash, glow: 1, t };
      const dark = "#0B0F17";
      return {
        svg: shadow(W / 2, ground, 1.6, lift) + placeKee(opts, W / 2, ground - lift, 1.6),
        html:
          text(String(n), { y: 140, size: 300, color: dark, scale: pop(t, 0.5, 0.45) }) +
          text(n === 1 ? "day until" : "days until", { y: 460, size: 84, color: dark, weight: 800, scale: pop(t, 0.9) }) +
          text("Katkee is live", { y: 555, size: 96, color: dark, scale: pop(t, 1.2) }) +
          text("Follow so you don't miss it", { y: 690, size: 50, color: dark, weight: 700, scale: pop(t, 2.4) }),
      };
    },
  },

  // Launch day: confetti, "It's LIVE!", then Kee points up at "Link in bio".
  live: {
    seconds: 6,
    bg: "dark",
    frame(t) {
      const ground = GROUND;
      const pointing = t > 3.4;
      const k = (t % 0.7) / 0.7;
      const lift = pointing ? 0 : Math.sin(k * Math.PI) * 120;
      const air = lift > 20;
      const opts = pointing
        ? { eyes: "open", mouth: "grin", armR: 178 - 6 * Math.sin(t * 10), armL: 30, look: [3, -7], spark: "star", glow: 1, t }
        : { eyes: "happy", mouth: "grin", legs: air ? "jump" : "stand", armL: air ? 165 : 120, armR: air ? 165 : 120, spark: "star", squash: air ? 1.04 : 0.92, glow: 1, t };
      return {
        svg: confetti(t) + shadow(W / 2, ground, SCALE, lift) + placeKee(opts, W / 2, ground - lift, SCALE),
        html:
          text("It's LIVE!", { y: 200, size: 170, color: C.amber, scale: pop(t, 0.25, 0.45) }) +
          text("Katkee is on Google Play", { y: 410, size: 72, weight: 800, scale: pop(t, 1.0) }) +
          (pointing
            ? text(`Free. <span style="color:${C.amber}">Link in bio</span>`, { y: 530, size: 92, scale: pop(t, 3.45) })
            : text("Stories &middot; Music &middot; Chat &middot; Calls", { y: 540, size: 58, weight: 700, color: "#C9D1DE", scale: pop(t, 1.8) })),
      };
    },
  },

  // Feature teaser: Kee vibing to music, for "Stories with music" reels.
  music: {
    seconds: 5,
    bg: "dark",
    frame(t) {
      const ground = GROUND;
      const beat = Math.sin(t * Math.PI * 2 * 1.6);
      const opts = { eyes: "closed", mouth: "smile", spark: "note", tilt: beat * 10, armL: 120 + beat * 30, armR: 120 - beat * 30, bob: -Math.abs(beat) * 30, legs: beat > 0 ? "walkA" : "walkB", glow: 0.5 + 0.5 * Math.abs(beat), t };
      let notes = "";
      for (let i = 0; i < 6; i++) {
        const tt = (t + i * 0.8) % 4.8;
        const x = 200 + ((i * 173) % 700) + Math.sin(tt * 3 + i) * 30;
        const y = 1250 - tt * 200;
        const o = clamp(1 - tt / 4.8);
        notes += `<text x="${x}" y="${y}" font-size="90" fill="${i % 2 ? C.amber : "#fff"}" opacity="${o}" font-family="DejaVu Sans">&#9835;</text>`;
      }
      return {
        svg: notes + shadow(W / 2, ground, SCALE, 0) + placeKee(opts, W / 2, ground, SCALE),
        html:
          text("Add a song", { y: 300, size: 130, scale: pop(t, 0.3) }) +
          text(`to every <span style="color:${C.amber}">Story</span>`, { y: 460, size: 104, scale: pop(t, 0.8) }) +
          text("Free on Katkee", { y: 640, size: 60, weight: 700, color: "#C9D1DE", scale: pop(t, 2.0) }),
      };
    },
  },

  // The launch film (16 s): wake up → selfie Story → music → chat → finale with the app icon.
  launch: {
    seconds: 16,
    bg: "dark",
    frame(t) {
      const ground = GROUND;
      const dark = "#0B0F17";
      const bgs = {
        dark: `<defs><radialGradient id="ld" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#1B2433"/><stop offset="1" stop-color="#080C14"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#ld)"/>`,
        amber: `<defs><radialGradient id="la" cx="50%" cy="38%" r="80%"><stop offset="0" stop-color="#FFD84D"/><stop offset="1" stop-color="#FFB300"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#la)"/>`,
        navy: `<rect width="${W}" height="${H}" fill="#141B27"/><circle cx="${W / 2}" cy="1150" r="520" fill="${C.red}" opacity="0.07"/>`,
      };
      const scenes = [
        { at: 0, bg: "dark" },
        { at: 3, bg: "amber" },
        { at: 6, bg: "dark" },
        { at: 9, bg: "navy" },
        { at: 12, bg: "dark" },
      ];
      let i = scenes.length - 1;
      while (scenes[i].at > t) i--;
      const s = scenes[i];
      const lt = t - s.at; // time inside this scene
      // Circle wipe: the new scene's colour grows from Kee's spark over the old one.
      let bg = bgs[s.bg];
      if (i > 0 && lt < 0.4) {
        const r = easeOut(lt / 0.4) * 2300;
        bg = `${bgs[scenes[i - 1].bg]}<clipPath id="wipe${i}"><circle cx="${W / 2}" cy="900" r="${r}"/></clipPath><g clip-path="url(#wipe${i})">${bgs[s.bg]}</g>`;
      }

      let scene = "";
      let html = "";
      let opts;
      let lift = 0;
      let k;

      if (i === 0) {
        // Wake up: the spark glows alone, Kee drops in under it and opens its eyes.
        if (t < 0.9) {
          const g = pop(t, 0.15, 0.5);
          scene = `<circle cx="${W / 2}" cy="900" r="${90 * g}" fill="${C.amber}" opacity="0.18"/>
                   <circle cx="${W / 2}" cy="900" r="${42 * g}" fill="${C.amberDeep}" stroke="${dark}" stroke-width="8"/>`;
        } else {
          lift = t < 1.3 ? lerp(1300, 0, easeOut((t - 0.9) / 0.4) ** 2) : 0;
          const squash = t >= 1.3 && t < 1.5 ? 0.88 : 1;
          const awake = t > 1.75;
          opts = { eyes: awake ? (t > 2.3 ? "happy" : "open") : "closed", mouth: awake ? "grin" : "o", armL: awake ? 150 : 20, armR: awake ? 150 : 20, squash, glow: 1, t };
          scene = shadow(W / 2, ground, SCALE, lift) + placeKee(opts, W / 2, ground - lift, SCALE);
        }
        html = text("Big news!", { y: 320, size: 120, scale: pop(t, 1.6) }) +
          text(`<span style="color:${C.amber}">Katkee</span> is here`, { y: 470, size: 110, scale: pop(t, 2.1) });
      } else if (i === 1) {
        // Selfie Story: Kee poses, the camera flashes, Kee winks.
        const flashed = lt > 1.1;
        opts = { eyes: flashed ? "wink" : "open", mouth: flashed ? "smirk" : "grin", phone: "R", armR: 150, armL: 25 + 10 * Math.sin(lt * 6), look: [6, -4], tilt: -4 + 3 * Math.sin(lt * 4), spark: "dot", glow: 0.8, t };
        scene = shadow(W / 2, ground, SCALE, 0) + placeKee(opts, W / 2, ground, SCALE);
        const f = lt > 1.0 && lt < 1.35 ? 1 - (lt - 1.0) / 0.35 : 0;
        if (f > 0) scene += `<rect width="${W}" height="${H}" fill="#fff" opacity="${f * 0.85}"/>`;
        html = text("Snap a Story", { y: 330, size: 130, color: dark, scale: pop(lt, 0.3) }) +
          text("Photos, videos, Boomerang", { y: 500, size: 60, weight: 700, color: dark, scale: pop(lt, 0.8) });
      } else if (i === 2) {
        // Music: Kee dances, notes float up.
        const beat = Math.sin(lt * Math.PI * 2 * 1.6);
        opts = { eyes: "closed", mouth: "smile", spark: "note", tilt: beat * 10, armL: 120 + beat * 30, armR: 120 - beat * 30, bob: -Math.abs(beat) * 30, legs: beat > 0 ? "walkA" : "walkB", glow: 0.5 + 0.5 * Math.abs(beat), t };
        for (let n = 0; n < 6; n++) {
          const tt = (lt + n * 0.6) % 3.6;
          const x = 140 + ((n * 173) % 800) + Math.sin(tt * 3 + n) * 30;
          scene += `<text x="${x}" y="${1300 - tt * 190}" font-size="90" fill="${n % 2 ? C.amber : "#fff"}" opacity="${clamp(1 - tt / 3.6)}" font-family="DejaVu Sans">&#9835;</text>`;
        }
        scene += shadow(W / 2, ground, SCALE, 0) + placeKee(opts, W / 2, ground, SCALE);
        html = text("Add the perfect", { y: 330, size: 110, scale: pop(lt, 0.3) }) +
          text(`<span style="color:${C.amber}">song</span>`, { y: 460, size: 150, scale: pop(lt, 0.7) });
      } else if (i === 3) {
        // Chat: bubbles pop up around Kee, hearts float.
        opts = { eyes: "heart", mouth: "smile", spark: "heart", armL: 60 + 8 * Math.sin(lt * 5), armR: 60 - 8 * Math.sin(lt * 5), bob: -Math.abs(Math.sin(lt * 3)) * 14, glow: 1, t };
        for (let n = 0; n < 5; n++) {
          const tt = (lt + n * 0.55) % 2.8;
          const x = 260 + n * 140 + Math.sin(tt * 4 + n) * 20;
          scene += `<path d="M${x},${1250 - tt * 220 + 14} c-26,-20 -18,-40 0,-28 c18,-12 26,8 0,28z" fill="${C.red}" opacity="${clamp(1 - tt / 2.8)}" transform="scale(1.6) translate(${-x * 0.375},${-(1250 - tt * 220) * 0.375})"/>`;
        }
        scene += shadow(W / 2, ground, SCALE, 0) + placeKee(opts, W / 2, ground, SCALE);
        const bubble = (x, y, w, label, mine, t0) => {
          const sc = pop(lt, t0);
          if (!sc) return "";
          return `<div style="position:absolute;${mine ? `right:${x}px` : `left:${x}px`};top:${y}px;white-space:nowrap;padding:26px 36px;border-radius:44px;${mine ? "border-bottom-right-radius:12px" : "border-bottom-left-radius:12px"};
                    background:${mine ? C.amber : "#E4E8F0"};color:${dark};font:800 50px ${FONT};transform:scale(${sc});transform-origin:${mine ? "100% 100%" : "0 100%"}">${label}</div>`;
        };
        html = text("Chat &amp; video call", { y: 300, size: 100, scale: pop(lt, 0.3) }) +
          text("your people", { y: 420, size: 100, color: C.amber, scale: pop(lt, 0.6) }) +
          bubble(70, 560, 0, "Loved your Story!", false, 1.0) +
          bubble(70, 670, 0, "Video call now?", true, 1.7);
      } else {
        // Finale: confetti, the real app icon, Kee celebrates then points to the bio.
        const pointing = lt > 2.2;
        k = (lt % 0.7) / 0.7;
        lift = pointing ? 0 : Math.sin(k * Math.PI) * 110;
        const air = lift > 20;
        opts = pointing
          ? { eyes: "open", mouth: "grin", armR: 178 - 6 * Math.sin(t * 10), armL: 30, look: [3, -7], spark: "star", glow: 1, t }
          : { eyes: "happy", mouth: "grin", legs: air ? "jump" : "stand", armL: air ? 165 : 120, armR: air ? 165 : 120, spark: "star", squash: air ? 1.04 : 0.92, glow: 1, t };
        scene = confetti(lt) + shadow(W / 2, ground, SCALE, lift) + placeKee(opts, W / 2, ground - lift, SCALE);
        const ic = pop(lt, 0.2, 0.45);
        html = (ic ? `<img src="${ICON}" style="position:absolute;left:${W / 2 - 110}px;top:150px;width:220px;height:220px;border-radius:50px;box-shadow:0 20px 60px rgba(0,0,0,.5);transform:scale(${ic})">` : "") +
          text("Katkee", { y: 400, size: 150, color: C.amber, scale: pop(lt, 0.5) }) +
          (pointing
            ? text(`Free. <span style="color:${C.amber}">Link in bio</span>`, { y: 580, size: 84, scale: pop(lt, 2.25) })
            : text("Now on Google Play", { y: 580, size: 76, weight: 800, scale: pop(lt, 1.0) }));
      }
      return { svg: bg + scene, html };
    },
  },
};

const ICON = `data:image/png;base64,${fs.readFileSync(path.join(HERE, "..", "katkee-app-icon-1024.png")).toString("base64")}`;

// ---------- rendering ----------
async function renderPoses(page) {
  const dir = path.join(HERE, "poses");
  fs.mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 800, height: 1000 });
  for (const [name, opts] of Object.entries(POSES)) {
    await page.setContent(`<body style="margin:0;background:transparent">${svg(kee(opts), { w: 800, h: 1000 })}</body>`);
    await page.screenshot({ path: path.join(dir, `kee-${name}.png`), omitBackground: true });
  }
  console.log(`poses: ${Object.keys(POSES).length} → ${dir}`);
}

async function renderSheet(page) {
  const cell = (name, opts, dark) => `
    <div class="cell ${dark ? "dark" : ""}">${svg(kee(opts), { w: 260, h: 325 })}<div class="lbl">${name}</div></div>`;
  const names = Object.keys(POSES);
  const swatch = (c, n) => `<div class="sw"><span style="background:${c}"></span><b>${n}</b><i>${c}</i></div>`;
  const html = `<!doctype html><html><head><style>
    body{margin:0;width:2400px;background:#080C14;color:#fff;font-family:${FONT};}
    .top{display:flex;gap:80px;padding:80px 100px 40px;align-items:center}
    h1{font-size:150px;margin:0;font-weight:900;letter-spacing:-.03em}
    h1 span{color:${C.amber}}
    .sub{font-size:40px;color:#C9D1DE;margin:16px 0 36px;font-weight:600;max-width:1300px;line-height:1.3}
    .facts{font-size:30px;color:#C9D1DE;line-height:1.6;max-width:1300px}
    .facts b{color:#fff}
    .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:24px;padding:20px 100px 60px}
    .cell{background:#FFF6D6;border-radius:36px;text-align:center;padding:20px 0 26px;color:#0B0F17}
    .cell.dark{background:#141B27;color:#fff}
    .lbl{font-size:30px;font-weight:800}
    .row{display:flex;gap:40px;padding:0 100px 80px;flex-wrap:wrap}
    .sw{display:flex;align-items:center;gap:16px;font-size:28px}
    .sw span{width:64px;height:64px;border-radius:18px;border:4px solid #2A3344}
    .sw i{color:#8E99AB;font-style:normal}
  </style></head><body>
    <div class="top">
      ${svg(kee(POSES.hello), { w: 560, h: 700 })}
      <div>
        <h1>Meet <span>Kee</span></h1>
        <div class="sub">Katkee's mascot: the app icon come to life. The light card is Kee's body, the dark screen is the face, and the amber dot from the logo floats above as Kee's spark.</div>
        <div class="facts">
          <b>Personality:</b> cheerful, curious, a little dramatic. Loves Stories, music and friends.<br>
          <b>The spark</b> shows Kee's mood: amber dot (normal), heart (love), music note (vibing), star (excited), "!" (surprised).<br>
          <b>Always:</b> amber sneakers, dark outline, eyes on the screen. <b>Never:</b> change the colours, stretch the body, or put Kee next to another app's logo.
        </div>
      </div>
    </div>
    <div class="grid">${names.map((n, i) => cell(n, POSES[n], i % 2 === 0)).join("")}</div>
    <div class="row">${swatch(C.card, "Body")}${swatch(C.screen, "Face / outline")}${swatch(C.amber, "Amber")}${swatch(C.amberDeep, "Spark")}${swatch(C.red, "Heart")}</div>
  </body></html>`;
  await page.setViewportSize({ width: 2400, height: 1200 });
  await page.setContent(html);
  const out = path.join(HERE, "kee-character-sheet.png");
  await page.screenshot({ path: out, fullPage: true });
  console.log(`sheet → ${out}`);
}

async function renderClip(page, name, clip, variant) {
  fs.mkdirSync(OUT_VIDEO, { recursive: true });
  const file = path.join(OUT_VIDEO, `kee-${name}${variant !== undefined ? `-${variant}` : ""}.mp4`);
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative">
    <svg id="s" width="${W}" height="${H}" style="position:absolute;inset:0">${backdrop(clip.bg)}<g id="layer"></g></svg>
    <div id="txt" style="position:absolute;inset:0"></div></body></html>`);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", file]);
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  const frames = clip.seconds * FPS;
  for (let i = 0; i < frames; i++) {
    const f = clip.frame(i / FPS, variant);
    await page.evaluate(([s, h]) => {
      document.getElementById("layer").innerHTML = s;
      document.getElementById("txt").innerHTML = h;
    }, [f.svg, f.html]);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  console.log(`video → ${file}`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const only = process.env.ONLY; // e.g. ONLY=live to render one clip
  if (!only) {
    await renderPoses(page);
    await renderSheet(page);
  }
  for (const [name, clip] of Object.entries(CLIPS)) {
    if (only && only !== name) continue;
    for (const v of clip.variants || [undefined]) await renderClip(page, name, clip, v);
  }
  await browser.close();
})();
