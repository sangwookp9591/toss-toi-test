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

test('Z: project A preview session from project B origin returns PREVIEW_ORIGIN_MISMATCH', async ({accounts}) => {
  const alice = await accounts('alice');
  const a = await (await api(alice, '/projects', {name:'Origin A', apiIds:['customers']})).json();
  const b = await (await api(alice, '/projects', {name:'Origin B', apiIds:['customers']})).json();
  const session = await (await api(alice, '/preview-sessions', {projectId:a.projectId}, 'POST', policy)).json();
  const response = await fetch(policy + '/proxy/customers/customers', {headers:{Origin:previewOriginForProject(b.projectId), Authorization:'Bearer ' + session.sessionToken, 'X-Toi-Project':a.projectId, 'X-Toi-Capability':session.capabilityToken, 'X-Toi-Reason':'Origin boundary'}});
  expect(response.status).toBe(403); expect(await response.json()).toMatchObject({error:'PREVIEW_ORIGIN_MISMATCH'});
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
  expect(csp).toContain('connect-src http://localhost:7200;'); expect(csp).toContain('frame-ancestors http://localhost:5173');
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
