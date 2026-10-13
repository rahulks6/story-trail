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
  await shot("screen=edit", "edit");
  await shot("screen=crop", "crop");
  await shot("screen=crop", "crop-zoomed", async () => {
    await page.click('[aria-label="Zoom in"]');
    await page.click('[aria-label="Zoom in"]');
    await page.waitForTimeout(300);
  });
  await shot("screen=login", "login");
  // Sign-up with a date of birth (Phase 14: 18 and older), filled in as someone would type it.
  const fill = (birth) => async () => {
    for (const [label, text] of [["Display name", "Rahul K"], ["Username", "rahul.k"], ["Email", "rahul@example.com"], ["Date of birth", birth], ["Password", "a long passphrase"]]) {
      await page.locator(`input[aria-label^="${label}"]`).pressSequentially(text);
    }
    await page.locator('input[aria-label^="Display name"]').focus();
    await page.waitForTimeout(700);
  };
  await shot("screen=signup", "signup", fill("15051995"));
  await shot("screen=signup", "signup-under-18", fill(`1505${new Date().getFullYear() - 16}`));
  await shot("screen=about", "about");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
