// Run from repository root: bench/node_modules/.bin/tsx docs/compare/bench/run.mts --replace-builder-pid=<7100 listener PID>
// Temporarily replaces only the dependency service with the identical implementation.
// Production source/config/contracts are never changed; original storage is untouched.
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { PackageBuilder } from '../../../services/deps-builder/src/builder.ts';
import { createApp } from '../../../services/deps-builder/src/server.ts';
import { MinioStore } from '../../../services/deps-builder/src/store.ts';
import { defaultPackageSet } from '../../../services/agent-server/src/templates.ts';
import { main, app, marker } from '../../../bench/app.mjs';
const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const require = createRequire(path.join(root, 'bench/package.json'));
const { chromium } = require('@playwright/test');
const out = path.join(root, 'docs/compare/bench');
const scratch = process.env.CMP1_SCRATCH ?? '/private/tmp/claude-501/-Users-psw-orca-workspaces-admin-ui-sargassum/4f10a63d-b5f0-49da-96ed-bc9d41509e2a/scratchpad/cmp1';
const modes = [{ name: 'local', latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  { name: 'slow', latency: 400, downloadThroughput: 750000, uploadThroughput: 250000 }];
const output: any = { measuredAt: new Date().toISOString(), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  environment: { node: process.version, os: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0].model },
  conditions: { modes, repetitions: 3, chrome: 'headless system chrome; one process, sequential contexts',
    start: 'navigation performance.timeOrigin; existing saved project URL /?project=..., full studio JS and dev sessions included',
    end: 'synchronous StudioController subscriber observing a new lastCommit, after runtime iframe replacement and rendered 2 rAF',
    edit: 'controller.edit then controller.saveFiles in same evaluation; no human typing time; CAS save, package-set hit, capability issuance, rebuild and frame commit included',
    cache: 'fresh context + Network.clearBrowserCache before each navigation; normal cache retained for edit; no routes or mocked responses',
    miss: 'fresh dependency builder process state, new empty MinIO bucket and empty Yarn cache/workspace per trial; actual service implementation at original port 7100',
    hit: 'same artifact after miss, new browser context and cleared browser cache; identical request and source',
    fixture: 'same 20 static masked rows as bench/app.mjs, private @toi/tds Table, default studio package set including react-query and @toi/fetch; no business API query or model call',
    exclusions: 'server startup, project fixture creation, npm install, DNS/OS/registry-upstream/WASM compilation caches uncontrolled; browser CDP throttling does not throttle server-to-server Yarn/MinIO traffic',
    observation: 'window.studio setter attaches read-only subscriber at existing public debug hook before first project open; no app code or network response modification' },
  packageSet: defaultPackageSet, samples: [], medians: {}, serviceRestored: false };
const persist = async () => {
  for (const mode of modes) output.medians[mode.name] = Object.fromEntries(['missMs', 'hitMs', 'editMs'].map(key => {
    const values = output.samples.filter((s: any) => s.network === mode.name).map((s: any) => s[key]).filter((n: any) => typeof n === 'number').sort((a: number, b: number) => a - b);
    return [key, values.length === 3 ? values[1] : null];
  }));
  await writeFile(path.join(out, 'results.json'), JSON.stringify(output, null, 2) + '\n');
};
const api = async (url: string, body?: any, method = body ? 'POST' : 'GET') => {
  const response = await fetch(url, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Fixture API ${new URL(url).pathname}: HTTP ${response.status}`);
  return response.json();
};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const pid = Number(process.argv.find(a => a.startsWith('--replace-builder-pid='))?.split('=')[1]);
if (!Number.isInteger(pid) || pid <= 1) throw new Error('Explicit current 7100 listener PID required; inspect lsof and ps first.');
const listeners = execFileSync('lsof', ['-t', '-iTCP:7100', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n').map(Number);
if (!listeners.includes(pid)) throw new Error('PID is not the current dependency service listener');
const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
if (!command.includes('/toss-toi-test/services/deps-builder/') || !command.includes('src/main.ts')) throw new Error('Unexpected listener; refusing replacement');
const activeTests = execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' }).split('\n').filter(x => /(?:playwright test|tsx run\.ts)/.test(x));
if (activeTests.length) throw new Error('Concurrent E2E/benchmark process detected');
await mkdir(scratch, { recursive: true });
await mkdir(out, { recursive: true });
let stopped = false; let browser: any;
try {
  process.kill(pid, 'SIGTERM'); stopped = true;
  for (let i = 0; i < 100; i++) { try { await fetch('http://localhost:7100/healthz'); } catch { break; } await delay(100); }
  browser = await chromium.launch({ channel: 'chrome', headless: true }); output.environment.chrome = browser.version();
  for (const mode of modes) for (let repeat = 1; repeat <= 3; repeat++) {
    const sample: any = { network: mode.name, repeat }; output.samples.push(sample);
    const store = new MinioStore('toi-cmp1-' + randomUUID()); await store.init();
    const cacheRoot = await mkdtemp(path.join(scratch, 'builder-'));
    const builder = new PackageBuilder(store, { cacheRoot, publicUrl: 'http://localhost:7100' });
    const server = createApp(builder); await new Promise<void>(resolve => server.listen(7100, '0.0.0.0', resolve));
    try {
      const created = await api('http://localhost:7400/projects', { name: `CMP1 ${mode.name} ${repeat}`, apiIds: ['customers'] });
      const project = await api(`http://localhost:7400/projects/${created.projectId}/source`, { baseRevision: created.revision,
        files: { '/src/main.tsx': main, '/src/App.tsx': app(true) }, packageSet: defaultPackageSet }, 'PUT');
      sample.projectId = project.projectId;
      for (const kind of ['miss', 'hit']) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable'); await cdp.send('Network.clearBrowserCache');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: mode.latency, downloadThroughput: mode.downloadThroughput, uploadThroughput: mode.uploadThroughput });
        const statuses: number[] = [];
        page.on('pageerror', (error: any) => console.error('browser error', error.message));
        page.on('response', (r: any) => { if (r.url() === 'http://localhost:7100/package-sets' && r.request().method() === 'POST') statuses.push(r.status()); });
        await context.addInitScript({ content: `(() => {
          if (window !== window.top) return;
          const w = window; let controller;
          w.cmp1Commits = []; w.cmp1Failures = [];
          Object.defineProperty(w, 'studio', { configurable: true, get: () => controller, set(value) {
            controller = value; let previous; let failureCount = 0;
            controller.subscribe(() => { const state = controller.getSnapshot();
              if (state.lastCommit && state.lastCommit !== previous) { previous = state.lastCommit;
                w.cmp1Commits.push({ at: performance.now(), revision: previous.token.revision, timings: previous.timings }); }
              const failures = state.events.filter(e => e.type === 'build_failed' || e.type === 'runtime_failed');
              if (failures.length > failureCount) { failureCount = failures.length; w.cmp1Failures.push({ at: performance.now(), type: failures.at(-1).type }); }
              if (state.previewError && !w.cmp1Failures.some(f => f.type === 'dependency_failed')) w.cmp1Failures.push({ at: performance.now(), type: 'dependency_failed' });
            });
          } });
        })();` });
        try {
          await page.goto(`http://localhost:5173/?project=${project.projectId}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
          console.log('navigation', mode.name, repeat, kind, await page.evaluate(() => ({ hook: !!(window as any).studio, title: document.title, status: document.querySelector('footer .status')?.textContent })));
          await page.waitForFunction(() => (window as any).cmp1Commits.length || (window as any).cmp1Failures.length, null, { timeout: 180000, polling: 10 });
          const observed = await page.evaluate(() => ({ commits: (window as any).cmp1Commits, failures: (window as any).cmp1Failures }));
          if (observed.failures.length || !observed.commits.length) throw new Error(`Preview failed: ${JSON.stringify(observed.failures)}`);
          sample[kind + 'Ms'] = observed.commits[0].at;
          sample[kind + 'Timings'] = observed.commits[0].timings;
          sample[kind + 'PostStatuses'] = [...statuses];
          if (statuses.length !== 1 || statuses[0] !== (kind === 'miss' ? 202 : 200)) throw new Error(`Unexpected ${kind} status ${statuses}`);
          const frame = page.frames().find((f: any) => f.url().includes('5174/frame.html'));
          if (await frame.getByRole('heading', { name: marker, exact: true }).count() !== 1) throw new Error('Committed fixture marker missing');
          sample[kind + 'Resources'] = await page.evaluate(() => performance.getEntriesByType('resource').map((e: any) => ({ name: new URL(e.name).pathname, duration: e.duration, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize })));
          sample[kind + 'WorkerResources'] = await Promise.all(page.workers().map((w: any) => w.evaluate(() => performance.getEntriesByType('resource').map((e: any) => ({ name: new URL(e.name).pathname, duration: e.duration, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize })))));
          if (kind === 'hit') {
            await page.evaluate((content: string) => { const w = window as any; w.cmp1EditStart = performance.now(); w.studio.select('/src/App.tsx'); w.studio.edit(content); void w.studio.saveFiles(); }, app(true, marker + ' 수정'));
            await page.waitForFunction(() => (window as any).cmp1Commits.length === 2 || (window as any).cmp1Failures.length, null, { timeout: 180000, polling: 10 });
            const edit = await page.evaluate(() => { const w = window as any; return { duration: w.cmp1Commits[1]?.at - w.cmp1EditStart, commit: w.cmp1Commits[1], failures: w.cmp1Failures }; });
            if (!Number.isFinite(edit.duration) || edit.failures.length || edit.commit.revision !== project.revision + 1) throw new Error('Edit failed');
            sample.editMs = edit.duration; sample.editTimings = edit.commit.timings; sample.editPostStatuses = statuses.slice(1);
            const editedFrame = page.frames().find((f: any) => f.url().includes('5174/frame.html'));
            if (await editedFrame.getByRole('heading', { name: marker + ' 수정', exact: true }).count() !== 1) throw new Error('Edited fixture marker missing');
          }
        } catch (error) {
          sample[kind + 'Diagnostic'] = await page.evaluate(() => ({ title: document.title, status: document.querySelector('footer .status')?.textContent,
            hookPresent: !!(window as any).studio, commitCount: (window as any).cmp1Commits?.length,
            eventTypes: (window as any).studio?.getSnapshot().events.map((e: any) => e.type) })).catch(() => ({ unavailable: true }));
          throw error;
        } finally { await context.close(); await persist(); }
      }
      sample.builderMetrics = { ...builder.metrics }; sample.success = true;
      console.log(mode.name, repeat, JSON.stringify({ missMs: sample.missMs, hitMs: sample.hitMs, editMs: sample.editMs }));
    } catch (error) { sample.error = String(error); throw error; }
    finally {
      await Promise.all(builder.builds.values()); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      const objects: string[] = []; for await (const object of store.client.listObjectsV2(store.bucket, '', true)) if (object.name) objects.push(object.name);
      if (objects.length) await store.client.removeObjects(store.bucket, objects);
      await store.client.removeBucket(store.bucket); await rm(cacheRoot, { recursive: true, force: true }); await persist();
    }
  }
} finally {
  await browser?.close();
  if (stopped) {
    const log = await open(path.join(scratch, 'restored-builder.log'), 'a');
    const child = spawn(process.execPath, [path.join(root, 'services/deps-builder/node_modules/tsx/dist/cli.mjs'), 'src/main.ts'], { cwd: path.join(root, 'services/deps-builder'), detached: true, stdio: ['ignore', log.fd, log.fd] });
    child.unref(); await log.close();
    for (let i = 0; i < 100; i++) { try { const response = await fetch('http://localhost:7100/healthz'); if (response.ok) { output.serviceRestored = true; break; } } catch {} await delay(100); }
  }
  await persist();
  if (!output.serviceRestored) throw new Error('Original dependency service could not be restored; inspect scratch restored-builder.log');
}
