// One labelled image of all the screenshots (run shoot.cjs first). Output: shots/creator-page-preview.png.
const path = require("path");
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/node-tools/node_modules/playwright"); } })();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1748, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`file://${__dirname}/composite.html`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(__dirname, "shots", "creator-page-preview.png"), fullPage: true });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
