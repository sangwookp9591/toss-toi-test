import { test, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Server } from 'node:http';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import ExcelJS from 'exceljs';
import { Downloads, envelopeEncrypt, envelopeDecrypt, csvCell, downloadRows } from '../src/downloads.js';
import type { ObjectStore } from '../src/objects.js';
import { configuration } from '../src/config.js';
import { PolicyStorage } from '../src/storage.js';
import { createPolicyProxy } from '../src/server.js';
import { createMockBackend } from '../../mock-backend/src/server.js';
import { seedRegistry } from '../src/seed.js';
import { member, token, identityConfig } from './identity-fixture.js';
import { previewOriginForProject } from '../../../contracts/src/runtime.js';
import { MemoryObjects } from './object-fixture.js';
const listen = (s: Server) => new Promise<string>(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as {port:number}).port}`)));
const close = (s: Server) => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); });
let dir: string, manager: Downloads, store: PolicyStorage, backend: Server, server: Server, base: string;
const objects = new MemoryObjects(), projectId = '11111111-1111-1111-1111-111111111111';
let alice: string, bob: string, carol: string, admin: string, cap: string;
const keys = { kek: randomBytes(32).toString('hex'), kekId: 'test-v1', urlSecret: randomBytes(32).toString('hex'), retainMs: 86400000 };
const request = (t: string, format = 'csv', extra: Record<string, unknown> = {}, origin = 'http://localhost:5173') => fetch(base + '/downloads', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + t, 'X-Toi-Project': projectId, 'X-Toi-Capability': cap, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, apiId: 'customers', path: '/customers', format, reason: 'customer support report', ...extra }) });
const get = (url: string, t = alice) => fetch(base + url, { headers: { Authorization: 'Bearer ' + t } });
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'policy-download-test-'));
  backend = createMockBackend('preview-token', 'live-token'); const upstream = await listen(backend);
  const config = { ...configuration({ NODE_ENV: 'test' }), ...identityConfig, dataDir: dir, upstreamUrl: upstream, upstreamAllowlist: [upstream + '/preview', upstream + '/live'], upstreamToken: 'preview-token', liveToken: 'live-token', downloads: keys };
  store = new PolicyStorage(dir); await store.init(); await seedRegistry(store, config);
  manager = new Downloads(path.join(dir, 'downloads'), objects, keys); await manager.init();
  server = createPolicyProxy(config, store, undefined, manager); base = await listen(server);
  alice = await token('alice'); bob = await token('bob'); carol = await token('carol'); admin = await token('root', ['platform-admin']);
  member(projectId, 'alice', 'owner'); member(projectId, 'bob', 'viewer');
  const issued = await fetch(base + '/capabilities', { method: 'POST', headers: { Authorization: 'Bearer ' + alice, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, mode: 'read', env: 'preview', ttlSec: 120 }) }); cap = (await issued.json()).token;
});
afterAll(async () => { manager.close(); store.chain.close(); await close(server); await close(backend); await rm(dir, { recursive: true, force: true }); });
test('envelope roundtrip authenticates ciphertext, context and KEK with independent data keys', () => {
  const kek = randomBytes(32), data = Buffer.from('known row value'), a = envelopeEncrypt(data, kek, 'one'), b = envelopeEncrypt(data, kek, 'one');
  expect(envelopeDecrypt(a.ciphertext, a, kek, 'one').equals(data)).toBe(true); expect(a.wrappedDataKey === b.wrappedDataKey).toBe(false);
  expect(() => envelopeDecrypt(a.ciphertext, a, randomBytes(32), 'one')).toThrow(); expect(() => envelopeDecrypt(a.ciphertext, a, kek, 'two')).toThrow();
  const corrupt = Buffer.from(a.ciphertext); corrupt[0] ^= 1; expect(() => envelopeDecrypt(corrupt, a, kek, 'one')).toThrow();
});
test.each(['=1+1', '+SUM(A1)', '-2', '@evil', ' \t=SUM(A1)', '\r+1'])('CSV neutralizes formula prefix %s', value => { expect(csvCell(value).startsWith('"\'')).toBe(true); });
test('CSV escapes quotes and newlines, rows cannot exceed 10000', () => { expect(csvCell('a"b\nc')).toBe('"a""b\nc"'); expect(() => downloadRows(Array.from({ length: 10001 }, () => ({})))).toThrow(); });
test.each(['csv', 'xlsx'])('downloads %s use AE-2 AES-256 with password only, masking, encrypted storage and one-time fetch', async format => {
  const response = await request(alice, format); expect(response.status).toBe(201); const ticket = await response.json();
  expect(ticket.zipPassword.length >= 24).toBe(true);
  const stored = await objects.get(`downloads/${ticket.downloadId}.bin`);
  expect(stored.includes(Buffer.from(ticket.zipPassword))).toBe(false); expect(stored.includes(Buffer.from('C001'))).toBe(false);
  const meta = await readFile(path.join(dir, 'downloads', ticket.downloadId + '.json'), 'utf8'); expect(meta.includes(ticket.zipPassword)).toBe(false);
  const fetched = await get(ticket.url); expect(fetched.status).toBe(200); const zip = new Uint8Array(await fetched.arrayBuffer());
  const reader = new ZipReader(new Uint8ArrayReader(zip), { useWebWorkers: false }); const [entry] = await reader.getEntries();
  if (entry.directory) throw new Error('Unexpected directory');
  expect(entry.encrypted).toBe(true); expect(entry.extraFieldAES?.strength).toBe(3); expect(entry.extraFieldAES?.vendorVersion).toBe(2);
  await expect(entry.getData!(new Uint8ArrayWriter(), { password: 'incorrect' })).rejects.toThrow();
  const data = Buffer.from(await entry.getData!(new Uint8ArrayWriter(), { password: ticket.zipPassword }));
  let text = data.toString('utf8');
  if (format === 'xlsx') { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data as any); text = JSON.stringify(workbook.worksheets[0].getSheetValues()); }
  expect(text.includes('C001')).toBe(true); expect(text.includes('*')).toBe(true); expect(text.includes('010-1234-5678')).toBe(false);
  await reader.close(); expect((await get(ticket.url)).status).toBe(410);
  await manager.cleanup(); expect(objects.values.has(`downloads/${ticket.downloadId}.bin`)).toBe(false); expect(manager.records.get(ticket.downloadId)?.wrappedDataKey).toBe('');
});
test('signature tampering, subject mismatch, expiration and simultaneous use have contract statuses', async () => {
  const ticket = await (await request(alice)).json();
  expect((await get(ticket.url, bob)).status).toBe(404);
  const tamper = new URL(ticket.url, base); tamper.searchParams.set('sig', '0'.repeat(64)); expect((await get(tamper.pathname + tamper.search)).status).toBe(403);
  const raced = await Promise.all([get(ticket.url), get(ticket.url)]); expect(raced.map(r => r.status).sort()).toEqual([200, 410]);
  const expired = await (await request(alice)).json();
  const original = Date.now; Date.now = () => original() + 61000;
  try { expect((await manager.fetch(expired.downloadId, 'alice', new URL(expired.url, base).searchParams.get('exp')!, new URL(expired.url, base).searchParams.get('sig')!)).zip).toBeUndefined(); }
  catch (e) { expect((e as {status:number}).status).toBe(410); } finally { Date.now = original; }
});
test('editor minimum, membership hiding, preview origin and registered GET path are enforced', async () => {
  expect((await request(bob)).status).toBe(403); expect((await request(carol)).status).toBe(404);
  expect((await request(alice, 'csv', {}, previewOriginForProject(projectId))).status).toBe(403);
  expect((await request(alice, 'csv', { reason: 'no' })).status).toBe(400);
  expect((await request(alice, 'csv', { path: '/unregistered' })).status).toBe(404);
  expect((await request(alice, 'csv', { path: '/%252e%252e/customers' })).status).toBe(400);
});
test('preview direct requests are forbidden; studio broker retains project scoping', async () => {
  const p = await fetch(base + '/preview-sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + alice, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) }); const preview = await p.json();
  const headers = { Origin: previewOriginForProject(projectId), Authorization: 'Bearer ' + preview.sessionToken, 'X-Toi-Capability': preview.capabilityToken, 'X-Toi-Project': projectId, 'X-Toi-Reason': 'verification reason' };
  for (const endpoint of ['/proxy/customers/customers', '/healthz', '/audit', '/downloads', '/preview-sessions']) for (const method of ['GET', 'OPTIONS', 'POST']) {
    const direct = await fetch(base + endpoint, { method, headers }); expect(direct.status).toBe(403); expect((await direct.json()).error).toBe('PREVIEW_DIRECT_FORBIDDEN'); expect(direct.headers.get('access-control-allow-origin')).toBeNull();
  }
  expect((await fetch(base + '/proxy/customers/customers', { headers: { ...headers, Origin: 'http://localhost:5173' } })).status).toBe(200);
  const otherProject = '22222222-2222-2222-2222-222222222222'; member(otherProject, 'alice', 'owner');
  const other = await (await fetch(base + '/preview-sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + alice, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: otherProject }) })).json();
  for (const changed of [{ Authorization: 'Bearer ' + other.sessionToken }, { 'X-Toi-Capability': other.capabilityToken }]) {
    const denied = await fetch(base + '/proxy/customers/customers', { headers: { ...headers, ...changed } });
    expect(denied.status).toBe(403); expect((await denied.json()).error).toBe('PREVIEW_DIRECT_FORBIDDEN');
  }
  const mismatch = await fetch(base + '/proxy/customers/customers', { headers: { ...headers, Origin: previewOriginForProject('22222222-2222-2222-2222-222222222222') } });
  expect(mismatch.status).toBe(403); expect((await mismatch.json()).error).toBe('PREVIEW_DIRECT_FORBIDDEN');
  expect((await fetch(base + '/proxy/customers/customers', { headers: { ...headers, Origin: 'http://localhost:5174' } })).status).toBe(403);
});
test('audit verify requires admin and no password, key or URL signature is recorded', async () => {
  const ticket = await (await request(alice)).json(); await get(ticket.url);
  expect((await get('/audit/verify')).status).toBe(403); expect((await get('/audit/verify', admin)).status).toBe(200);
  const audit = await readFile(path.join(dir, 'audit.jsonl'), 'utf8');
  for (const secret of [ticket.zipPassword, keys.kek, keys.urlSecret, new URL(ticket.url, base).searchParams.get('sig')!]) expect(audit.includes(secret)).toBe(false);
  const actions = new Set(audit.trim().split('\n').map(line => JSON.parse(line).action)); for (const a of ['proxy', 'capability', 'preview-session', 'download-create', 'download-fetch', 'membership-denied']) expect(actions.has(a)).toBe(true);
});

test('retention cleanup deletes an unfetched object and restart preserves single-use tombstones', async () => {
  const localDir = path.join(dir, 'retention'), localObjects = new MemoryObjects();
  const short = new Downloads(localDir, localObjects, { ...keys, retainMs: 20 }); await short.init();
  try {
    const ticket = await short.create({ projectId, apiId: 'customers', path: '/customers', format: 'csv', reason: 'retention test' }, 'alice', [{ id: 'row' }], []);
    await new Promise(r => setTimeout(r, 30)); await short.cleanup();
    expect(localObjects.values.size).toBe(0); expect(short.records.get(ticket.downloadId)?.wrappedDataKey === '').toBe(true);
    const restarted = new Downloads(localDir, localObjects, keys); try { await restarted.init(); expect(restarted.records.get(ticket.downloadId)?.wrappedDataKey === '').toBe(true); } finally { restarted.close(); }
  } finally { short.close(); }
});
