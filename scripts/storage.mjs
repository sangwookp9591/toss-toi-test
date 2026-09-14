import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { commandEnvironment } from './service-env.mjs';
import { composeArguments, repositoryRoot, volumeCredentialError } from './compose.mjs';
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export function storageProvisioningError(code, env = process.env) {
  if (code === 42) return volumeCredentialError('MinIO', env);
  const summary = code === 43 ? 'MinIO container alias setup failed; check server health and root configuration' : 'Storage bucket/user provisioning failed';
  return Object.assign(new Error(summary), { safeSummary: summary });
}
export async function verifyStorageCredentials(env = process.env, client) {
  if (!client) {
    const require = createRequire(new URL('../services/deps-builder/package.json', import.meta.url));
    const { Client } = require('minio');
    const endpoint = new URL(env.MINIO_ENDPOINT ?? 'http://localhost:9400');
    client = new Client({ endPoint: endpoint.hostname, port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)), useSSL: endpoint.protocol === 'https:', accessKey: env.MINIO_ROOT_USER ?? 'toi', secretKey: env.MINIO_ROOT_PASSWORD ?? 'toi-local-secret' });
  }
  try { await client.listBuckets(); }
  catch (error) {
    if (['SignatureDoesNotMatch', 'InvalidAccessKeyId', 'AccessDenied', 'InvalidToken'].includes(error.code)) throw volumeCredentialError('MinIO', env);
    const summary = 'MinIO admin connectivity check failed; check MINIO_ENDPOINT and server health';
    throw Object.assign(new Error(summary), { safeSummary: summary });
  }
}
// Credentials travel on stdin, never command arguments or diagnostic output.
export async function provisionStorage(env = process.env) {
  const downloads = env.TOI_DOWNLOAD_BUCKET, audit = env.TOI_AUDIT_BUCKET;
  if (![downloads, audit].every(name => /^[a-z0-9][a-z0-9-]{2,62}$/.test(name ?? '')) || downloads === audit) throw new Error('Invalid storage bucket configuration');
  if (!env.TOI_POLICY_MINIO_USER || !env.TOI_POLICY_MINIO_PASSWORD) throw new Error('Policy storage credentials required');
  await verifyStorageCredentials(env);
  const policy = { Version: '2012-10-17', Statement: [
    { Effect: 'Allow', Action: ['s3:ListBucket', 's3:GetBucketLocation', 's3:GetBucketObjectLockConfiguration'], Resource: [`arn:aws:s3:::${downloads}`, `arn:aws:s3:::${audit}`] },
    { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: [`arn:aws:s3:::${downloads}/*`] },
    { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:GetObjectRetention', 's3:PutObjectRetention'], Resource: [`arn:aws:s3:::${audit}/*`] },
  ] };
  const script = `set -eu
config_dir=$(mktemp -d)
trap 'rm -rf "$config_dir"' EXIT
export MC_CONFIG_DIR="$config_dir"
if ! mc --json alias set local http://127.0.0.1:9000 ${quote(env.MINIO_ROOT_USER ?? 'toi')} ${quote(env.MINIO_ROOT_PASSWORD ?? 'toi-local-secret')} >"$config_dir/auth.json" 2>&1; then
  if grep -Eq 'SignatureDoesNotMatch|InvalidAccessKeyId|AccessDenied|InvalidToken' "$config_dir/auth.json"; then exit 42; fi
  exit 43
fi
mc mb --ignore-existing ${quote('local/' + downloads)} >/dev/null
mc mb --ignore-existing --with-lock ${quote('local/' + audit)} >/dev/null
mc admin user add local ${quote(env.TOI_POLICY_MINIO_USER)} ${quote(env.TOI_POLICY_MINIO_PASSWORD)} >/dev/null
printf '%s' ${quote(JSON.stringify(policy))} > "$config_dir/policy.json"
mc admin policy create local toi-policy-storage "$config_dir/policy.json" >/dev/null
mc admin policy attach local toi-policy-storage --user ${quote(env.TOI_POLICY_MINIO_USER)} >/dev/null
`;
  await new Promise((resolve, reject) => {
    const child = spawn('docker', composeArguments(['exec', '-T', 'minio', 'sh'], env), { cwd: repositoryRoot, env: commandEnvironment('docker', env), stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => reject(new Error('Storage provisioning process failed')));
    child.on('close', code => code === 0 ? resolve() : reject(storageProvisioningError(code, env)));
    child.stdin.on('error', () => {}); child.stdin.end(script);
  });
  // Do not silently accept an older bucket that was created without object lock.
  const require = createRequire(new URL('../services/deps-builder/package.json', import.meta.url));
  const { Client } = require('minio');
  const endpoint = new URL(env.MINIO_ENDPOINT ?? 'http://localhost:9400');
  const client = new Client({endPoint:endpoint.hostname, port:Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)), useSSL:endpoint.protocol === 'https:', accessKey:env.TOI_POLICY_MINIO_USER, secretKey:env.TOI_POLICY_MINIO_PASSWORD});
  const lock = await client.getObjectLockConfig(audit);
  if (lock.objectLockEnabled !== 'Enabled') throw new Error('Audit bucket requires object lock');
  await verifyStorageRetention(env);

}

// Never put a COMPLIANCE probe in the shared audit bucket. This short-lived,
// isolated bucket proves enforcement and is removed after its retention expires.
export async function verifyStorageRetention(env = process.env) {
  const require = createRequire(new URL('../services/policy-proxy/package.json', import.meta.url));
  const { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectRetentionCommand, DeleteObjectCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({ endpoint: env.MINIO_ENDPOINT ?? 'http://localhost:9400', region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: env.MINIO_ROOT_USER ?? 'toi', secretAccessKey: env.MINIO_ROOT_PASSWORD ?? 'toi-local-secret' }, maxAttempts: 1 });
  const Bucket = 'toi-retention-probe-' + randomUUID(), Key = 'retention-probe';
  const send = command => client.send(command, { abortSignal: AbortSignal.timeout(10000) });
  let versionId, retainUntil;
  await send(new CreateBucketCommand({ Bucket, ObjectLockEnabledForBucket: true }));
  try {
    retainUntil = new Date(Date.now() + 5000);
    const result = await send(new PutObjectCommand({ Bucket, Key, Body: 'retention verification', IfNoneMatch: '*', ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: retainUntil }));
    versionId = result.VersionId;
    if (!versionId) throw new Error('Retention probe requires object versioning');
    const locked = await send(new GetObjectRetentionCommand({ Bucket, Key, VersionId: versionId }));
    if (locked.Retention?.Mode !== 'COMPLIANCE' || Math.abs(locked.Retention.RetainUntilDate.getTime() - retainUntil.getTime()) > 1000) throw new Error('Object retention not applied');
    let denied = false;
    try { await send(new DeleteObjectCommand({ Bucket, Key, VersionId: versionId, BypassGovernanceRetention: true })); }
    catch (error) { if (error.$metadata?.httpStatusCode !== 403 && !(error.name === 'InvalidRequest' && /WORM protected/.test(error.message))) throw error; denied = true; }
    if (!denied) throw new Error('COMPLIANCE retention did not reject root version deletion');
  } finally {
    try {
      if (versionId) { await delay(Math.max(0, retainUntil.getTime() - Date.now()) + 1100); await send(new DeleteObjectCommand({ Bucket, Key, VersionId: versionId })); }
      await send(new DeleteBucketCommand({ Bucket }));
    } finally { client.destroy(); }
  }
}
