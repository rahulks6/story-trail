// Katkee's own moving stickers: transparent, looping animated WebP (320x320, 2-second loop at 12 frames a second),
// for the GIF tab of the sticker sheet. Indian first: birthdays, festivals, greetings in Hindi and
// Marathi, chai, cricket.
//
//   node brand/stickers/make-stickers.cjs [outDir]     (default backend/assets/stickers)
//
// Writes <id>.webp for every sticker and manifest.json (id, category, search words), which the
// server reads to serve and check them. Emoji are Noto Color Emoji (Apache 2.0); the lettering is
// Baloo 2 and Pacifico (SIL OFL, fonts/). Each frame is drawn by Chromium with the animations
// paused at that moment, so the loop is exact.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const OUT = process.argv[2] || path.join(__dirname, "..", "..", "backend", "assets", "stickers");
const SIZE = 320;
const FPS = 12;
const LOOP_S = 2;
const FRAMES = FPS * LOOP_S;
const font = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, "fonts", f)).toString("base64")}`;

// Categories, in the order the sheet shows them.
const CATEGORIES = ["birthday", "festivals", "love", "reactions", "greetings", "food", "travel", "cricket"];

// Emoji go in `emoji` or `emojiBadge`, never inside `text` (the lettering's gradient would hide them).
// anim: bounce | wiggle | pulse | float | shake | flicker | pop | wave | swing | spin
// deco: sparkles | confetti | hearts | steam | glow | rays | notes
const S = [
  // Birthday
  { id: "happy-birthday", cat: "birthday", tags: "happy birthday bday", text: "Happy|Birthday", fill: ["#FF4FA0", "#FF9A3D"], anim: "wave", deco: "confetti" },
  { id: "cake", cat: "birthday", tags: "cake birthday", emoji: "🎂", anim: "bounce", deco: "sparkles" },
  { id: "balloons", cat: "birthday", tags: "balloons party birthday", emoji: "🎈", anim: "float", deco: "confetti" },
  { id: "party-popper", cat: "birthday", tags: "party celebrate congrats", emoji: "🎉", anim: "wiggle", deco: "confetti" },
  { id: "gift", cat: "birthday", tags: "gift present surprise", emoji: "🎁", anim: "shake", deco: "sparkles" },
  { id: "party-face", cat: "birthday", tags: "party yay celebrate", emoji: "🥳", anim: "bounce", deco: "confetti" },
  { id: "janamdin-mubarak", cat: "birthday", tags: "birthday hindi janamdin mubarak जन्मदिन", text: "जन्मदिन|मुबारक", fill: ["#FF4FA0", "#B44DFF"], anim: "pop", deco: "confetti" },
  { id: "vadhdivas", cat: "birthday", tags: "birthday marathi vadhdivas वाढदिवस shubhechha", text: "वाढदिवसाच्या|हार्दिक शुभेच्छा", fill: ["#FF7A1A", "#FF2E63"], anim: "pop", deco: "sparkles", small: true },
  { id: "congrats", cat: "birthday", tags: "congrats congratulations badhai", text: "Congrats!", fill: ["#7B5CFF", "#22C1F0"], anim: "pop", deco: "confetti" },

  // Festivals
  { id: "happy-diwali", cat: "festivals", tags: "diwali deepavali festival lights", text: "Happy|Diwali", fill: ["#FFB300", "#FF5E00"], anim: "pop", deco: "glow", emojiBadge: "🪔" },
  { id: "shubh-deepavali", cat: "festivals", tags: "diwali deepavali hindi marathi शुभ दीपावली", text: "शुभ|दीपावली", fill: ["#FFC400", "#FF6A00"], anim: "pop", deco: "sparkles", emojiBadge: "🪔" },
  { id: "diya", cat: "festivals", tags: "diya lamp diwali", emoji: "🪔", anim: "flicker", deco: "glow" },
  { id: "fireworks", cat: "festivals", tags: "fireworks diwali new year celebrate", emoji: "🎆", anim: "pulse", deco: "sparkles" },
  { id: "happy-holi", cat: "festivals", tags: "holi colours festival rang", text: "Happy|Holi", fill: ["#FF2E93", "#00C2FF", "#FFD000"], anim: "wave", deco: "confetti" },
  { id: "ganpati-bappa", cat: "festivals", tags: "ganpati ganesh bappa morya ganeshotsav गणपती", text: "गणपती बाप्पा|मोरया", fill: ["#FF7A00", "#E8002D"], anim: "pop", deco: "rays", small: true },
  { id: "namaste", cat: "festivals", tags: "namaste pray thanks folded hands", emoji: "🙏", anim: "pulse", deco: "glow" },
  { id: "eid-mubarak", cat: "festivals", tags: "eid mubarak ramadan", text: "Eid|Mubarak", fill: ["#19B36B", "#0E7C86"], anim: "pop", deco: "sparkles", emojiBadge: "🌙" },
  { id: "merry-christmas", cat: "festivals", tags: "christmas xmas", text: "Merry|Christmas", fill: ["#E8253A", "#1E9E4A"], anim: "wave", deco: "sparkles", emojiBadge: "🎄" },
  { id: "happy-navratri", cat: "festivals", tags: "navratri garba dandiya durga", text: "Happy|Navratri", fill: ["#FF3D7F", "#FFB000"], anim: "pop", deco: "confetti" },
  { id: "kite", cat: "festivals", tags: "kite sankranti uttarayan patang", emoji: "🪁", anim: "swing", deco: "sparkles" },
  { id: "happy-new-year", cat: "festivals", tags: "new year 2027 celebrate", text: "Happy|New Year", fill: ["#FFD24A", "#FF8A00"], anim: "pop", deco: "confetti" },

  // Love
  { id: "heart", cat: "love", tags: "heart love", emoji: "❤️", anim: "pulse", deco: "hearts" },
  { id: "hearts", cat: "love", tags: "hearts love cute", emoji: "💕", anim: "float", deco: "hearts" },
  { id: "heart-eyes", cat: "love", tags: "love crush heart eyes", emoji: "😍", anim: "bounce", deco: "hearts" },
  { id: "sparkle-heart", cat: "love", tags: "heart sparkle love", emoji: "💖", anim: "pulse", deco: "sparkles" },
  { id: "heart-hands", cat: "love", tags: "heart hands love you", emoji: "🫶", anim: "pulse", deco: "hearts" },
  { id: "love-you", cat: "love", tags: "love you i love you", text: "Love you", fill: ["#FF2E63", "#FF7AB6"], anim: "pop", deco: "hearts", script: true },
  { id: "pyaar", cat: "love", tags: "pyaar love hindi प्यार", text: "प्यार", fill: ["#FF2E63", "#C2185B"], anim: "pulse", deco: "hearts" },
  { id: "miss-you", cat: "love", tags: "miss you", text: "Miss you", fill: ["#7B5CFF", "#FF5FA2"], anim: "float", deco: "hearts", script: true },
  { id: "bestie", cat: "love", tags: "bestie best friend bff dost", text: "Bestie", fill: ["#FF5FA2", "#FFB347"], anim: "wave", deco: "sparkles" },

  // Reactions
  { id: "lol", cat: "reactions", tags: "lol laugh haha funny", emoji: "😂", anim: "shake", deco: null },
  { id: "fire", cat: "reactions", tags: "fire lit hot", emoji: "🔥", anim: "flicker", deco: "glow" },
  { id: "hundred", cat: "reactions", tags: "100 hundred perfect", emoji: "💯", anim: "pulse", deco: "sparkles" },
  { id: "clap", cat: "reactions", tags: "clap applause well done", emoji: "👏", anim: "shake", deco: "sparkles" },
  { id: "cool", cat: "reactions", tags: "cool sunglasses swag", emoji: "😎", anim: "bounce", deco: "sparkles" },
  { id: "mind-blown", cat: "reactions", tags: "mind blown wow shocked", emoji: "🤯", anim: "shake", deco: "rays" },
  { id: "omg", cat: "reactions", tags: "omg wow shocked", text: "OMG!", fill: ["#FFD000", "#FF5E00"], anim: "shake", deco: "rays" },
  { id: "wow", cat: "reactions", tags: "wow amazing", text: "WOW", fill: ["#00C2FF", "#7B5CFF"], anim: "pop", deco: "sparkles" },
  { id: "arre-wah", cat: "reactions", tags: "arre wah wow great hindi", text: "Arre|wah!", fill: ["#FF7A00", "#FF2E63"], anim: "pop", deco: "sparkles" },
  { id: "bas-kar", cat: "reactions", tags: "bas kar stop enough funny hindi", text: "Bas kar!", fill: ["#FF2E63", "#B44DFF"], anim: "shake", deco: null, emojiBadge: "😂" },
  { id: "kya-baat", cat: "reactions", tags: "kya baat hai great wow", text: "Kya baat|hai!", fill: ["#19B36B", "#00A3FF"], anim: "pop", deco: "sparkles" },

  // Greetings
  { id: "good-morning", cat: "greetings", tags: "good morning gm", text: "Good|Morning", fill: ["#FFB300", "#FF6A00"], anim: "pop", deco: "rays", emojiBadge: "☀️" },
  { id: "suprabhat", cat: "greetings", tags: "suprabhat good morning hindi marathi सुप्रभात", text: "सुप्रभात", fill: ["#FFB300", "#FF5E00"], anim: "pop", deco: "rays", emojiBadge: "☀️" },
  { id: "good-night", cat: "greetings", tags: "good night gn sleep", text: "Good|Night", fill: ["#7B8CFF", "#3A2E9E"], anim: "float", deco: "sparkles", emojiBadge: "🌙" },
  { id: "shubh-ratri", cat: "greetings", tags: "shubh ratri good night hindi marathi शुभ रात्री", text: "शुभ|रात्री", fill: ["#8C7BFF", "#3A2E9E"], anim: "float", deco: "sparkles", emojiBadge: "🌙" },
  { id: "thank-you", cat: "greetings", tags: "thank you thanks", text: "Thank you", fill: ["#19B36B", "#0FA3B1"], anim: "pop", deco: "hearts", script: true },
  { id: "dhanyavad", cat: "greetings", tags: "dhanyavad thanks hindi marathi धन्यवाद", text: "धन्यवाद", fill: ["#19B36B", "#0E7C86"], anim: "pop", deco: "sparkles" },
  { id: "hello", cat: "greetings", tags: "hello hi hey", text: "Hello!", fill: ["#00A3FF", "#7B5CFF"], anim: "wave", deco: null, emojiBadge: "👋" },
  { id: "waving", cat: "greetings", tags: "hi bye wave", emoji: "👋", anim: "swing", deco: null },

  // Food
  { id: "chai-time", cat: "food", tags: "chai tea coffee time", text: "Chai|time", fill: ["#B5651D", "#6B3A12"], anim: "pop", deco: "steam", emojiBadge: "☕" },
  { id: "chai", cat: "food", tags: "chai tea coffee cup", emoji: "☕", anim: "float", deco: "steam" },
  { id: "pizza", cat: "food", tags: "pizza food", emoji: "🍕", anim: "wiggle", deco: "sparkles" },
  { id: "burger", cat: "food", tags: "burger food", emoji: "🍔", anim: "bounce", deco: null },
  { id: "mango", cat: "food", tags: "mango aam fruit summer", emoji: "🥭", anim: "swing", deco: "sparkles" },
  { id: "foodie", cat: "food", tags: "foodie food yum", text: "Foodie", fill: ["#FF5E00", "#FFB300"], anim: "wave", deco: null, emojiBadge: "😋" },
  { id: "yum", cat: "food", tags: "yum tasty delicious", emoji: "😋", anim: "bounce", deco: "sparkles" },

  // Travel and vibes
  { id: "travel-mode", cat: "travel", tags: "travel trip vacation flight", text: "Travel|mode", fill: ["#00A3FF", "#00C2A8"], anim: "float", deco: null, emojiBadge: "✈️" },
  { id: "plane", cat: "travel", tags: "plane flight travel", emoji: "✈️", anim: "float", deco: null },
  { id: "beach", cat: "travel", tags: "beach goa holiday", emoji: "🏖️", anim: "float", deco: "rays" },
  { id: "weekend-vibes", cat: "travel", tags: "weekend vibes saturday sunday", text: "Weekend|vibes", fill: ["#FF5FA2", "#7B5CFF"], anim: "wave", deco: "sparkles" },
  { id: "camera", cat: "travel", tags: "camera photo click", emoji: "📸", anim: "shake", deco: "rays" },
  { id: "music", cat: "travel", tags: "music song vibe headphones", emoji: "🎧", anim: "bounce", deco: "notes" },
  { id: "monday", cat: "travel", tags: "monday tired office", text: "Monday|again", fill: ["#6C7A89", "#3D4A5C"], anim: "swing", deco: null, emojiBadge: "😩" },

  // Cricket
  { id: "cricket", cat: "cricket", tags: "cricket bat match", emoji: "🏏", anim: "swing", deco: "sparkles" },
  { id: "six", cat: "cricket", tags: "six cricket sixer", text: "SIX!", fill: ["#1E88FF", "#00C2FF"], anim: "pop", deco: "rays" },
  { id: "trophy", cat: "cricket", tags: "trophy win champion", emoji: "🏆", anim: "pulse", deco: "sparkles" },
  { id: "india", cat: "cricket", tags: "india flag cheer", emoji: "🇮🇳", anim: "swing", deco: "confetti" },
];

const ANIM = {
  bounce: `@keyframes a{0%,100%{transform:translateY(0) scale(1,1)}15%{transform:translateY(0) scale(1.12,.88)}45%{transform:translateY(-34px) scale(.95,1.06)}70%{transform:translateY(0) scale(1.08,.92)}85%{transform:translateY(-8px) scale(1,1)}}`,
  wiggle: `@keyframes a{0%,50%,100%{transform:rotate(0)}12%{transform:rotate(-14deg)}37%{transform:rotate(14deg)}62%{transform:rotate(-8deg)}87%{transform:rotate(8deg)}}`,
  pulse: `@keyframes a{0%,40%,100%{transform:scale(1)}10%{transform:scale(1.18)}25%{transform:scale(1.04)}32%{transform:scale(1.14)}}`,
  float: `@keyframes a{0%,100%{transform:translateY(10px) rotate(-4deg)}50%{transform:translateY(-14px) rotate(4deg)}}`,
  shake: `@keyframes a{0%,100%{transform:rotate(0) translateX(0)}10%{transform:rotate(-9deg) translateX(-5px)}20%{transform:rotate(9deg) translateX(5px)}30%{transform:rotate(-7deg)}40%{transform:rotate(7deg)}50%{transform:rotate(0)}}`,
  flicker: `@keyframes a{0%,100%{transform:scale(1,1)}20%{transform:scale(1.04,1.08)}35%{transform:scale(.97,.95)}55%{transform:scale(1.05,1.1)}75%{transform:scale(.98,.96)}}`,
  pop: `@keyframes a{0%,100%{transform:scale(1) rotate(-3deg)}25%{transform:scale(1.07) rotate(2deg)}50%{transform:scale(.97) rotate(3deg)}75%{transform:scale(1.05) rotate(-2deg)}}`,
  wave: `@keyframes a{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}`,
  swing: `@keyframes a{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(16deg)}}`,
};

const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function deco(kind, seed) {
  const r = rand(seed * 97 + 13);
  const items = [];
  if (kind === "sparkles") {
    for (let i = 0; i < 6; i++) {
      const x = [40, 270, 60, 255, 150, 25][i] + r() * 20, y = [50, 60, 250, 240, 20, 150][i] + r() * 20, s = 18 + r() * 16;
      const c = ["#FFD84D", "#FFFFFF", "#FF9AD5", "#8EE7FF"][i % 4];
      items.push(`<svg class="tw" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;animation-delay:${-(i * 0.33).toFixed(2)}s" viewBox="0 0 24 24"><path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width=".6"/></svg>`);
    }
  } else if (kind === "confetti") {
    for (let i = 0; i < 16; i++) {
      const x = 10 + r() * 300, c = ["#FF4FA0", "#FFD000", "#00C2FF", "#7B5CFF", "#19B36B", "#FF7A00"][i % 6];
      items.push(`<i class="cf" style="left:${x}px;background:${c};width:${8 + r() * 6}px;height:${12 + r() * 8}px;animation-delay:${-(r() * 2).toFixed(2)}s;--rot:${Math.round(r() * 720 - 360)}deg"></i>`);
    }
  } else if (kind === "hearts") {
    for (let i = 0; i < 6; i++) {
      const x = 30 + i * 46 + r() * 16;
      items.push(`<span class="ht" style="left:${x}px;font-size:${22 + r() * 18}px;animation-delay:${-(i * 0.34).toFixed(2)}s">${["❤️", "💕", "💖"][i % 3]}</span>`);
    }
  } else if (kind === "steam") {
    for (let i = 0; i < 3; i++) items.push(`<i class="st" style="left:${130 + i * 26}px;animation-delay:${-(i * 0.66).toFixed(2)}s"></i>`);
  } else if (kind === "glow") {
    items.push(`<i class="gl"></i>`);
  } else if (kind === "rays") {
    items.push(`<i class="ry"></i>`);
  } else if (kind === "notes") {
    for (let i = 0; i < 4; i++) items.push(`<span class="ht" style="left:${40 + i * 70}px;font-size:30px;animation-delay:${-(i * 0.5).toFixed(2)}s">${["🎵", "🎶"][i % 2]}</span>`);
  }
  return items.join("");
}

function textHtml(s) {
  const lines = s.text.split("|");
  const longest = Math.max(...lines.map((l) => [...l].length));
  const devanagari = /[ऀ-ॿ]/.test(s.text);
  const base = s.small ? 44 : longest <= 4 ? 96 : longest <= 6 ? 80 : longest <= 8 ? 64 : 54;
  const size = devanagari ? base * 0.92 : base;
  const family = s.script && !devanagari ? "Pacifico" : "Baloo";
  const grad = `linear-gradient(180deg, ${s.fill.join(", ")})`;
  let letter = 0;
  const lineHtml = lines.map((line) => {
    const chars = s.anim === "wave" && !devanagari
      ? [...line].map((ch) => `<span class="lt" style="animation-delay:${-(letter++ * 0.09).toFixed(2)}s">${ch === " " ? "&nbsp;" : ch}</span>`).join("")
      : line;
    return `<div class="ln">${chars}</div>`;
  }).join("");
  return `<div class="tx" style="font-family:${family};font-size:${size}px;--grad:${grad}">${lineHtml}</div>`;
}

function stickerHtml(s, i) {
  const body = s.emoji
    ? `<div class="em">${s.emoji}</div>`
    : `${s.emojiBadge ? `<div class="badge">${s.emojiBadge}</div>` : ""}${textHtml(s)}`;
  return `<!doctype html><html><head><style>
  @font-face{font-family:Baloo;src:url(${font("baloo-2-latin-800-normal.woff2")});unicode-range:U+0000-00FF,U+2000-206F}
  @font-face{font-family:Baloo;src:url(${font("baloo-2-devanagari-800-normal.woff2")});unicode-range:U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+25CC,U+A830-A839,U+A8E0-A8FF}
  @font-face{font-family:Pacifico;src:url(${font("pacifico-latin-400-normal.woff2")})}
  html,body{margin:0;background:transparent}
  #s{position:relative;width:${SIZE}px;height:${SIZE}px;overflow:hidden}
  ${ANIM[s.anim]}
  .main{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:a ${s.anim === "shake" || s.anim === "flicker" ? 1 : 2}s ease-in-out infinite;transform-origin:50% 60%}
  .em{font-family:"Noto Color Emoji";font-size:170px;line-height:1;filter:drop-shadow(0 6px 6px rgba(0,0,0,.35))}
  .badge{font-family:"Noto Color Emoji";font-size:64px;line-height:1;margin-bottom:-6px;filter:drop-shadow(0 4px 4px rgba(0,0,0,.3))}
  .tx{text-align:center;line-height:1.02;font-weight:800;max-width:300px}
  .ln{white-space:nowrap;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;
      -webkit-text-stroke:0;filter:drop-shadow(0 0 0 #fff) drop-shadow(3px 0 0 #fff) drop-shadow(-3px 0 0 #fff) drop-shadow(0 3px 0 #fff) drop-shadow(0 -3px 0 #fff) drop-shadow(0 5px 4px rgba(0,0,0,.4));padding:0 6px}
  .lt{display:inline-block;animation:w 1s ease-in-out infinite;background:inherit;-webkit-background-clip:text;background-clip:text}
  @keyframes w{0%,100%{transform:translateY(4px)}50%{transform:translateY(-8px)}}
  .tw{position:absolute;animation:t 1s ease-in-out infinite}
  @keyframes t{0%,100%{transform:scale(.2) rotate(0);opacity:.2}50%{transform:scale(1.1) rotate(45deg);opacity:1}}
  .cf{position:absolute;top:-30px;border-radius:2px;animation:c 2s linear infinite}
  @keyframes c{0%{transform:translateY(0) rotate(0)}100%{transform:translateY(380px) rotate(var(--rot))}}
  .ht{position:absolute;bottom:-40px;font-family:"Noto Color Emoji";animation:h 2s ease-in infinite}
  @keyframes h{0%{transform:translateY(0) scale(.6);opacity:0}20%{opacity:1}100%{transform:translateY(-330px) scale(1.1);opacity:0}}
  .st{position:absolute;top:40px;width:14px;height:70px;border-radius:7px;background:linear-gradient(rgba(255,255,255,0),rgba(255,255,255,.85));animation:m 2s ease-in-out infinite}
  @keyframes m{0%{transform:translateY(30px) scaleY(.6);opacity:0}40%{opacity:.9}100%{transform:translateY(-30px) scaleY(1.1) skewX(12deg);opacity:0}}
  .gl{position:absolute;left:30px;top:30px;width:260px;height:260px;border-radius:50%;background:radial-gradient(rgba(255,200,60,.75),rgba(255,140,0,0) 65%);animation:g 1s ease-in-out infinite}
  @keyframes g{0%,100%{transform:scale(.85);opacity:.7}50%{transform:scale(1.05);opacity:1}}
  .ry{position:absolute;left:10px;top:10px;width:300px;height:300px;border-radius:50%;background:repeating-conic-gradient(rgba(255,214,77,.5) 0 10deg,rgba(255,214,77,0) 10deg 30deg);-webkit-mask:radial-gradient(circle closest-side,#000 35%,transparent 100%);mask:radial-gradient(circle closest-side,#000 35%,transparent 100%);animation:r 2s linear infinite}
  @keyframes r{to{transform:rotate(60deg)}}
  </style></head><body><div id="s">${s.deco === "glow" || s.deco === "rays" ? deco(s.deco, i) : ""}<div class="main">${body}</div>${s.deco && s.deco !== "glow" && s.deco !== "rays" ? deco(s.deco, i) : ""}</div></body></html>`;
}

(async () => {
  const ids = new Set();
  for (const s of S) {
    if (ids.has(s.id) || !/^[a-z0-9-]{2,40}$/.test(s.id) || !CATEGORIES.includes(s.cat)) throw new Error(`bad sticker ${s.id}`);
    ids.add(s.id);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-stickers-"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  for (const [i, s] of S.entries()) {
    if (only && !only.has(s.id)) continue;
    await page.setContent(stickerHtml(s, i));
    await page.evaluate(() => document.fonts.ready);
    const dir = path.join(tmp, s.id);
    fs.mkdirSync(dir);
    for (let f = 0; f < FRAMES; f++) {
      const ms = (f / FPS) * 1000;
      await page.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; } }, ms);
      await page.screenshot({ path: path.join(dir, `f${String(f).padStart(3, "0")}.png`), omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
    }
    execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", path.join(dir, "f%03d.png"),
      "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "60", "-compression_level", "6", "-loop", "0", "-pix_fmt", "yuva420p",
      path.join(OUT, `${s.id}.webp`)]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const manifest = {
    size: SIZE,
    categories: CATEGORIES,
    stickers: S.map((s) => ({ id: s.id, category: s.cat, tags: s.tags.split(/\s+/).filter(Boolean) })),
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  console.log(`${S.length} stickers → ${OUT}`);
})();
