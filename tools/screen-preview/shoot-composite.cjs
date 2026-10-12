// Labelled images of the screenshots (run shoot.cjs first): shots/creator-page-preview.png and edit-profile-preview.png.
const path = require("path");
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/node-tools/node_modules/playwright"); } })();

(async () => {
  const browser = await chromium.launch();
  for (const [set, width, file] of [["creator", 1748, "creator-page-preview.png"], ["edit", 1080, "edit-profile-preview.png"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`file://${__dirname}/composite.html?set=${set}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(__dirname, "shots", file), fullPage: true });
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
