import { test, expect, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuditChain, canonicalJson, zeroHash, type AuditInput } from '../src/audit.js';
import { MemoryObjects } from './object-fixture.js';
import { PolicyStorage } from '../src/storage.js';
import { configuration } from '../src/config.js';
import { createPolicyProxy } from '../src/server.js';
import { identityConfig, token } from './identity-fixture.js';
const input: AuditInput = { action: 'proxy', ts: new Date().toISOString(), user: 'alice', projectId: 'p', apiId: 'customers', method: 'GET', path: '/customers', status: 200, maskedFields: [], decision: 'allowed' };
async function fixture(run: (chain: AuditChain, objects: MemoryObjects, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'f3-anchors-')), objects = new MemoryObjects(), chain = new AuditChain(dir, objects);
  try { await chain.init(); await run(chain, objects, dir); } finally { chain.close(); vi.useRealTimers(); await rm(dir, { recursive: true, force: true }); }
}
test('R3 clean line-boundary tail truncation below an anchor fails closed after restart without segments', () => fixture(async (chain, objects, dir) => {
  for (let i = 0; i < 5; i++) await chain.append(input);
  await chain.anchor(); chain.close();
  expect((await objects.list('audit/segments/')).length).toBe(0);
  const file = path.join(dir, 'audit.jsonl'), lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
  await writeFile(file, lines.slice(0, 3).join('\n') + '\n');
  const restarted = new AuditChain(dir, objects);
  try { await restarted.init(); expect(restarted.health.brokenAt).toBe(4); await expect(restarted.append(input)).rejects.toMatchObject({ code: 'AUDIT_CHAIN_BROKEN' }); } finally { restarted.close(); }
}));
test('anchor hash mismatch and duplicate sequence latch brokenAt', () => fixture(async (chain, objects, dir) => {
  await chain.append(input); await chain.anchor(); chain.close();
  const key = `audit/anchors/${'1'.padStart(20, '0')}-${zeroHash}`;
  await objects.put(key, Buffer.from(canonicalJson({ seq: 1, hash: zeroHash }) + '\n'));
  const restarted = new AuditChain(dir, objects);
  try { await restarted.init(); expect(restarted.health.brokenAt).toBe(1); } finally { restarted.close(); }
}));
test('startup anchors an existing valid chain with no external anchors', () => fixture(async (chain, objects, dir) => {
  await chain.append(input); chain.close();
  const restarted = new AuditChain(dir, objects);
  try { await restarted.init(); expect(restarted.health.anchorSeq).toBe(1); expect(restarted.health.anchoredThrough).toBe(1); } finally { restarted.close(); }
}));
test.each(['download-create', 'download-fetch', 'approval'] as const)('%s waits for its immutable anchor before append resolves', action => fixture(async (chain, objects) => {
  const put = objects.put.bind(objects); let release!: () => void;
  const held = new Promise<void>(r => { release = r; }); let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  objects.put = async (key, data) => { if (key.startsWith('audit/anchors/')) { entered(); await held; } await put(key, data); };
  let settled = false; const pending = chain.append({ ...input, action }).then(() => { settled = true; });
  await started; expect(settled).toBe(false); release(); await pending;
  expect(chain.health.anchorSeq).toBe(1); expect((await objects.list('audit/anchors/')).length).toBe(1);
}));
test('anchors at 50 records and within the one-second timer', () => fixture(async (chain, objects) => {
  for (let i = 0; i < 50; i++) await chain.append(input);
  expect(chain.health.anchorSeq).toBe(50);
  await chain.append(input);
  await vi.waitFor(() => expect(chain.health.anchorSeq).toBe(51), { timeout: 1800, interval: 20 });
  expect((await objects.list('audit/segments/')).length).toBe(0);
}));
test('anchor outage degrades after 5 seconds, rejects after 30 seconds and recovers through retry', () => fixture(async (chain, objects) => {
  await chain.append(input); chain.close(); vi.useFakeTimers({ toFake: ['Date'] });
  objects.fail = true; await expect(chain.anchor()).rejects.toMatchObject({ code: 'AUDIT_ANCHOR_UNAVAILABLE' });
  expect(chain.health.degraded).toBe(false); vi.setSystemTime(Date.now() + 5001); expect(chain.health.degraded).toBe(true);
  await chain.append(input); vi.setSystemTime(Date.now() + 25000);
  expect(() => chain.assertHealthy()).toThrow('AUDIT_ANCHOR_UNAVAILABLE');
  await expect(chain.append(input)).rejects.toMatchObject({ status: 503, code: 'AUDIT_ANCHOR_UNAVAILABLE' });
  objects.fail = false; await chain.anchor(); expect(chain.health.degraded).toBe(false); expect(chain.health.anchorSeq).toBe(2); await chain.append(input);
}));
test('critical record fails its response immediately when anchoring fails', () => fixture(async (chain, objects) => {
  objects.fail = true;
  await expect(chain.append({ ...input, action: 'approval' })).rejects.toMatchObject({ code: 'AUDIT_ANCHOR_UNAVAILABLE' });
  expect(chain.health.lastSeq).toBe(1); expect(chain.health.anchorSeq).toBe(0);
  objects.fail = false; await chain.anchor(); expect(chain.health.anchorSeq).toBe(1);
}));
test('latest anchor search bounds each listing and does not trust only the first page', () => fixture(async (chain, objects, dir) => {
  for (let i = 0; i < 120; i++) await chain.append({ ...input, action: 'approval' }); chain.close();
  const list = objects.list.bind(objects); const counts: number[] = [];
  objects.list = async (prefix, options) => { if (prefix.startsWith('audit/anchors/')) { expect(options?.maxKeys).toBeLessThanOrEqual(2); counts.push(options!.maxKeys!); } return list(prefix, options); };
  const restarted = new AuditChain(dir, objects);
  try { await restarted.init(); expect(restarted.health.anchorSeq).toBe(120); expect(counts.length).toBeLessThan(25); } finally { restarted.close(); }
}));
test('HTTP health and admission report anchor failure and recovery; verify reports anchor sequence', () => fixture(async (chain, objects, dir) => {
  chain.close(); const store = new PolicyStorage(dir, objects); await store.init(); store.chain.close();
  const server = createPolicyProxy({ ...configuration({ NODE_ENV: 'test' }), ...identityConfig }, store);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await store.append(input); objects.fail = true; vi.useFakeTimers({ toFake: ['Date'] });
    await expect(store.chain.anchor()).rejects.toThrow(); vi.setSystemTime(Date.now() + 5001);
    expect((await (await fetch(base + '/healthz')).json()).status).toBe('degraded');
    vi.setSystemTime(Date.now() + 25000);
    const denied = await fetch(base + '/apis'); expect(denied.status).toBe(503); expect((await denied.json()).error).toBe('AUDIT_ANCHOR_UNAVAILABLE');
    const critical = await fetch(base + '/downloads'); expect((await critical.json()).error).toBe('AUDIT_ANCHOR_UNAVAILABLE');
    objects.fail = false; await store.chain.anchor(); vi.useRealTimers();
    expect((await (await fetch(base + '/healthz')).json()).status).toBe('ok');
    const verified = await fetch(base + '/audit/verify', { headers: { Authorization: 'Bearer ' + await token('root', ['platform-admin']) } });
    expect(verified.status).toBe(200); expect(await verified.json()).toMatchObject({ anchorSeq: 1, anchoredThrough: 1 });
  } finally { store.chain.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}));
test('a valid remote anchor with the wrong local hash fails closed without duplicate keys', () => fixture(async (chain, objects, dir) => {
  await chain.append(input); chain.close();
  const key = `audit/anchors/${'1'.padStart(20, '0')}-${zeroHash}`;
  await objects.put(key, Buffer.from(canonicalJson({ seq: 1, hash: zeroHash }) + '\n'));
  const restarted = new AuditChain(dir, objects);
  try { await restarted.init(); expect(restarted.health).toMatchObject({ anchorSeq: 1, anchoredThrough: 0, brokenAt: 1 }); } finally { restarted.close(); }
}));
test('startup outage never treats unknown anchors as empty, and recovery detects a missing tail', () => fixture(async (chain, objects, dir) => {
  for (let i = 0; i < 5; i++) await chain.append(input); await chain.anchor(); chain.close();
  const file = path.join(dir, 'audit.jsonl'); await writeFile(file, (await readFile(file, 'utf8')).trimEnd().split('\n').slice(0, 3).join('\n') + '\n');
  objects.fail = true; const restarted = new AuditChain(dir, objects);
  try {
    await restarted.init(); await expect(restarted.append(input)).rejects.toMatchObject({ code: 'AUDIT_ANCHOR_UNAVAILABLE' });
    objects.fail = false; await expect(restarted.anchor()).rejects.toMatchObject({ code: 'AUDIT_CHAIN_BROKEN' });
    expect(restarted.health).toMatchObject({ brokenAt: 4, anchorSeq: 5 }); expect((await objects.list('audit/anchors/')).length).toBe(1);
  } finally { restarted.close(); }
}));
test('shutdown attempts pending segments even when the external anchor write fails', () => fixture(async (chain, objects) => {
  await chain.append(input);
  const put = objects.put.bind(objects); objects.put = async (key, data) => { if (key.startsWith('audit/anchors/')) throw new Error('Anchor outage'); await put(key, data); };
  await expect(chain.shutdown()).rejects.toMatchObject({ code: 'AUDIT_ANCHOR_UNAVAILABLE' });
  expect(chain.health.replicationPending).toBe(0); expect((await objects.list('audit/segments/')).length).toBe(1);
}));
test('shutdown drains all segment batches including the final partial segment', () => fixture(async (chain, objects, dir) => {
  for (let i = 0; i < 7; i++) await chain.append(input); chain.close();
  const restarted = new AuditChain(dir, objects, 2);
  try { await restarted.init(); await restarted.shutdown(); expect(restarted.health).toMatchObject({ anchorSeq: 7, replicationPending: 0 }); expect((await objects.list('audit/segments/')).length).toBe(4); } finally { restarted.close(); }
}));
