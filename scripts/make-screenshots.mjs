import { chromium } from 'playwright-core';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';

const out = path.join(ROOT, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
for (const file of ['overview.png', 'compare.png', 'metrics.png', 'diff.png', 'diff-fixed.png', 'report.png', 'series.png', 'methodology.png', 'welcome.png']) {
  try { rmSync(path.join(out, file)); } catch { /* ignore */ }
}

const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1150 }, deviceScaleFactor: 1 });
const base = process.env.VECBENCH_URL || 'http://127.0.0.1:8810';
const list = await (await fetch(`${base}/api/experiments`)).json();
const record = list.items.find((item) => item.name.toLowerCase().includes('эмблема')) || list.items[0];
if (!record) throw new Error('No experiments to screenshot');

await page.goto(`${base}/#/experiment/${record.id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.screenshot({ path: path.join(out, 'experiment.png'), fullPage: false });
await page.screenshot({ path: path.join(out, 'experiment-full.png'), fullPage: true });

const charts = page.locator('.charts-grid');
await charts.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.evaluate(() => { const header = document.querySelector('.simple-header'); if (header) header.style.display = 'none'; });
await charts.screenshot({ path: path.join(out, 'charts.png') });

await page.goto(`${base}/#/new`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.evaluate(() => { const header = document.querySelector('.simple-header'); if (header) header.style.display = ''; });
await page.screenshot({ path: path.join(out, 'new-experiment.png'), fullPage: false });

await browser.close();
console.log('Screenshots written to', out);
