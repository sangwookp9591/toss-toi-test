/** Re-run immutable R3 probes in a mirror and disposable MinIO, leaving shared data untouched. */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, symlink, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { AuditChain } from '../src/audit.js';
import { S3Objects } from '../src/objects.js';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), 'f3b-r3-')), name = 'f3b-r3-' + randomUUID(), volume = name + '-data';
const evidence = fileURLToPath(new URL('./', import.meta.url));
const original = path.join(repository, 'docs/review/repro/r3');
const source = await readFile(path.join(original, 'p03-audit-minio.mts'), 'utf8');
// The historical script fixes its root credentials; reuse them only in the disposable server.
const accessKeyId = /accessKeyId:'([^']+)'/.exec(source)![1], secretAccessKey = /secretAccessKey:'([^']+)'/.exec(source)![1];
const policyUser = 'f3-policy', policyPassword = randomBytes(32).toString('hex');
const docker = (args: string[], env?: NodeJS.ProcessEnv) => execFileSync('docker', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
let started = false;
try {
  await mkdir(path.join(mirror, 'docs/review/repro/r3'), { recursive: true });
  await symlink(path.join(repository, 'services'), path.join(mirror, 'services'));
  for (const filename of ['p03-audit.mts', 'p03-audit-minio.mts']) await copyFile(path.join(original, filename), path.join(mirror, 'docs/review/repro/r3', filename));
  docker(['volume', 'create', volume]);
  docker(['run', '--detach', '--name', name, '-p', '127.0.0.1::9000', '-v', volume + ':/data', '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z', 'server', '/data'], { ...process.env, MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey }); started = true;
  const endpoint = 'http://127.0.0.1:' + docker(['port', name, '9000/tcp']).split(':').at(-1);
  for (let i = 0; i < 100; i++) { try { if ((await fetch(endpoint + '/minio/health/ready')).ok) break; } catch {} await delay(100); }
  const root = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  for (const Bucket of ['toi-audit', 'toi-downloads']) await root.send(new CreateBucketCommand({ Bucket, ...(Bucket === 'toi-audit' ? { ObjectLockEnabledForBucket: true } : {}) }));
  const policy = { Version: '2012-10-17', Statement: [
    { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: ['arn:aws:s3:::toi-audit', 'arn:aws:s3:::toi-downloads'] },
    { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:GetObjectRetention', 's3:PutObjectRetention'], Resource: ['arn:aws:s3:::toi-audit/*'] },
    { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: ['arn:aws:s3:::toi-downloads/*'] },
  ] };
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', name, 'sh'], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('Isolated policy setup failed')));
    child.stdin.end(`set -eu\nmc alias set local http://127.0.0.1:9000 ${quote(accessKeyId)} ${quote(secretAccessKey)} >/dev/null\nmc admin user add local ${quote(policyUser)} ${quote(policyPassword)} >/dev/null\nprintf '%s' ${quote(JSON.stringify(policy))} >/tmp/policy.json\nmc admin policy create local f3-policy /tmp/policy.json >/dev/null\nmc admin policy attach local f3-policy --user ${quote(policyUser)} >/dev/null\nrm /tmp/policy.json\n`);
  });
  for (const filename of ['p03-audit.mts', 'p03-audit-minio.mts']) {
    const mirrored = path.join(mirror, 'docs/review/repro/r3', filename);
    if (!(await readFile(mirrored)).equals(await readFile(path.join(original, filename)))) throw new Error('Mirror source differs');
    const output = execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'), mirrored], { encoding: 'utf8', env: { ...process.env, MINIO_ENDPOINT: endpoint, TOI_POLICY_MINIO_USER: policyUser, TOI_POLICY_MINIO_PASSWORD: policyPassword, TOI_AUDIT_BUCKET: 'toi-audit', TOI_DOWNLOAD_BUCKET: 'toi-downloads' }, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    await writeFile(path.join(evidence, 'F3B-' + filename.replace('.mts', '.out')), output);
    console.log(filename + ': passed (byte-identical mirrored source)');
  }
  const Bucket = 'anchored-tail-' + randomUUID(); await root.send(new CreateBucketCommand({ Bucket, ObjectLockEnabledForBucket: true }));
  const directory = path.join(mirror, 'anchored-tail'), objects = new S3Objects(endpoint, accessKeyId, secretAccessKey, Bucket);
  const chain = new AuditChain(directory, objects); await chain.init();
  for (let i = 0; i < 5; i++) await chain.append({ action: 'proxy', ts: new Date().toISOString(), user: 'test', projectId: 'p', apiId: 'a', method: 'GET', path: '/x', status: 200, maskedFields: [], decision: 'allowed' });
  await chain.anchor(); chain.close();
  const file = path.join(directory, 'audit.jsonl'); await writeFile(file, (await readFile(file, 'utf8')).trimEnd().split('\n').slice(0, 3).join('\n') + '\n');
  const restarted = new AuditChain(directory, objects); await restarted.init();
  const result = { scenario: 'MinIO anchored but unreplicated tail truncated 5->3 whole records', ...restarted.health, remoteSegments: (await objects.list('audit/segments/')).length };
  restarted.close(); if (result.brokenAt !== 4 || result.remoteSegments !== 0 || result.anchorSeq !== 5) throw new Error('Anchored tail regression failed');
  await writeFile(path.join(evidence, 'F3B-anchored-tail.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Anchored tail: detected at 4, remote anchor 5, zero segments'); root.destroy();
} finally {
  if (started) docker(['rm', '--force', name]);
  docker(['volume', 'rm', volume]);
  await rm(mirror, { recursive: true, force: true });
}
console.log('Disposable MinIO and volume removed; shared audit bucket untouched');
