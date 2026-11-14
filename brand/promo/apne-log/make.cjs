// "Apne Log" — 30 s animated ad for YouTube and Meta (1080 x 1920, 30 fps), from the script:
// Riya's hook to camera, her Close Friends Story, three friends replying, chai at the tapri with
// a video call to the friend at home, the day as a Layout and a Highlight, and the install card.
// Illustrated people (art.cjs), the real app screens from brand/store/screenshots/raw (demo
// accounts), Hinglish voices (Amazon Polly, Mumbai: Kajal, Aditi, Raveena) with Hinglish captions
// and English beneath (Meta plays muted), sound effects, and licensed music ducked under speech.
//
//   VOICE=<dir> node brand/promo/apne-log/make.cjs <music.mp3> [out.mp4]   (TRACK= for the credit)
// VOICE holds l1..l11 (voices.sh makes them) and the sound effects.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");
const A = require("./art.cjs");

const MUSIC = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, "katkee-apne-log.mp4");
const TRACK = process.env.TRACK || "Funkorama";
if (!MUSIC) throw new Error("Pass the music file");

const W = 1080, H = 1920, FPS = 30;
const RAW = path.join(__dirname, "..", "..", "store", "screenshots", "raw");
const ICON = path.join(__dirname, "..", "..", "katkee-app-icon-1024.png");
const data = (f) => `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;
const SCREENS = ["phone-editor", "phone-layout", "phone-profile"];

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const backOut = (t) => { t = clamp(t); const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const pop = (t, t0, d = 0.3) => (t < t0 ? 0 : backOut((t - t0) / d));
const lerp = (a, b, k) => a + (b - a) * k;

// The cast.
const RIYA = { hairStyle: "long", hair: "#2A1D17", skin: A.SKIN[1], top: "#FF6B6B", pants: "#2D3142", earring: 1 };
const AMAN = { hairStyle: "short", hair: "#1E1E1E", skin: A.SKIN[2], top: "#4C6EF5", pants: "#3D405B", glasses: 1, bag: "#F4A259" };
const ZOYA = { hairStyle: "bun", hair: "#3B2418", skin: A.SKIN[0], top: "#2EC4B6", pants: "#22223B", earring: 1 };
const KABIR = { hairStyle: "curly", hair: "#2A1D17", skin: A.SKIN[3], top: "#FFB703", pants: "#264653", hood: 1 };
const MEERA = { hairStyle: "long", hair: "#4A2C1D", skin: A.SKIN[1], top: "#9B5DE5", pants: "#9B5DE5" };

const blinkAt = (t, every = 3.1, off = 0) => ((t + off) % every) < 0.12;
const at = (x, y, s, svg) => `<g transform="translate(${x},${y}) scale(${s})">${svg}</g>`;

function caption(main, sub, t0, t, top = 150, out = Infinity) {
  const k = pop(t, t0, 0.3);
  if (k <= 0 || t > out) return "";
  return `<div style="position:absolute;left:60px;right:60px;top:${top}px;display:flex;justify-content:center;transform:scale(${k});transform-origin:50% 0">
    <div style="background:rgba(17,17,17,.86);border-radius:28px;padding:22px 30px;text-align:center;max-width:960px">
      <div style="font:900 56px/1.15 Inter,'Noto Sans Devanagari';color:#fff">${main}</div>
      ${sub ? `<div style="font:700 34px/1.2 Inter;color:#FFD95A;margin-top:8px">${sub}</div>` : ""}</div></div>`;
}
const bubble = (html, x, y, k, bg = "#fff", color = "#111", size = 40) => k > 0 ? `<div style="position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%) scale(${k});padding:18px 26px;border-radius:30px;background:${bg};color:${color};font:800 ${size}px Inter,'Noto Sans Devanagari';box-shadow:0 12px 30px rgba(0,0,0,.22);white-space:nowrap">${html}</div>` : "";
const tap = (x, y, t, t0) => { const k = clamp((t - t0) / 0.45); return k > 0 && k < 1 ? `<div style="position:absolute;left:${x}%;top:${y}%;width:${40 + k * 120}px;height:${40 + k * 120}px;margin:-${20 + k * 60}px 0 0 -${20 + k * 60}px;border-radius:50%;border:6px solid rgba(255,200,0,${1 - k});background:rgba(255,200,0,${0.35 * (1 - k)})"></div>` : ""; };

// The voices decide the timing: each scene lasts as long as its lines (VOICE dir, see the header).
const VOICE = process.env.VOICE;
if (!VOICE) throw new Error("Set VOICE to the folder with the voice lines and sound effects");
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(VOICE, f)]).toString());
const D = Object.fromEntries(["l1.mp3", "l2.mp3", "l3.mp3", "l4p.wav", "l7.mp3", "l8a.mp3", "l9.mp3", "l10.mp3", "l11.mp3"].map((f) => [f.replace(/\..*/, ""), dur(f)]));
const TL = {};
TL.l1 = 0.15; TL.l2 = TL.l1 + D.l1 + 0.1; TL.story = TL.l2 + D.l2 + 0.25;
TL.l3 = TL.story + 0.35; TL.zoya = Math.max(TL.l3 + D.l3 + 0.3, TL.story + 4.2);
TL.l4 = TL.zoya + 0.55; TL.aman = TL.l4 + D.l4p + 0.2;
TL.kabir = TL.aman + 2.0; TL.tapri = TL.kabir + 2.0;
TL.l7 = TL.tapri + 1.0; TL.ring = TL.tapri + 2.3; TL.call = TL.tapri + 2.9; TL.l8 = TL.call + 0.7; TL.l9 = TL.l8 + D.l8a + 0.3;
TL.memory = TL.l9 + D.l9 + 0.4; TL.profile = TL.memory + 2.3; TL.l10 = TL.profile + 0.5;
TL.end = Math.max(TL.l10 + D.l10 + 0.3, TL.profile + 2.4); TL.l11 = TL.end + 0.35; TL.total = TL.l11 + D.l11 + 0.6;
const SECONDS = Math.ceil(TL.total * FPS) / FPS;

function frame(t) {
  const f = { bg: "", people: "", phone: null, ov: "", cap: "", flash: 0 };
  const darkBg = `<rect width="1080" height="1920" fill="#1D2230"/><circle cx="540" cy="1100" r="620" fill="#FFC800" opacity=".12"/>`;

  // 1. Hook: Riya to camera.
  if (t < TL.story) {
    f.bg = A.corridor();
    const bob = Math.sin(t * 2.2) * 6;
    const second = t >= TL.l2;
    const talking = (t > TL.l1 && t < TL.l1 + D.l1) || (t > TL.l2 && t < TL.l2 + D.l2);
    const mouth = talking && Math.sin(t * 22) > 0 ? "o" : second ? "smile" : "smug";
    f.people = at(90, 560 + bob, 3, A.person({ ...RIYA, expr: mouth, blink: blinkAt(t, 2.2, 0.9), armR: -35, holdR: "phone", armL: 10 }));
    f.cap = second
      ? caption("Main toh sirf apne <span style='color:#FFC800'>8</span> ke liye daalti hoon. 💛", "I post for my 8.", TL.l2, t)
      : caption("800 followers ke liye Story kaun daalta hai? 🤨", "Who posts a Story for 800 people?", TL.l1, t);
    const k1 = pop(t, TL.l1 + 0.5), strike = clamp((t - (TL.l2 - 0.3)) / 0.25), k2 = pop(t, TL.l2 + 0.6);
    f.ov = `<div style="position:absolute;left:0;right:0;top:600px;display:flex;justify-content:center;gap:30px">
      ${k1 > 0 ? `<div style="transform:scale(${k1});position:relative;padding:14px 30px;border-radius:40px;background:#fff;font:900 56px Inter;color:#888">👁 800<div style="position:absolute;left:16px;top:50%;height:7px;width:${strike * 88}%;background:#E5484D;border-radius:4px"></div></div>` : ""}
      ${k2 > 0 ? `<div style="transform:scale(${k2});padding:14px 30px;border-radius:40px;background:#2BB673;font:900 56px Inter;color:#fff">★ 8</div>` : ""}</div>`;
    return f;
  }

  // 2. Her Story in the real editor: a song, Close Friends, posted.
  if (t < TL.zoya) {
    const lt = t - TL.story, len = TL.zoya - TL.story;
    f.bg = darkBg;
    f.phone = { s: "phone-editor", w: 700, x: 540, y: lerp(1920, 470, easeOut(lt / 0.5)) };
    const cf = len - 1.7;
    f.ov = tap(47, 15.2, lt, 0.9) + tap(73.5, 91.2, lt, cf) +
      (lt > cf + 0.5 ? `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(${pop(lt, cf + 0.5)});padding:22px 34px;border-radius:40px;background:#2BB673;color:#fff;font:900 46px Inter;white-space:nowrap;box-shadow:0 14px 40px rgba(0,0,0,.4)">✓ Posted to Close Friends</div>` : "");
    f.cap = lt < cf ? caption("Lecture bunk, chai pe chalein? ☕🎵", "Skip the last lecture, chai?", 0.15, lt) : caption("Sirf Close Friends ke liye 🔒", "Close Friends only.", cf, lt);
    return f;
  }

  // 3. Zoya's voice note from the library.
  if (t < TL.aman) {
    const lt = t - TL.zoya;
    f.bg = A.library();
    const talking = t > TL.l4 && t < TL.l4 + D.l4p;
    f.people = at(240, 760 + Math.sin(lt * 3) * 5, 2, A.person({ ...ZOYA, expr: talking && Math.sin(t * 22) > 0 ? "o" : "laugh", blink: blinkAt(lt, 1.7), armR: -40, holdR: "phone" }));
    const bars = Array.from({ length: 14 }, (_, i) => `<div style="width:8px;border-radius:4px;background:#111;height:${14 + (talking ? Math.abs(Math.sin(lt * 9 + i)) * 36 : 4)}px"></div>`).join("");
    f.ov = pop(lt, 0.35) > 0 ? `<div style="position:absolute;left:540px;top:690px;transform:translate(-50%,-50%) scale(${pop(lt, 0.35)});display:flex;align-items:center;gap:16px;padding:20px 30px;border-radius:34px;background:#FFC800;box-shadow:0 14px 30px rgba(0,0,0,.25)"><div style="font-size:44px">🎙</div><div style="display:flex;gap:5px;align-items:center;height:56px">${bars}</div><div style="font:800 34px Inter">0:0${Math.min(9, Math.ceil(D.l4p))}</div></div>` : "";
    f.cap = caption("Zoya: “Arre main aa rahi hoon!” 🏃‍♀️", "Voice note: I'm coming!", 0.05, lt);
    return f;
  }

  // 4. Aman's GIF from class.
  if (t < TL.kabir) {
    const lt = t - TL.aman;
    f.bg = A.classroom();
    f.people = at(240, 820, 2, A.person({ ...AMAN, expr: lt > 0.7 ? "laugh" : "smile", look: -6, blink: blinkAt(lt, 1.9), armR: -20, holdR: "phone", armL: 20 }));
    const g = pop(lt, 0.55, 0.35);
    f.ov = g > 0 ? `<div style="position:absolute;left:770px;top:760px;transform:translate(-50%,-50%) scale(${g}) rotate(${Math.sin(lt * 10) * 8}deg);font-size:190px;line-height:1">😂</div><div style="position:absolute;left:770px;top:900px;transform:translate(-50%,0) scale(${g});padding:6px 14px;border-radius:10px;background:#111;color:#fff;font:900 30px Inter">GIF</div>` : "";
    f.ov += bubble("Pakka! 😂", 330, 720, pop(lt, 0.95), "#fff", "#111", 42);
    f.cap = caption("Aman: class se GIF reply 🤫", "A GIF reply from class.", 0.05, lt);
    return f;
  }

  // 5. Kabir's double tap.
  if (t < TL.tapri) {
    const lt = t - TL.kabir;
    f.bg = A.hostel();
    const awake = lt > 0.7;
    const jump = awake ? Math.abs(Math.sin((lt - 0.7) * 6)) * 60 : 0;
    f.people = at(240, 760 - jump, 2, A.person({ ...KABIR, expr: awake ? "laugh" : "sleepy", blink: !awake, armL: awake ? -125 : 15, armR: awake ? 125 : -35, holdR: awake ? null : "phone" }));
    const h = pop(lt, 0.45, 0.35);
    f.ov = h > 0 ? `<div style="position:absolute;left:820px;top:${700 - (lt - 0.45) * 80}px;transform:translate(-50%,-50%) scale(${h});font-size:170px;opacity:${1 - clamp((lt - 1.5) / 0.4)}">❤️</div>` : "";
    f.cap = caption("Kabir: double tap = main bhi aa raha 😴➡️🏃", "Double tap. I'm in.", 0.05, lt);
    return f;
  }

  // 6. The tapri: they meet; a video call to Meera at home.
  if (t < TL.memory) {
    const lt = t - TL.tapri;
    f.bg = A.tapri(t);
    const walk = easeInOut(lt / 1.1);
    const step = (i) => (walk < 1 ? Math.abs(Math.sin(lt * 9 + i)) * 14 : Math.abs(Math.sin(lt * 4 + i)) * 6);
    const cast = [[RIYA, lerp(-320, 10, walk), 0], [AMAN, lerp(-200, 250, walk), 1], [ZOYA, lerp(1300, 520, walk), 2], [KABIR, lerp(1400, 770, walk), 3]];
    const calling = t > TL.call;
    const riyaTalks = t > TL.l7 && t < TL.l7 + D.l7;
    f.people = cast.map(([c, x, i]) => at(x, 960 - step(i), 1.05, A.person({ ...c, expr: i === 0 && riyaTalks && Math.sin(t * 22) > 0 ? "o" : lt > 1.1 ? "laugh" : "smile", blink: blinkAt(lt, 2.5, i * 0.7), armR: i === 0 && calling ? -40 : -30, holdR: i === 0 && calling ? "phone" : "cup", armL: i === 3 ? 30 + Math.sin(lt * 5) * 10 : 10 }))).join("");
    if (t > TL.ring && !calling) f.ov = bubble("📹 Calling Meera…", 540, 520, pop(t, TL.ring), "#111", "#fff", 44);
    if (calling) {
      const k = pop(t, TL.call, 0.4);
      const meeraTalks = t > TL.l9 && t < TL.l9 + D.l9;
      const wave = Math.sin(lt * 9) * 30;
      const meera = `<svg viewBox="0 0 300 420" width="100%" height="100%" preserveAspectRatio="xMidYMax slice">${A.person({ ...MEERA, expr: meeraTalks && Math.sin(t * 22) > 0 ? "o" : "laugh", blink: blinkAt(lt, 2.3), armR: 140 + wave })}<path d="M40 330 q110 -60 220 0 v120 h-220z" fill="#F7A1C4"/><path d="M40 330 q110 -60 220 0" stroke="#E07AA5" stroke-width="10" fill="none"/></svg>`;
      const secs = Math.floor(t - TL.call);
      f.ov = `<div style="position:absolute;left:540px;top:250px;width:560px;height:760px;transform:translateX(-50%) scale(${k});transform-origin:50% 100%;border-radius:44px;background:#111;padding:12px;box-shadow:0 30px 70px rgba(0,0,0,.4)">
        <div style="position:relative;width:100%;height:100%;border-radius:34px;overflow:hidden;background:linear-gradient(#FDE2F3,#C8B6FF)">
          <div style="position:absolute;inset:60px 0 0 0">${meera}</div>
          <div style="position:absolute;top:22px;left:0;right:0;text-align:center;font:800 30px Inter;color:#111">Meera · 0:${String(secs).padStart(2, "0")}</div>
          <div style="position:absolute;right:18px;top:80px;width:130px;height:180px;border-radius:20px;background:#FFC56B;border:4px solid #fff;overflow:hidden"><svg viewBox="0 0 300 300" width="100%" height="100%">${A.person({ ...RIYA, expr: "laugh" })}</svg></div>
          <div style="position:absolute;bottom:24px;left:0;right:0;display:flex;justify-content:center;gap:24px">${["#3A3A3A", "#E5484D", "#3A3A3A"].map((c, i) => `<div style="width:70px;height:70px;border-radius:35px;background:${c};display:flex;align-items:center;justify-content:center;font-size:32px">${["🎤", "📞", "📷"][i]}</div>`).join("")}</div>
        </div></div>`;
      f.ov += bubble("Get well soon Meera! 💛", 540, 1080, pop(t, TL.l8), "#fff", "#111", 44);
      if (t > TL.l9) f.ov += bubble("Thank you guys! Next time main bhi! 🥹", 540, 1190, pop(t, TL.l9), "#9B5DE5", "#fff", 38);
    }
    f.cap = calling ? caption("Jo nahi aa paayi, usse video call 📹", "Video call the one who couldn't come.", TL.call - TL.tapri, lt, 90)
      : caption("Finally, sab aa gaye! ☕", "Everyone made it!", TL.l7 - TL.tapri, lt, 150);
    return f;
  }

  // 7. The day kept: a Layout, then the profile's Highlights.
  if (t < TL.end) {
    const first = t < TL.profile;
    const lt = t - (first ? TL.memory : TL.profile);
    f.bg = darkBg;
    f.phone = { s: first ? "phone-layout" : "phone-profile", w: 700, x: 540, y: lerp(1920, 470, easeOut(lt / 0.5)) };
    f.ov = first ? tap(50, 93.5, lt, 1.4) : tap(56, 82, lt, 0.9);
    f.cap = first ? caption("Din ki 6 photos, ek Story 📸", "Six photos, one Story.", 0.1, lt)
      : caption("Mera din, mere log. 💛", "My day. My people.", 0.1, lt);
    return f;
  }

  // 8. End card.
  const lt = t - TL.end;
  f.bg = A.yellow();
  const cast = [RIYA, AMAN, ZOYA, KABIR];
  f.people = cast.map((c, i) => at(30 + i * 255, 1260 - Math.abs(Math.sin(lt * 5 + i)) * 30 * easeOut(lt / 0.4), 0.95, A.person({ ...c, expr: "laugh", armL: -130 - Math.sin(lt * 8 + i) * 14, armR: 130 + Math.sin(lt * 8 + i) * 14 }))).join("");
  f.ov = `<img src="ICON" style="position:absolute;left:390px;top:210px;width:300px;height:300px;border-radius:68px;box-shadow:0 20px 50px rgba(0,0,0,.25);transform:scale(${pop(lt, 0.05, 0.4)})">
    <div style="position:absolute;left:0;right:0;top:560px;text-align:center;transform:scale(${pop(lt, 0.3)});font:900 150px Inter;color:#111;letter-spacing:-4px">Katkee</div>
    <div style="position:absolute;left:0;right:0;top:740px;text-align:center;transform:scale(${pop(lt, 0.9)});font:800 52px Inter,'Noto Sans Devanagari';color:#111">Sirf apnon ke liye 💛</div>
    <div style="position:absolute;left:0;right:0;top:870px;display:flex;justify-content:center;transform:scale(${pop(lt, 1.6) * (1 + (lt > 2 ? 0.04 * Math.sin((lt - 2) * 7) : 0))})"><div style="padding:30px 56px;border-radius:60px;background:#111;color:#fff;text-align:center"><div style="font:900 58px Inter">Download free</div><div style="font:700 36px Inter;color:#FFC800;margin-top:4px">on Google Play</div></div></div>
    <div style="position:absolute;left:0;right:0;bottom:22px;text-align:center;font:600 24px Inter;color:rgba(0,0,0,.55)">Music: “${TRACK}” by Kevin MacLeod (incompetech.com), CC BY 4.0 · Illustrated characters · Voices are synthetic</div>`;
  return f;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const imgs = SCREENS.map((s) => `<img id="${s}" src="${data(path.join(RAW, `${s}.png`))}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none">`).join("");
  const icon = data(ICON);
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800;900&family=Noto+Sans+Devanagari:wght@700;800;900&family=Yatra+One&family=Caveat&display=swap" rel="stylesheet">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{width:${W}px;height:${H}px;overflow:hidden;position:relative;background:#000}
    #phone{position:absolute;aspect-ratio:1080/2400;border-radius:9%/4%;padding:2.2%;background:linear-gradient(160deg,#2a2d34,#121418);box-shadow:0 40px 100px rgba(0,0,0,.6);display:none;transform-origin:50% 0}
    #scr{position:relative;width:100%;height:100%;border-radius:7.5%/3.4%;overflow:hidden;background:#000}
    #pov{position:absolute;inset:0}</style></head><body>
    <svg id="bg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;inset:0"></svg>
    <svg id="people" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;inset:0"></svg>
    <div id="phone"><div id="scr">${imgs}<div id="pov"></div></div></div>
    <div id="ov" style="position:absolute;inset:0"></div>
    <div id="cap" style="position:absolute;inset:0"></div>
  </body></html>`, { waitUntil: "networkidle" }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);

  const silent = OUT.replace(/\.mp4$/, ".silent.mp4");
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "19", silent]);
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));

  for (let i = 0; i < SECONDS * FPS; i++) {
    const f = frame(i / FPS);
    await page.evaluate(([f, screens, icon]) => {
      document.getElementById("bg").innerHTML = f.bg;
      document.getElementById("people").innerHTML = f.people;
      const ph = document.getElementById("phone");
      const pov = document.getElementById("pov");
      if (f.phone) {
        ph.style.display = "block";
        ph.style.width = `${f.phone.w}px`;
        ph.style.left = `${f.phone.x - f.phone.w / 2}px`;
        ph.style.top = `${f.phone.y}px`;
        for (const s of screens) document.getElementById(s).style.display = s === f.phone.s ? "block" : "none";
        pov.innerHTML = f.ov;
        document.getElementById("ov").innerHTML = "";
      } else {
        ph.style.display = "none";
        pov.innerHTML = "";
        document.getElementById("ov").innerHTML = f.ov.replace('src="ICON"', `src="${icon}"`);
      }
      document.getElementById("cap").innerHTML = f.cap;
    }, [f, SCREENS, icon]);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  await browser.close();

  // Voices and sound effects on their cues; the music dips under the voices (sidechain).
  const cues = [
    ["l1.mp3", TL.l1, 1], ["l2.mp3", TL.l2, 1], ["whoosh.wav", TL.story - 0.15, 1], ["tap.wav", TL.story + 0.9, 1], ["l3.mp3", TL.l3, 1],
    ["tap.wav", TL.zoya - 1.7, 1], ["ding.wav", TL.zoya - 1.2, 1], ["whoosh.wav", TL.zoya - 0.15, 0.8], ["ding.wav", TL.zoya + 0.3, 0.7], ["l4p.wav", TL.l4, 1],
    ["whoosh.wav", TL.aman - 0.15, 0.8], ["pop.wav", TL.aman + 0.55, 1], ["ding.wav", TL.aman + 0.95, 0.7],
    ["whoosh.wav", TL.kabir - 0.15, 0.8], ["pop.wav", TL.kabir + 0.45, 1], ["whoosh.wav", TL.tapri - 0.15, 0.8],
    ["l7.mp3", TL.l7, 1], ["ring.wav", TL.ring, 0.9], ["pop.wav", TL.call, 0.8],
    ["l8a.mp3", TL.l8, 0.75], ["l8b.mp3", TL.l8 + 0.07, 0.6], ["l8c.mp3", TL.l8 + 0.12, 0.6], ["l9.mp3", TL.l9, 1],
    ["whoosh.wav", TL.memory - 0.15, 0.8], ["tap.wav", TL.memory + 1.4, 1], ["whoosh.wav", TL.profile - 0.1, 0.6], ["l10.mp3", TL.l10, 1],
    ["whoosh.wav", TL.end - 0.15, 0.9], ["l11.mp3", TL.l11, 1], ["ding.wav", TL.end + 1.6, 0.6],
  ];
  const inputs = ["-i", silent, "-i", MUSIC];
  cues.forEach(([file]) => inputs.push("-i", path.join(VOICE, file)));
  const parts = cues.map(([, at, vol], i) => `[${i + 2}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vol},adelay=${Math.max(0, Math.round(at * 1000))}:all=1[c${i}]`);
  const fx = `${parts.join(";")};${cues.map((_, i) => `[c${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:duration=longest,apad,atrim=0:${SECONDS}[fx];[fx]asplit[fxa][fxb]`;
  const music = `[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${SECONDS},asetpts=PTS-STARTPTS,volume=0.55,afade=t=in:d=0.2,afade=t=out:st=${SECONDS - 1.5}:d=1.5[mu]`;
  const duck = `[mu][fxa]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[md];[md][fxb]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${fx};${music};${duck}`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(SECONDS), "-movflags", "+faststart", OUT]);
  fs.unlinkSync(silent);
  console.log(`ad → ${OUT}`);
})();
