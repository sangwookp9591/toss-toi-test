import { test, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AuditChain, sha256, type AuditInput } from '../src/audit.js';
import { MemoryObjects } from './object-fixture.js';
import { PolicyStorage } from '../src/storage.js';
import { createPolicyProxy } from '../src/server.js';
import { configuration } from '../src/config.js';
import { identityConfig, token } from './identity-fixture.js';
const input: AuditInput = { action: 'proxy', ts: new Date().toISOString(), user: 'alice', projectId: 'p', apiId: 'customers', method: 'GET', path: '/customers', status: 200, maskedFields: [], decision: 'allowed' };
async function fixture(run: (chain: AuditChain, objects: MemoryObjects, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'policy-audit-test-')), objects = new MemoryObjects(), chain = new AuditChain(dir, objects, 1000);
  try { await chain.init(); await run(chain, objects, dir); } finally { chain.close(); await rm(dir, { recursive: true, force: true }); }
}
test('concurrent durable appends have exactly continuous seq and valid chain after restart', () => fixture(async (chain, objects, dir) => {
  await Promise.all(Array.from({ length: 100 }, () => chain.append(input)));
  const records = await chain.read(undefined, 1000); expect(records.map(r => r.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1)); expect((await chain.verify()).ok).toBe(true);
  await chain.flush(true); expect((await objects.list('audit/segments/')).length).toBe(1); expect(chain.health.replicationPending).toBe(0);
  const restarted = new AuditChain(dir, objects); try { await restarted.init(); expect(restarted.health.lastSeq).toBe(100); expect(restarted.health.ok).toBe(true); } finally { restarted.close(); }
}));
test('modified local line and truncation latch brokenAt and prevent appends', () => fixture(async (chain, _objects, dir) => {
  await chain.append(input); const file = path.join(dir, 'audit.jsonl'); await writeFile(file, (await readFile(file, 'utf8')).replace('alice', 'mallory'));
  expect((await chain.verify()).brokenAt).toBe(1); await expect(chain.append(input)).rejects.toMatchObject({ status: 503, code: 'AUDIT_CHAIN_BROKEN' });
}));
test.each(['modified', 'deleted', 'local-truncation'])('replicated segment %s fails closed at startup', mode => fixture(async (chain, objects, dir) => {
  await chain.append(input); await chain.flush(true);
  const key = (await objects.list('audit/segments/'))[0];
  if (mode === 'modified') objects.values.set(key, Buffer.from('tampered'));
  else if (mode === 'deleted') objects.values.delete(key);
  else await writeFile(path.join(dir, 'audit.jsonl'), '');
  const restarted = new AuditChain(dir, objects);
  try { await restarted.init(); expect(restarted.health.ok).toBe(false); expect(restarted.health.brokenAt).toBe(1); } finally { restarted.close(); }
}));
test('replication failure reports lag and retries without overwriting existing keys', () => fixture(async (chain, objects) => {
  await chain.append(input); objects.fail = true; await chain.flush(true); expect(chain.health.replicationAvailable).toBe(false); expect(chain.health.ok).toBe(true);
  objects.fail = false; await chain.flush(true); expect(chain.health.replicationPending).toBe(0); const keys = [...objects.values.keys()];
  await expect(objects.put(keys[0], Buffer.from('replacement'))).rejects.toThrow();
}));
test('legacy file is preserved and anchored with its sha256 in first record', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'policy-legacy-test-')), legacy = JSON.stringify(input) + '\n';
  await writeFile(path.join(dir, 'audit.jsonl'), legacy); const chain = new AuditChain(dir);
  try { await chain.init(); expect(chain.health.ok).toBe(true); expect((await chain.read(undefined, 10))[0].legacySha256).toBe(sha256(legacy)); expect(await readdir(dir)).toContain(`audit.legacy.${sha256(legacy)}.jsonl`); }
  finally { chain.close(); await rm(dir, { recursive: true, force: true }); }
});
test('isolated HTTP tamper verification returns brokenAt and all except health reject 503', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'policy-broken-http-')), store = new PolicyStorage(dir); await store.init(); await store.append(input);
  const server = createPolicyProxy({ ...configuration({ NODE_ENV: 'test' }), ...identityConfig, dataDir: dir }, store);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const file = path.join(dir, 'audit.jsonl'); await writeFile(file, (await readFile(file, 'utf8')).replace('alice', 'mallory'));
    const result = await fetch(base + '/audit/verify', { headers: { Authorization: 'Bearer ' + await token('root', ['platform-admin']) } }); expect(result.status).toBe(503); expect((await result.json()).brokenAt).toBe(1);
    for (const endpoint of ['/apis', '/proxy/customers/customers', '/downloads', '/audit/verify']) expect((await fetch(base + endpoint)).status).toBe(503);
    const health = await fetch(base + '/healthz'); expect(health.status).toBe(200); expect((await health.json()).status).toBe('degraded');
  } finally { store.chain.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true }); }
});

test('malformed replica inventory is tampering, not a retryable storage outage', () => fixture(async (chain, objects, dir) => {
  await chain.append(input); await chain.flush(true); await writeFile(path.join(dir, 'audit-segments.json'), '[123]');
  const restarted = new AuditChain(dir, objects);
  try { await restarted.init(); expect(restarted.health.ok).toBe(false); expect(restarted.health.brokenAt).toBe(1); } finally { restarted.close(); }
}));
