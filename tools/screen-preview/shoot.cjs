// Screenshots of the creator pages (build first: node build.cjs). Output: shots/*.png.
const path = require("path");
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/node-tools/node_modules/playwright"); } })();
const here = "file://" + __dirname;
const out = path.join(__dirname, "shots");
require("fs").mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.type(), m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  const shot = async (query, name, before) => {
    await page.goto(`${here}/index.html?${query}`);
    await page.waitForTimeout(900);
    if (before) await before();
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  };
  await shot("screen=own", "own");
  await shot("screen=own&story=none", "own-no-story");
  await shot("screen=other", "other");
  await shot("screen=private", "private");
  await shot("screen=other", "more", async () => {
    await page.click('[aria-label="More options for @asha_k"]');
    await page.waitForTimeout(700);
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
