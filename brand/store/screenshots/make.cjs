#!/usr/bin/env node
// The Google Play screenshots: each real app screen (captured by the emulator workflow with
// flow=store, saved in raw/) in a device frame under one short headline, in the Postcard look:
// cream paper, dark ink, Baloo 2 headings and an amber highlight, like the app itself.
// Phone: 1080 x 1920 (9:16). Tablet: 1920 x 1080 (16:9), from the landscape tablet captures.
// Run: node brand/store/screenshots/make.cjs [en|hi|mr]   (needs Playwright, pre-installed in the dev container)
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const DIR = __dirname;
const MARK = fs.readFileSync(path.join(DIR, "../../katkee-mark.svg"), "utf8").replace(/<\?xml[^>]*>/, "");

// In the order Play shows them: the first three carry the listing. One set per listing language
// (Play shows each country's people the screenshots of their language): node make.cjs [lang].
const SCREENS = ["home", "editor", "chat", "profile", "layout", "activity", "group", "settings"];
const TEXT = {
  en: [
    ["Share your day<br>in <em>Stories</em>", "Photos and videos with the people who matter"],
    ["Make every Story<br><em>yours</em>", "Text, music, stickers and filters"],
    ["Chat with<br><em>your people</em>", "Messages, voice notes and video calls"],
    ["Keep the best as<br><em>Memories</em>", "Your favourite Stories, on your profile"],
    ["Your photos,<br><em>one Story</em>", "Up to six photos in one Layout"],
    ["See who<br><em>loved it</em>", "Likes, comments and new followers"],
    ["Plans with<br><em>your crew</em>", "Group chats with up to 32 friends"],
    ["You choose<br><em>who sees it</em>", "Everyone, followers or Close Friends"],
  ],
  hi: [
    ["अपना दिन<br><em>स्टोरीज़</em> में", "अपनों के साथ फ़ोटो और वीडियो"],
    ["हर स्टोरी को<br><em>अपना</em> बनाएँ", "टेक्स्ट, म्यूज़िक, स्टिकर और फ़िल्टर"],
    ["<em>अपनों</em> से<br>बातें करें", "मैसेज, वॉइस नोट और वीडियो कॉल"],
    ["ख़ास पल<br><em>यादों</em> में", "पसंदीदा स्टोरीज़, आपकी प्रोफ़ाइल पर"],
    ["कई फ़ोटो,<br><em>एक स्टोरी</em>", "एक लेआउट में छह फ़ोटो तक"],
    ["देखें किसे<br><em>पसंद आया</em>", "लाइक, कमेंट और नए फ़ॉलोअर"],
    ["दोस्तों के साथ<br><em>प्लान</em>", "32 लोगों तक के ग्रुप चैट"],
    ["आप तय करें<br><em>कौन देखे</em>", "सब, फ़ॉलोअर या क्लोज़ फ़्रेंड्स"],
  ],
  mr: [
    ["तुमचा दिवस<br><em>स्टोरीज</em>मध्ये", "आपल्या माणसांसोबत फोटो आणि व्हिडिओ"],
    ["प्रत्येक स्टोरी<br><em>तुमची</em>", "टेक्स्ट, संगीत, स्टिकर आणि फिल्टर"],
    ["<em>आपल्या माणसांशी</em><br>गप्पा", "मेसेज, व्हॉइस नोट आणि व्हिडिओ कॉल"],
    ["खास क्षण<br><em>आठवणीं</em>मध्ये", "आवडत्या स्टोरीज, तुमच्या प्रोफाइलवर"],
    ["अनेक फोटो,<br><em>एक स्टोरी</em>", "एका लेआउटमध्ये सहा फोटोपर्यंत"],
    ["पाहा कोणाला<br><em>आवडलं</em>", "लाइक, कमेंट आणि नवीन फॉलोअर"],
    ["मित्रांसोबत<br><em>प्लॅन</em>", "32 लोकांपर्यंतचे ग्रुप चॅट"],
    ["तुम्ही ठरवा<br><em>कोण पाहील</em>", "सगळे, फॉलोअर किंवा क्लोज फ्रेंड्स"],
  ],
};
const LANG = process.argv[2] ?? "en";
if (!TEXT[LANG]) throw new Error(`no screenshot text for ${LANG}`);
const PHONE = SCREENS.map((name, i) => ({ raw: `phone-${name}`, title: TEXT[LANG][i][0], sub: TEXT[LANG][i][1] }));
const TABLET = PHONE.map((s) => ({ ...s, raw: s.raw.replace("phone-", "tablet-") }));

const css = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #FBF6EC; font-family: Inter, 'Noto Sans Devanagari', sans-serif; color: #1E1A16; }
  .slide { position: relative; overflow: hidden;
    background: radial-gradient(ellipse 70% 40% at 50% 100%, rgba(255,200,0,0.20), transparent 70%), #FBF6EC; }
  h1 { font-family: 'Baloo 2', 'Noto Sans Devanagari', sans-serif; font-weight: 800; letter-spacing: -0.01em; line-height: 1.0; }
  /* The amber marker stroke behind the key words. */
  h1 em { font-style: normal; background: linear-gradient(transparent 58%, #FFC800 62%, #FFC800 88%, transparent 88%); padding: 0 6px; margin: 0 -6px; }
  .sub { color: #6B6155; font-weight: 500; }
  .brand { display: flex; align-items: center; gap: 14px; font-family: 'Baloo 2', sans-serif; font-weight: 800; }
  .brand svg { display: block; }
  .brand span { color: #7F5600; }
  .device { position: absolute; background: #1E1A16;
    box-shadow: 0 40px 90px rgba(80,56,0,0.28), 0 6px 18px rgba(30,26,22,0.18); }
  .device .screen { width: 100%; height: 100%; overflow: hidden; background: #FBF6EC; }
  .device img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
`;

function phoneHtml(s, img) {
  return `<div class="slide" style="width:1080px;height:1920px">
    <div class="brand" style="position:absolute;left:96px;top:92px;font-size:40px">${MARK.replace("<svg", '<svg height="48"')}<div>Kat<span>kee</span></div></div>
    <h1 style="position:absolute;left:96px;right:96px;top:176px;font-size:100px">${s.title}</h1>
    <div class="sub" style="position:absolute;left:96px;right:96px;top:424px;font-size:38px">${s.sub}</div>
    <div class="device" style="left:224px;top:516px;width:632px;height:1350px;border-radius:76px;padding:16px">
      <div class="screen" style="border-radius:62px"><img src="${img}"></div></div>
  </div>`;
}

function tabletHtml(s, img) {
  // The text is one column, so a headline of any length pushes its line down instead of covering it.
  return `<div class="slide" style="width:1920px;height:1080px">
    <div class="brand" style="position:absolute;left:100px;top:96px;font-size:38px">${MARK.replace("<svg", '<svg height="46"')}<div>Kat<span>kee</span></div></div>
    <div style="position:absolute;left:100px;width:560px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:28px">
      <h1 style="font-size:84px">${s.title}</h1>
      <div class="sub" style="font-size:34px;line-height:1.35">${s.sub}</div></div>
    <div class="device" style="left:700px;top:170px;width:1140px;height:740px;border-radius:40px;padding:16px">
      <div class="screen" style="border-radius:26px"><img src="${img}" style="object-position:left top"></div></div>
  </div>`;
}

(async () => {
  const browser = await chromium.launch();
  for (const [kind, slides, w, h, html] of [["phone", PHONE, 1080, 1920, phoneHtml], ["tablet", TABLET, 1920, 1080, tabletHtml]]) {
    const out = path.join(DIR, LANG === "en" ? kind : `${kind}-${LANG}`);
    fs.mkdirSync(out, { recursive: true });
    let n = 0;
    for (const s of slides) {
      const raw = path.join(DIR, "raw", `${s.raw}.png`);
      if (!fs.existsSync(raw)) { console.log(`skip ${s.raw} (no raw screen)`); continue; }
      n++;
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const img = `data:image/png;base64,${fs.readFileSync(raw).toString("base64")}`;
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
        <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@800&family=Inter:wght@500;800;900&family=Noto+Sans+Devanagari:wght@500;800;900&display=swap" rel="stylesheet">
        <style>${css}</style></head><body>${html(s, img)}</body></html>`, { waitUntil: "networkidle" }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(out, `${String(n).padStart(2, "0")}-${s.raw.replace(/^(phone|tablet)-/, "")}.png`);
      await page.screenshot({ path: file, type: "png" });
      await page.close();
      console.log(file);
    }
  }
  await browser.close();
})();
