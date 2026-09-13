import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { S3Client, CreateBucketCommand, HeadObjectCommand, GetObjectRetentionCommand, DeleteObjectCommand, ListBucketsCommand } from '@aws-sdk/client-s3';
import { S3Objects } from '../src/objects.js';
import { AuditChain, type AuditInput } from '../src/audit.js';
import { configuration } from '../src/config.js';
const name = 'f3-retention-' + randomUUID(), volume = name + '-data';
const accessKeyId = 'f3-test-root', secretAccessKey = randomBytes(32).toString('hex');
let endpoint: string, root: S3Client, dir: string, started = false;
const docker = (args: string[], env?: NodeJS.ProcessEnv) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env, timeout: 30000 }).trim();
const input: AuditInput = { action: 'proxy', ts: new Date().toISOString(), user: 'test', projectId: 'p', apiId: 'a', method: 'GET', path: '/x', status: 200, maskedFields: [], decision: 'allowed' };
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), name));
  docker(['volume', 'create', volume]);
  docker(['run', '--detach', '--name', name, '-p', '127.0.0.1::9000', '-v', volume + ':/data', '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z', 'server', '/data'], { ...process.env, MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey }); started = true;
  const port = docker(['port', name, '9000/tcp']).split(':').at(-1); endpoint = 'http://127.0.0.1:' + port;
  await vi.waitFor(async () => { expect((await fetch(endpoint + '/minio/health/ready')).status).toBe(200); }, { timeout: 15000, interval: 100 });
  root = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
}, 30000);
afterAll(async () => {
  root?.destroy();
  if (started) docker(['rm', '--force', name]);
  // Same Docker volume deletion used by compose down --volumes, despite COMPLIANCE objects.
  docker(['volume', 'rm', volume]);
  expect(() => docker(['volume', 'inspect', volume])).toThrow();
  if (dir) await rm(dir, { recursive: true, force: true });
}, 30000);
test('S3Objects applies COMPLIANCE retention to segments and anchors, denying root version deletion', async () => {
  const Bucket = 'audit-' + randomUUID(); await root.send(new CreateBucketCommand({ Bucket, ObjectLockEnabledForBucket: true }));
  const objects = new S3Objects(endpoint, accessKeyId, secretAccessKey, Bucket, 7), chain = new AuditChain(path.join(dir, 'chain'), objects);
  try {
    await chain.init(); await chain.append(input); await chain.anchor(); await chain.flush(true);
    for (const Key of [...await objects.list('audit/segments/'), ...await objects.list('audit/anchors/')]) {
      const head = await root.send(new HeadObjectCommand({ Bucket, Key }));
      expect(head.ObjectLockMode).toBe('COMPLIANCE'); expect(head.ObjectLockRetainUntilDate!.getTime() - Date.now()).toBeGreaterThan(6.99 * 86400000);
      const retained = await root.send(new GetObjectRetentionCommand({ Bucket, Key, VersionId: head.VersionId })); expect(retained.Retention?.Mode).toBe('COMPLIANCE');
      await expect(root.send(new DeleteObjectCommand({ Bucket, Key, VersionId: head.VersionId, BypassGovernanceRetention: true }))).rejects.toMatchObject({ name: 'InvalidRequest', message: expect.stringContaining('WORM protected'), $metadata: { httpStatusCode: 400 } });
      await expect(objects.put(Key, Buffer.from('replace'))).rejects.toMatchObject({ $metadata: { httpStatusCode: 412 } });
    }
    await objects.put('downloads/probe', Buffer.from('erasable')); const plain = await root.send(new HeadObjectCommand({ Bucket, Key: 'downloads/probe' })); expect(plain.ObjectLockMode).toBeUndefined();
  } finally { chain.close(); }
});
test('provisioning verifies retention in an isolated probe bucket and cleans it after expiration', async () => {
  const { verifyStorageRetention } = await import(new URL('../../../scripts/storage.mjs', import.meta.url).href);
  await verifyStorageRetention({ MINIO_ENDPOINT: endpoint, MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey });
  const buckets = await root.send(new ListBucketsCommand({})); expect(buckets.Buckets?.some(bucket => bucket.Name?.startsWith('toi-retention-probe-'))).toBe(false);
}, 15000);
test.each(['SIGTERM', 'SIGINT'] as const)('%s flushes external head and unreplicated tail before process exit', async signal => {
  const Bucket = 'signal-' + randomUUID(); await root.send(new CreateBucketCommand({ Bucket, ObjectLockEnabledForBucket: true }));
  const childDir = path.join(dir, signal), script = path.join(dir, signal + '.mts');
  await writeFile(script, `import { createServer } from 'node:http';\nimport { AuditChain } from ${JSON.stringify(new URL('../src/audit.ts', import.meta.url).href)};\nimport { S3Objects } from ${JSON.stringify(new URL('../src/objects.ts', import.meta.url).href)};\nimport { installShutdown } from ${JSON.stringify(new URL('../src/shutdown.ts', import.meta.url).href)};\nconst chain = new AuditChain(${JSON.stringify(childDir)}, new S3Objects(process.env.TEST_ENDPOINT, process.env.TEST_USER, process.env.TEST_PASSWORD, ${JSON.stringify(Bucket)}));\nawait chain.init();\nfor (let i=0;i<7;i++) await chain.append(${JSON.stringify(input)});\nconst server = createServer((req,res)=>res.end('ok'));\ninstallShutdown(server,chain,{close(){}});\nserver.listen(0,'127.0.0.1',()=>console.log('READY'));\n`);
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), script], { env: { ...process.env, TEST_ENDPOINT: endpoint, TEST_USER: accessKeyId, TEST_PASSWORD: secretAccessKey }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.on('data', chunk => { if (String(chunk).includes('READY')) resolve(); }); child.once('error', reject); child.once('exit', code => reject(new Error('Child exited before ready: ' + code))); });
    child.kill(signal); expect(await exit).toBe(0);
    const objects = new S3Objects(endpoint, accessKeyId, secretAccessKey, Bucket);
    expect((await objects.list('audit/anchors/'))[0]).toMatch(/00000000000000000007-/);
    expect((await objects.list('audit/segments/'))[0]).toMatch(/1-7-/);
    const restarted = new AuditChain(childDir, objects);
    try { await restarted.init(); expect(restarted.health).toMatchObject({ ok: true, anchorSeq: 7, replicationPending: 0 }); } finally { restarted.close(); }
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
}, 15000);
test('retention defaults to one day and invalid values fail configuration', () => {
  expect(configuration({ NODE_ENV: 'test' }).auditRetentionDays).toBe(1);
  for (const value of ['0', '-1', 'abc', '1.5', '36501']) expect(() => configuration({ NODE_ENV: 'test', TOI_AUDIT_RETENTION_DAYS: value })).toThrow('Invalid audit retention days');
});
