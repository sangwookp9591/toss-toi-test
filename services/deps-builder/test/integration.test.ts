import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import type { PackageSetStatus } from '../../../contracts/src/package-set.js';
import { previewOriginForProject } from '../../../contracts/src/runtime.js';
import { PackageBuilder } from '../src/builder.js';
import { createApp } from '../src/server.js';
import { MinioStore } from '../src/store.js';
import { defaultProfile, serviceRoot, settings } from '../src/config.js';
import { canonicalJson, sha256 } from '../src/hash.js';
import { install } from '../src/installer.js';
import { listen, close } from './helpers.js';

const request = { entries: ['react', 'react/jsx-runtime', 'react-dom/client', '@toi/tds'], dependencies: { react: '19.3.0', 'react-dom': '19.3.0', '@toi/tds': '1.0.0' } };
const previewOrigin = previewOriginForProject('00000000-0000-4000-8000-000000000000');

test('real Verdaccio auth, MinIO atomic publication, cache, retries, integrity and Chrome singleton', { timeout: 240000 }, async t => {
  assert.ok(settings().token, 'Run npm run setup-registry first');
  const store = new MinioStore(`toi-test-${randomUUID()}`); await store.init();
  const profile = { ...defaultProfile(), configDigest: sha256(randomUUID()) };
  const events: string[] = [], logs: string[] = [];
  let releaseUpload!: () => void, markUpload!: () => void;
  const uploading = new Promise<void>(resolve => { markUpload = resolve; });
  const gate = new Promise<void>(resolve => { releaseUpload = resolve; });
  let shouldBlock = true, shouldFail = false;
  const builder = new PackageBuilder(store, { profile, onEvent: event => events.push(event), log: line => logs.push(line), beforeUpload: async filename => {
    if (shouldFail) { shouldFail = false; throw new Error(`Deliberate failure ${settings().token}`); }
    if (shouldBlock && filename !== 'manifest.json') { shouldBlock = false; markUpload(); await gate; }
  } });
  const server = createApp(builder), base = await listen(server); builder.publicUrl = base;
  const post = (body = request) => fetch(`${base}/package-sets`, { method: 'POST', body: JSON.stringify(body) });
  let ready: Extract<PackageSetStatus, { status: 'ready' }>;
  try {
    await t.test('anonymous metadata and Yarn install fail; authenticated install succeeds', async () => {
      const metadata = await fetch(`${settings().registry}/@toi%2ftds`); assert.ok([401, 404].includes(metadata.status));
      await mkdir(path.join(serviceRoot, '.cache'), { recursive: true });
      const authCache = await mkdtemp(path.join(serviceRoot, '.cache/auth-test-'));
      try { await assert.rejects(install(request, { registry: settings().registry, token: '', cacheRoot: authCache }), /authentication|YN0041|YN0033|401/i); }
      finally { await rm(authCache, { recursive: true, force: true }); }
      const installed = await install(request, { registry: settings().registry, token: settings().token });
      assert.ok(installed.lock.toString().includes('@toi/tds')); await installed.cleanup();
    });
    await t.test('5 concurrent cache misses build once and expose no manifest during upload', async () => {
      const replies = await Promise.all(Array.from({ length: 5 }, () => post()));
      assert.ok(replies.every(reply => reply.status === 202));
      const bodies = await Promise.all(replies.map(reply => reply.json())) as PackageSetStatus[];
      assert.equal(new Set(bodies.map(body => body.artifactKey)).size, 1);
      await uploading;
      const key = bodies[0].artifactKey;
      assert.equal(builder.metrics.builds, 1); assert.equal(builder.metrics.installs, 1);
      assert.equal(await store.get(`${key}/manifest.json`), undefined);
      assert.equal((await (await fetch(`${base}/package-sets/${key}`)).json()).status, 'building');
      assert.equal((await fetch(`${base}/assets/${key}/manifest.json`)).status, 404);
      assert.equal((await (await fetch(`${base}/package-sets/${key}/wait?timeoutMs=1`)).json()).status, 'building');
      releaseUpload();
      const result = await (await fetch(`${base}/package-sets/${key}/wait?timeoutMs=30000`)).json();
      assert.equal(result.status, 'ready'); ready = result;
      assert.equal(events.at(-1), 'manifest-published');
      assert.equal(events.filter(event => event === 'asset-verified').length, ready.manifest.files.length);
    });
    await t.test('warm POST hits, SHA256s and manifest digest match, assets stream with restricted CORS', async () => {
      const hit = await post(); assert.equal(hit.status, 200); assert.equal(builder.metrics.builds, 1);
      assert.equal(ready.manifestDigest, sha256(canonicalJson(ready.manifest)));
      for (const file of ready.manifest.files) {
        const response = await fetch(ready.manifest.assetBaseUrl + file.path, { headers: { Origin: previewOrigin } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), previewOrigin);
        assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        const body = Buffer.from(await response.arrayBuffer()); assert.equal(body.length, file.bytes); assert.equal(sha256(body), file.sha256);
        assert.ok(!body.toString().includes(settings().token));
      }
      assert.ok(!JSON.stringify(ready).includes(settings().token));
      const legacy = await fetch(ready.manifestUrl, { headers: { Origin: 'http://localhost:5174' } });
      assert.equal(legacy.status, 403); assert.equal(legacy.headers.get('access-control-allow-origin'), null);
      const denied = await fetch(ready.manifestUrl, { headers: { Origin: 'http://evil.example' } }); assert.equal(denied.headers.get('access-control-allow-origin'), null);
      const allowed = await fetch(ready.manifestUrl, { headers: { Origin: 'http://localhost:5173' } }); assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    });
    await t.test('fresh service instance finds persisted manifest without installing', async () => {
      const restarted = new PackageBuilder(store, { profile, publicUrl: base });
      const restartedServer = createApp(restarted), restartedBase = await listen(restartedServer);
      try {
        const response = await fetch(`${restartedBase}/package-sets`, { method: 'POST', body: JSON.stringify(request) });
        assert.equal(response.status, 200); assert.equal((await response.json()).artifactKey, ready.artifactKey);
        assert.deepEqual(restarted.metrics, { installs: 0, builds: 0 });
      } finally { await close(restartedServer); }
    });
    await t.test('version change has new key; failed build has masked log and retries successfully', async () => {
      shouldFail = true;
      const updated = { ...request, dependencies: { ...request.dependencies, '@toi/tds': '1.1.0' } };
      const initial = await (await post(updated)).json(); assert.notEqual(initial.artifactKey, ready.artifactKey);
      assert.equal((await builder.wait(initial.artifactKey, 30000))?.status, 'failed');
      assert.equal(await store.get(`${initial.artifactKey}/manifest.json`), undefined);
      assert.ok(logs.some(line => line.includes('[REDACTED]'))); assert.ok(logs.every(line => !line.includes(settings().token)));
      const retry = await post(updated); assert.equal(retry.status, 202);
      assert.equal((await builder.wait(initial.artifactKey, 30000))?.status, 'ready');
    });
    await t.test('Chrome uses one React and one TDS Context across app hooks and consumers', async () => {
      const html = `<!doctype html><div id="root"></div><script type="importmap">${JSON.stringify(ready.manifest.importMap)}</script><script type="module">
        import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
        import {ToastProvider,useToast,Button,reactInstance} from '@toi/tds';
        window.identity = React === (reactInstance.default ?? reactInstance);
        function Sender(){const {toast}=useToast(); const [n,setN]=useState(0);return React.createElement(Button,{id:'send',onClick:()=>{setN(n+1);toast('shared-'+(n+1));}},'count-'+n);}
        function Reader(){const {messages}=useToast();return React.createElement('output',{id:'reader'},messages.join(','));}
        createRoot(document.getElementById('root')).render(React.createElement(ToastProvider,null,React.createElement(Sender),React.createElement(Reader)));
      </script>`;
      const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
      try {
        const context = await browser.newContext();
        const cdp = await browser.newBrowserCDPSession();
        const { browserContextIds } = await cdp.send('Target.getBrowserContexts');
        await cdp.send('Browser.setPermission', { permission: { name: 'loopback-network' }, setting: 'granted', origin: previewOrigin, browserContextId: browserContextIds[0] });
        const page = await context.newPage(), errors: string[] = [];
        page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(10000);
        page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        // Supply only the harness document; dependency requests still reach the
        // real builder and exercise its CORS from the project's browser origin.
        await page.route(previewOrigin + '/__deps-singleton', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto(previewOrigin + '/__deps-singleton');
        assert.equal(await page.evaluate(() => location.origin), previewOrigin);
        try { await page.locator('#send').click(); } catch (error) { throw new Error(`Singleton page failed: ${errors.join(' | ')}; ${String(error)}`); }
        await page.waitForFunction(() => document.querySelector('#reader')?.textContent === 'shared-1');
        assert.equal(await page.locator('#send').innerText(), 'count-1');
        assert.equal(await page.evaluate('window.identity'), true); assert.deepEqual(errors, []);
        await mkdir(path.join(serviceRoot, 'bench'), { recursive: true });
        await writeFile(path.join(serviceRoot, 'bench/singleton-results.json'), JSON.stringify({ browser: browser.version(), artifactKey: ready.artifactKey, reactIdentity: true, hookClick: true, sharedContext: true, errors }, null, 2) + '\n');
      } finally { await browser.close(); }
    });
  } finally {
    releaseUpload(); await Promise.all(builder.builds.values()); await close(server);
    const objects: string[] = []; for await (const object of store.client.listObjectsV2(store.bucket, '', true)) if (object.name) objects.push(object.name);
    if (objects.length) await store.client.removeObjects(store.bucket, objects); await store.client.removeBucket(store.bucket);
  }
});
