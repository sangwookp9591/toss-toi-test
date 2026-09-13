import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const studioUrl = 'http://localhost:5273';
let server;
let browser;
try {
  let occupied = false;
  try { await fetch(studioUrl); occupied = true; } catch {}
  if (occupied) throw new Error('Benchmark port 5273 is already in use; stop the package test server before running the benchmark.');
  {
    server = spawn(process.execPath, ['scripts/dev.mjs'], { stdio: 'inherit', env: { ...process.env, STUDIO_PORT: '5273', PREVIEW_PORT: '5274' } });
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(studioUrl)).ok) break; } catch {}
      if (attempt >= 100 || server.exitCode !== null) throw new Error('Demo server did not start');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const samples = [];
  for (let trial = 1; trial <= 3; trial++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const manifestUrl = process.env.MANIFEST_URL;
    await page.goto(studioUrl + '/?manual' + (manifestUrl ? '&manifestUrl=' + encodeURIComponent(manifestUrl) : ''));
    await page.evaluate(() => window.demo.ready);
    const sample = await page.evaluate(async trial => {
      const code = document.querySelector('#editor').value;
      const firstStart = performance.now();
      const first = await window.demo.run(code);
      const firstCommitMs = performance.now() - firstStart;
      if (first.type !== 'committed') throw new Error(JSON.stringify(first));
      const editStart = performance.now();
      const edit = await window.demo.run(code.replace('Preview ready', 'Preview edited'));
      const editCommitMs = performance.now() - editStart;
      if (edit.type !== 'committed') throw new Error(JSON.stringify(edit));
      return { trial, crossOriginIsolated, firstCommitMs, editCommitMs, first: first.timings, edit: edit.timings };
    }, trial);
    const heading = await page.frameLocator('iframe[data-state="committed"]').locator('h1').textContent();
    if (heading !== 'Preview edited') throw new Error(`Unexpected preview DOM: ${heading}`);
    samples.push(sample);
    console.log(JSON.stringify(sample));
    await context.close();
  }
  const median = values => [...values].sort((a, b) => a - b)[1];
  const result = {
    recordedAt: new Date().toISOString(), units: 'ms',
    environment: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, node: process.version, chrome: browser.version(), esbuildWasm: '0.28.2', headless: true },
    boundaries: {
      start: 'Immediately before demo.run: token/digest preparation, Worker creation and JS load, WASM fetch/initialize, context creation and first rebuild included.',
      end: 'Parent receives rendered after module evaluation and two iframe requestAnimationFrame callbacks, checks full revision token, swaps iframe and resolves build.',
      excluded: 'npm install, development server startup, host asset prebuild, HTML navigation, demo helper JS and manifest fetch before demo.ready.',
      warmup: 'No probe transform, no warmup bundle. Each of 3 samples has a fresh browser context and a fresh Worker; one Chrome process. Edit keeps the same esbuild context and browser HTTP cache.',
      dependencyFixture: process.env.MANIFEST_URL ?? 'Public esm.sh React 19.3.0; actual network module fetches included in boot, no route mocks.',
      cache: 'Local host assets served no-store. Public CDN responses may be cached on edit. OS/DNS/TLS/CDN/WASM compilation caches are not forcibly cleared.',
      limitations: '2 rAF is a render proxy, not verified compositor paint. Tiny one-file fixture, 3 medians, not p95 or a reproduction of TOI 1.3 seconds.'
    },
    samples,
    medians: { firstCommitMs: median(samples.map(s => s.firstCommitMs)), editCommitMs: median(samples.map(s => s.editCommitMs)) }
  };
  const baseline = JSON.parse(await readFile('bench/before-source-mapping.json', 'utf8'));
  const changes = reference => Object.fromEntries(Object.entries(result.medians).map(([key, value]) => [key, (value / reference[key] - 1) * 100]));
  result.baseline = baseline;
  result.comparison = {
    baseline: 'Same-session pre-mapping run; same 5273/5274 ports, Chrome and fixture.',
    changePercent: changes(baseline.medians),
    historicalChangePercent: changes(baseline.historicalBaseline.medians),
    maximumRegressionPercent: 20,
    withinBudget: [baseline.medians, baseline.historicalBaseline.medians].every(reference => Object.values(changes(reference)).every(change => change <= 20)),
  };
  await mkdir('bench', { recursive: true });
  await writeFile(process.env.BENCH_OUTPUT ?? 'bench/results.json', JSON.stringify(result, null, 2) + '\n');
  console.log('Medians:', result.medians);
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
