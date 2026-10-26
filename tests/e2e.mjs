import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from '../server/config.js';

const chromePaths = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

async function findChrome() {
  for (const candidate of chromePaths) {
    try { await fs.access(candidate); return candidate; } catch { /* next */ }
  }
  return null;
}

async function waitForServer(base, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Server did not start');
}

const chrome = await findChrome();
if (!chrome) {
  console.log('SKIP: Chrome/Chromium not found. Set CHROME_PATH to run the browser test.');
  process.exit(0);
}

const { chromium } = await import('playwright-core');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vecbench-e2e-'));
const port = 9410 + Math.floor(Math.random() * 60);
const base = `http://127.0.0.1:${port}`;
let logs = '';
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VECBENCH_DATA: temp },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (c) => { logs += c; });
server.stderr.on('data', (c) => { logs += c; });

let browser;
try {
  await waitForServer(base);
  const buffer = await fs.readFile(path.join(ROOT, 'public', 'samples', 'badge.png'));
  const form = new FormData();
  form.append('normalized', new Blob([buffer], { type: 'image/png' }), 'badge.png');
  form.append('original', new Blob([buffer], { type: 'image/png' }), 'badge.png');
  form.append('meta', JSON.stringify({ name: 'E2E badge', config: { repetitions: 1, maxSide: 600 }, tags: ['e2e'], author: 'Playwright' }));
  const create = await fetch(`${base}/api/experiments?sync=1`, { method: 'POST', body: form, headers: { Accept: 'application/json' } });
  if (!create.ok) throw new Error(`Create failed: ${create.status} ${(await create.text()).slice(0, 400)}\n${logs}`);
  const record = await create.json();

  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`PAGEERROR ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`CONSOLE ${message.text().slice(0, 200)}`); });

  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  await page.locator('.method-card').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1000);
  const bodyText = await page.locator('body').innerText();
  assertTrue(!/vecbench/i.test(bodyText), 'Branding still visible in the UI');
  assertTrue((await page.locator('.method-card').count()) === 3, 'Expected exactly three method columns');
  const methodNames = await page.locator('.method-name').allInnerTexts();
  assertTrue(methodNames.join(' ').includes('Potrace') && methodNames.join(' ').includes('ImageTracer') && methodNames.join(' ').includes('VTracer'), 'Method columns are incomplete');
  await assertVisible(page, '.sm-table');
  assertTrue((await page.locator('.chart-card').count()) >= 9, 'Expected at least nine charts');
  const tableText = await page.locator('.sm-table').first().innerText();
  assertTrue(tableText.includes('RMSE') && tableText.includes('SSIM') && tableText.includes('Отклонение покрытия'), 'Metrics table is incomplete');
  assertTrue((await page.locator('.sh-select option').count()) === 2, 'Experiment selector should contain placeholder + one experiment');

  await page.getByRole('button', { name: /Экспорт/ }).click();
  await page.waitForTimeout(200);
  assertTrue((await page.locator('.menu-pop a').count()) >= 7, 'Export menu is incomplete');
  await page.keyboard.press('Escape');

  await page.screenshot({ path: '/tmp/vecbench-e2e-experiment.png', fullPage: false });
  if (process.env.SAVE_SCREENSHOTS === '1') {
    await fs.mkdir(path.join(ROOT, 'docs', 'screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'docs', 'screenshots', 'experiment.png'), fullPage: false });
    await page.screenshot({ path: path.join(ROOT, 'docs', 'screenshots', 'experiment-full.png'), fullPage: true });
  }

  await page.getByRole('button', { name: /Новый эксперимент/ }).click();
  await page.locator('.dropzone').waitFor({ timeout: 10_000 });
  assertTrue((await page.locator('.dropzone').count()) === 1, 'New experiment dropzone is missing');
  if (process.env.SAVE_SCREENSHOTS === '1') {
    await page.screenshot({ path: path.join(ROOT, 'docs', 'screenshots', 'new-experiment.png'), fullPage: false });
  }

  await page.selectOption('.sh-select', record.id);
  await page.locator('.method-card').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);

  assertTrue(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
  console.log('E2E OK: simplified experiment, three method columns, expanded metrics, charts, export and new-experiment page.');
} finally {
  if (browser) await browser.close();
  server.kill('SIGINT');
  await new Promise((resolve) => setTimeout(resolve, 300));
  try { server.kill('SIGKILL'); } catch { /* ignore */ }
  await fs.rm(temp, { recursive: true, force: true });
}

function assertTrue(value, message) {
  if (!value) throw new Error(message);
}
function assertText(actual, expected) {
  if (String(actual).trim() !== expected) throw new Error(`Expected text ${expected}, got ${actual}`);
}
async function assertVisible(page, selector) {
  if (!(await page.locator(selector).first().isVisible())) throw new Error(`Not visible: ${selector}`);
}
