import playwright from '/Users/imhanbyeol/.codex/skills/develop-web-game/scripts/node_modules/playwright/index.js';
import fs from 'node:fs';

const { chromium } = playwright;

const ids = [
  'web-v1-01-http', 'web-v1-02-client-trust', 'web-v1-03-idor', 'web-v1-04-sqli-login',
  'web-v1-05-sqli-union', 'web-v1-06-reflected-xss', 'web-v1-07-path-traversal',
  'web-v1-08-upload-validation', 'web-v1-09-jwt-validation', 'web-v1-10-ssrf',
  'web-v1-11-operation-nightfall',
];
const mobileIds = new Set(['web-v1-01-http', 'web-v1-07-path-traversal', 'web-v1-11-operation-nightfall']);
const output = '/tmp/wargame-target-visuals';
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

for (const id of ids) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:18092/__codex_target_fixture.php?mission=${id}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${output}/${id}-desktop.png`, fullPage: false });
  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  results.push({ id, viewport: 'desktop', errors, state });
  await context.close();

  if (mobileIds.has(id)) {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const mobilePage = await mobileContext.newPage();
    const mobileErrors = [];
    mobilePage.on('console', message => { if (message.type() === 'error') mobileErrors.push(message.text()); });
    mobilePage.on('pageerror', error => mobileErrors.push(String(error)));
    await mobilePage.goto(`http://127.0.0.1:18092/__codex_target_fixture.php?mission=${id}`, { waitUntil: 'networkidle' });
    await mobilePage.screenshot({ path: `${output}/${id}-mobile.png`, fullPage: false });
    const mobileState = await mobilePage.evaluate(() => JSON.parse(window.render_game_to_text()));
    results.push({ id, viewport: 'mobile', errors: mobileErrors, state: mobileState });
    await mobileContext.close();
  }
}

await browser.close();
fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
if (results.some(result => result.errors.length > 0)) process.exitCode = 1;
