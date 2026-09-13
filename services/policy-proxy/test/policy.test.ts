import { beforeAll, afterAll, test, expect } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { createMockBackend } from '../../mock-backend/src/server.js';
import { createPolicyProxy } from '../src/server.js';
import { PolicyStorage } from '../src/storage.js';
import { configuration, serviceRoot, type PolicyConfig } from '../src/config.js';
import { seedRegistry } from '../src/seed.js';
import { signToken } from '../src/tokens.js';
import { maskJson } from '../src/mask.js';
import { configureToiFetch, clearToiFetch, toiFetch, ToiForbiddenError, ToiReasonRequiredError } from '../client/toi-fetch.js';
import type { RegisteredApi, CapabilityClaims, AuditRecord } from '../../../contracts/src/policy.js';
const listen = (server: Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
const close = (server: Server) => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
let mock: Server, proxy: Server, base: string, upstream: string, store: PolicyStorage, cfg: PolicyConfig, dataDir: string;
let viewer: string, editor: string, admin: string, outsider: string, other: string, read: string, write: string, readClaims: CapabilityClaims;
const send = (url: string, token?: string, value?: unknown) => fetch(base + url, { method: value === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) });
const session = async (user: string, roles: string[]) => (await (await send('/dev/session', roles.includes('platform-admin') ? cfg.devAdminToken : undefined, { user, roles })).json()).token as string;
const cap = async (token: string, value: Record<string, unknown> = {}) => (await (await send('/capabilities', token, { projectId: 'test-project', env: 'preview', ttlSec: 300, ...value })).json());
function call(options: { session?: string | null; cap?: string; project?: string; api?: string; path?: string; method?: string; reason?: string | null; extra?: Record<string, string> } = {}) {
  return fetch(`${base}/proxy/${options.api ?? 'customers'}${options.path ?? '/customers?size=20'}`, { method: options.method ?? 'GET', headers: { ...(options.session === null ? {} : { Authorization: `Bearer ${options.session ?? viewer}` }), 'X-Toi-Capability': options.cap ?? read, 'X-Toi-Project': options.project ?? 'test-project', ...(options.reason === null ? {} : { 'X-Toi-Reason': encodeURIComponent(options.reason ?? '고객 문의 응대') }), ...options.extra }, body: options.method === 'PATCH' ? JSON.stringify({ status: 'suspended' }) : undefined });
}
beforeAll(async () => {
  await mkdir(path.join(serviceRoot, '.cache'), { recursive: true }); dataDir = await mkdtemp(path.join(serviceRoot, '.cache/policy-test-'));
  mock = createMockBackend('test-upstream-secret-very-private'); upstream = await listen(mock);
  cfg = { ...configuration(), dataDir, upstreamUrl: upstream, upstreamAllowlist: [upstream], upstreamToken: 'test-upstream-secret-very-private', sessionSecret: 'test-session-signing-secret', capabilitySecret: 'test-capability-signing-secret', devAuth: true, devAdminToken: 'test-admin-bootstrap-token' };
  store = new PolicyStorage(dataDir); await store.init(); await seedRegistry(store, cfg);
  proxy = createPolicyProxy(cfg, store); base = await listen(proxy);
  viewer = await session('viewer-user', ['viewer']); editor = await session('editor-user', ['editor']); admin = await session('admin-user', ['platform-admin']); outsider = await session('outsider-user', []); other = await session('other-viewer', ['viewer']);
  const readResponse = await cap(viewer); read = readResponse.token; readClaims = readResponse.claims;
  write = (await cap(editor, { mode: 'write', apiIds: ['customers'] })).token;
}, 15000);
afterAll(async () => { clearToiFetch(); await close(proxy); await close(mock); await rm(dataDir, { recursive: true, force: true }); });

test('decision order and every denial are audited', async () => {
  const expired = signToken({ ...readClaims, exp: Math.floor(Date.now() / 1000) - 1 }, cfg.capabilitySecret, 'capability');
  const forged = signToken(readClaims, 'wrong-key', 'capability');
  const wrongApi = (await cap(editor, { mode: 'write', apiIds: ['orders'] })).token;
  const readonlyEditor = (await cap(editor)).token;
  const cases: [Parameters<typeof call>[0], number, string][] = [
    [{ session: null, api: 'missing' }, 401, 'SESSION_REQUIRED'],
    [{ api: 'missing', session: outsider }, 404, 'API_NOT_FOUND'],
    [{ session: outsider, cap: forged }, 403, 'ROLE_FORBIDDEN'],
    [{ cap: forged }, 403, 'CAPABILITY_INVALID'],
    [{ cap: expired }, 403, 'CAPABILITY_INVALID'],
    [{ project: 'other-project' }, 403, 'CAPABILITY_INVALID'],
    [{ session: other }, 403, 'CAPABILITY_INVALID'],
    [{ extra: { 'X-Toi-Env': 'live' } }, 403, 'ENV_MISMATCH'],
    [{ method: 'PATCH', path: '/customers/C001', reason: null }, 403, 'WRITE_FORBIDDEN'],
    [{ method: 'PATCH', path: '/customers/C001', session: editor, cap: readonlyEditor }, 403, 'WRITE_FORBIDDEN'],
    [{ method: 'PATCH', path: '/customers/C001', session: editor, cap: wrongApi }, 403, 'WRITE_FORBIDDEN'],
    [{ reason: null }, 428, 'REASON_REQUIRED'],
  ];
  const before = (await store.audit(undefined, 1000)).length;
  for (const [options, status, code] of cases) { const response = await call(options); expect(response.status).toBe(status); expect((await response.json()).error).toBe(code); }
  const audit = (await store.audit(undefined, 1000)).slice(before); expect(audit).toHaveLength(cases.length);
  expect(audit.every(record => record.decision === 'denied')).toBe(true);
  expect(audit.map(record => record.status)).toEqual(cases.map(([, status]) => status));
  expect(audit[0].capability.jti).toBe('unverified');
});

test('masking snapshot includes concrete wildcard pointers and leaves source data intact', async () => {
  const response = await call(); expect(response.status).toBe(200); const data = await response.json(); expect(data.items).toHaveLength(20);
  expect(data.items[0]).toMatchInlineSnapshot(`
    {
      "account": "****-****-1234",
      "email": "ho***@example.com",
      "grade": "standard",
      "id": "C001",
      "name": "홍*동",
      "phone": "010-****-5678",
      "rrn": "900101-*******",
      "status": "active",
    }
  `);
  const audit = (await store.audit('test-project', 1))[0]; expect(audit.decision).toBe('allowed'); expect(audit.maskedFields).toHaveLength(100); expect(audit.maskedFields).toContain('/items/0/phone'); expect(audit.reason).toBe('고객 문의 응대');
  const original = await (await fetch(upstream + '/customers/C001', { headers: { 'X-Service-Token': cfg.upstreamToken } })).json(); expect(original.phone).toBe('010-1000-5678');
  const detail = await (await call({ path: '/customers/C001' })).json(); expect(detail.email).toBe('ho***@example.com');
  const escaped = maskJson({ 'a/b': { '~name': '홍길동' }, items: [{ phone: null }, { phone: '01012345678' }] }, { '/a~1b/~0name': 'name', '/items/*/phone': 'phone' });
  expect(escaped.maskedFields).toEqual(['/a~1b/~0name', '/items/1/phone']);
});

test('N2 seed GET /customers/{id}/orders preserves the actual backend response and ISO dates', async () => {
  const original = await fetch(upstream + '/customers/C002/orders', { headers: { 'X-Service-Token': cfg.upstreamToken } });
  const expected = await original.json();
  const response = await call({ path: '/customers/C002/orders' });
  expect(response.status).toBe(200); expect(await response.json()).toEqual(expected);
  expect(expected.items.map((item: { createdAt: string }) => item.createdAt)).toEqual(['2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', '2026-08-03T00:00:00.000Z']);
  const audit = (await store.audit('test-project', 1))[0];
  expect(audit.maskedFields).toEqual([]); expect(audit.policyWarnings).toEqual(['mask_rules_unmatched']);
});

test('write authorization is re-evaluated for every request and allowWrite is enforced', async () => {
  const allowed = await call({ method: 'PATCH', path: '/customers/C001', session: editor, cap: write }); expect(allowed.status).toBe(200); expect((await allowed.json()).status).toBe('suspended');
  const api = store.apis.get('customers')!; await store.save({ ...api, policy: { ...api.policy, allowWrite: false } });
  try { expect((await call({ method: 'PATCH', path: '/customers/C001', session: editor, cap: write })).status).toBe(403); } finally { await store.save(api); }
  expect((await send('/capabilities', viewer, { projectId: 'test-project', mode: 'write', env: 'preview', ttlSec: 300, apiIds: ['customers'] })).status).toBe(403);
});

test('registry hides upstream data and enforces platform-admin plus destination allowlist', async () => {
  expect((await send('/apis')).status).toBe(401); expect((await send('/apis', viewer)).status).toBe(200);
  const response = await send('/apis/customers', viewer), data = await response.json(); expect(data.upstreamBaseUrl).toBeUndefined(); expect(data.openapi.components.securitySchemes).toBeUndefined();
  const api = store.apis.get('customers')!;
  expect((await send('/apis', viewer, api)).status).toBe(403);
  expect((await send('/apis', admin, { ...api, upstreamBaseUrl: 'http://unapproved.invalid' })).status).toBe(400);
  const registered = await send('/apis', admin, { ...api, apiId: 'customers-copy' }); expect(registered.status).toBe(201);
  const restarted = new PolicyStorage(dataDir); await restarted.init(); expect(restarted.apis.has('customers-copy')).toBe(true);
});

test('service credentials, addresses and identifying headers never escape responses or audit', async () => {
  const leaky = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.setHeader('X-Service-Token', cfg.upstreamToken); res.setHeader('Server', 'private-upstream'); res.setHeader('Location', upstream); res.end(JSON.stringify({ diagnostic: `${cfg.upstreamToken} ${upstream}` })); });
  const leakyUrl = await listen(leaky);
  const api = { ...store.apis.get('customers')!, apiId: 'leaky', upstreamBaseUrl: leakyUrl } as RegisteredApi; await store.save(api);
  try {
    const response = await call({ api: 'leaky', reason: `inspect ${cfg.upstreamToken} ${upstream}` }); expect(response.status).toBe(200);
    const text = await response.text(); expect(text).not.toContain(cfg.upstreamToken); expect(text).not.toContain(upstream);
    for (const name of ['x-service-token', 'server', 'location']) expect(response.headers.get(name)).toBeNull();
    const records = await readFile(path.join(dataDir, 'audit.jsonl'), 'utf8'); for (const secret of [cfg.upstreamToken, upstream, leakyUrl, read, viewer]) expect(records).not.toContain(secret);
    const publicList = await (await send('/apis', viewer)).text(); for (const secret of [upstream, leakyUrl, cfg.upstreamToken]) expect(publicList).not.toContain(secret);
  } finally { await close(leaky); }
  const failed = await call({ api: 'leaky' }); expect(failed.status).toBe(502); expect(await failed.text()).toBe('{"error":"UPSTREAM_UNAVAILABLE"}');
});

test('CORS only permits studio and preview, including X-Toi headers', async () => {
  const allowed = await fetch(base + '/proxy/customers/customers', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5174', 'Access-Control-Request-Headers': 'authorization,x-toi-capability,x-toi-project,x-toi-reason,x-toi-extra' } }); expect(allowed.status).toBe(204); expect(allowed.headers.get('access-control-allow-headers')).toContain('x-toi-extra');
  const blocked = await fetch(base + '/apis', { method: 'OPTIONS', headers: { Origin: 'http://evil.invalid' } }); expect(blocked.status).toBe(403); expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
});

test('dependency-free client attaches host credentials and maps 403 and 428 to typed errors', async () => {
  configureToiFetch({ sessionToken: viewer, capabilityToken: read, projectId: 'test-project', proxyBaseUrl: base });
  await expect(toiFetch('customers', '/customers')).rejects.toBeInstanceOf(ToiReasonRequiredError);
  const response = await toiFetch('customers', '/customers', { reason: '문의 대응 확인' }); expect(response.status).toBe(200);
  await expect(toiFetch('customers', '/customers/C001', { method: 'PATCH', body: JSON.stringify({ status: 'active' }), reason: '정책 거부 확인' })).rejects.toBeInstanceOf(ToiForbiddenError);
  await expect(toiFetch('customers', '/../other/customers')).rejects.toThrow('INVALID_API_PATH');
});

test('real Chrome direct upstream GET is 401 and proxy GET is masked 200', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const context = await browser.newContext(), cdp = await browser.newBrowserCDPSession(); const { browserContextIds } = await cdp.send('Target.getBrowserContexts');
    await cdp.send('Browser.setPermission', { permission: { name: 'loopback-network' }, setting: 'granted', origin: 'http://localhost:5174', browserContextId: browserContextIds[0] });
    const page = await context.newPage(); await page.route('http://localhost:5174/__policy-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Policy test</p>' })); await page.goto('http://localhost:5174/__policy-test');
    const result = await page.evaluate(async ({ upstream, base, viewer, read }) => {
      const direct = await fetch(upstream + '/customers?size=20'); const proxied = await fetch(base + '/proxy/customers/customers?size=20', { headers: { Authorization: `Bearer ${viewer}`, 'X-Toi-Capability': read, 'X-Toi-Project': 'test-project', 'X-Toi-Reason': 'customer support' } });
      const data = await proxied.json(); return { direct: direct.status, proxy: proxied.status, phone: data.items[0].phone, masked: data.items[0].rrn };
    }, { upstream, base, viewer, read });
    expect(result).toEqual({ direct: 401, proxy: 200, phone: '010-****-5678', masked: '900101-*******' });
    await mkdir(path.join(serviceRoot, 'bench'), { recursive: true }); await writeFile(path.join(serviceRoot, 'bench/browser-results.json'), JSON.stringify({ browser: browser.version(), ...result, permission: 'loopback-network granted only to the temporary test context' }, null, 2) + '\n');
  } finally { await browser.close(); }
}, 30000);
