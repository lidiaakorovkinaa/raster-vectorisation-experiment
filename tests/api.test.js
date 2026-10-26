import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from '../server/config.js';

async function waitForServer(base, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Server did not start');
}

test('API: create, inspect, ROI, export, patch and delete', { timeout: 180_000 }, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vecbench-test-'));
  const port = 9310 + Math.floor(Math.random() * 60);
  const base = `http://127.0.0.1:${port}`;
  let logs = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', VECBENCH_DATA: temp },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    child.kill('SIGINT');
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!child.killed) child.kill('SIGKILL');
    await fs.rm(temp, { recursive: true, force: true });
  });
  await waitForServer(base);

  const buffer = await fs.readFile(path.join(ROOT, 'public', 'samples', 'lineart.png'));
  const form = new FormData();
  form.append('normalized', new Blob([buffer], { type: 'image/png' }), 'lineart.png');
  form.append('original', new Blob([buffer], { type: 'image/png' }), 'lineart.png');
  form.append('meta', JSON.stringify({
    name: 'API integration test',
    tags: ['test', 'lineart'],
    author: 'Tests',
    notes: 'Created by the API integration test.',
    config: { repetitions: 1, maxSide: 500, background: '#FFFFFF', warmup: 1 },
  }));

  const createResponse = await fetch(`${base}/api/experiments?sync=1`, { method: 'POST', body: form, headers: { Accept: 'application/json' } });
  const createText = await createResponse.text();
  assert.equal(createResponse.status, 201, `Unexpected status ${createResponse.status}: ${createText.slice(0, 500)}\n${logs}`);
  const record = JSON.parse(createText);
  assert.equal(record.name, 'API integration test');
  assert.equal(record.status, 'ok');
  assert.equal(record.source.width <= 500, true);
  assert.equal(record.engines.potrace.status, 'ok');
  assert.equal(record.engines.imagetracer.status, 'ok');
  assert.equal(record.engines.vtracer.status, 'ok');
  for (const engine of ['potrace', 'imagetracer', 'vtracer']) {
    assert.ok(record.engines[engine].metrics.ssim >= 0);
    assert.ok(record.engines[engine].stats.nodes > 0);
    assert.ok(record.engines[engine].files.svg);
    assert.ok(record.engines[engine].files.heatmapFixed);
  }
  assert.ok(record.timing.resolvedThreshold > 0);
  assert.ok(record.timing.analysisMs > 0);
  assert.ok(Array.isArray(record.engines.vtracer.timing.samples));

  const id = record.id;
  const svgResponse = await fetch(`${base}/api/experiments/${id}/file/svg/vtracer`);
  assert.equal(svgResponse.status, 200);
  assert.match(svgResponse.headers.get('content-type') || '', /svg/);
  const svg = await svgResponse.text();
  assert.match(svg, /<svg/);

  const heatResponse = await fetch(`${base}/api/experiments/${id}/file/heatmapFixed/imagetracer`);
  assert.equal(heatResponse.status, 200);
  assert.equal(heatResponse.headers.get('content-type'), 'image/png');

  const roiResponse = await fetch(`${base}/api/experiments/${id}/roi?x=40&y=40&w=180&h=160`);
  assert.equal(roiResponse.status, 200);
  const roiMetrics = await roiResponse.json();
  assert.equal(roiMetrics.rect.w, 180);
  assert.ok(roiMetrics.engines.vtracer.ssim > 0);
  assert.ok(roiMetrics.engines.potrace.rmse >= 0);

  const saveRoiResponse = await fetch(`${base}/api/experiments/${id}/rois`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Фрагмент', note: 'API ROI', rect: { x: 40, y: 40, w: 180, h: 160 } }),
  });
  assert.equal(saveRoiResponse.status, 201);
  const roi = await saveRoiResponse.json();
  assert.ok(roi.id);

  const csvResponse = await fetch(`${base}/api/experiments/${id}/export?format=csv`);
  assert.equal(csvResponse.status, 200);
  const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
  assert.deepEqual([...csvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = csvBytes.toString('utf8');
  assert.match(csv, /experiment_id/);
  assert.match(csv, /potrace/);

  const htmlResponse = await fetch(`${base}/api/experiments/${id}/export?format=html`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Фрагмент/);
  assert.match(html, /ΔE2000/);

  const latexResponse = await fetch(`${base}/api/experiments/${id}/export?format=latex`);
  const latex = await latexResponse.text();
  assert.match(latex, /\\begin\{table\}/);
  assert.doesNotMatch(latex, /\d,\d{3}/);

  const zipResponse = await fetch(`${base}/api/experiments/${id}/export?format=zip`);
  assert.equal(zipResponse.status, 200);
  const zip = Buffer.from(await zipResponse.arrayBuffer());
  assert.equal(zip.slice(0, 2).toString(), 'PK');

  const datasetCsvResponse = await fetch(`${base}/api/export?format=csv&ids=${id}`);
  assert.equal(datasetCsvResponse.status, 200);
  assert.match(await datasetCsvResponse.text(), /best_quality/);

  const patchResponse = await fetch(`${base}/api/experiments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Renamed', tags: ['renamed'], pinned: true }),
  });
  assert.equal(patchResponse.status, 200);
  const patched = await patchResponse.json();
  assert.equal(patched.name, 'Renamed');
  assert.deepEqual(patched.tags, ['renamed']);
  assert.equal(patched.pinned, true);

  const listResponse = await fetch(`${base}/api/experiments`);
  const list = await listResponse.json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].name, 'Renamed');

  const deleteResponse = await fetch(`${base}/api/experiments/${id}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  const missing = await fetch(`${base}/api/experiments/${id}`);
  assert.equal(missing.status, 404);
});
