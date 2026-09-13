import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandEnvironment, serviceEnvironment } from './service-env.mjs';
import { composeArguments, composeProject, volumeCredentialError } from './compose.mjs';
import { devUpArguments } from './dev-up.mjs';
import { devDownArguments } from './dev-down.mjs';
import { provisionIdentity } from './keycloak.mjs';
import { verifyStorageCredentials, storageProvisioningError } from './storage.mjs';

const env = { COMPOSE_PROJECT_NAME: 'toi-f4', TOI_KEYCLOAK_ADMIN_PASSWORD: 'identity-secret-sentinel', MINIO_ROOT_PASSWORD: 'storage-secret-sentinel' };
test('docker retains project selection while application and install children do not', () => {
  assert.equal(commandEnvironment('docker', env).COMPOSE_PROJECT_NAME, 'toi-f4');
  assert.equal(commandEnvironment('install', env).COMPOSE_PROJECT_NAME, undefined);
  assert.equal(serviceEnvironment('studio', env).COMPOSE_PROJECT_NAME, undefined);
  const selected = commandEnvironment('docker', { ...env, COMPOSE_FILE: 'other.yml', COMPOSE_PROFILES: 'other', UNRELATED_SECRET: 'hidden' });
  for (const key of ['COMPOSE_FILE', 'COMPOSE_PROFILES', 'UNRELATED_SECRET']) assert.equal(selected[key], undefined);
});
test('up, down, destructive down and storage exec select the same explicit project', () => {
  const prefix = ['compose', '-p', 'toi-f4', '-f', 'infra/docker-compose.yml'];
  assert.deepEqual(devUpArguments(env), [...prefix, 'up', '-d']);
  assert.deepEqual(devDownArguments([], env), [...prefix, 'down']);
  assert.deepEqual(devDownArguments(['--volumes'], env), [...prefix, 'down', '--volumes']);
  assert.deepEqual(composeArguments(['exec', '-T', 'minio', 'sh'], env), [...prefix, 'exec', '-T', 'minio', 'sh']);
  assert.equal(composeProject({}), 'toi-lite');
  assert.throws(() => composeProject({ COMPOSE_PROJECT_NAME: 'bad name; command' }), /Invalid COMPOSE_PROJECT_NAME/);
  assert.throws(() => devDownArguments(['--volume'], env), /Usage/);
});
function checkDiagnostic(error, service) {
  assert.equal(error.safeSummary, error.message);
  assert.match(error.message, new RegExp(`toi-f4_${service}-data`));
  assert.match(error.message, /current \.env/);
  assert.match(error.message, /COMPOSE_PROJECT_NAME=toi-f4 node scripts\/dev-down.mjs --volumes/);
  assert.match(error.message, /different COMPOSE_PROJECT_NAME/);
  assert.match(error.message, /No volumes were deleted automatically/);
  for (const value of [env.TOI_KEYCLOAK_ADMIN_PASSWORD, env.MINIO_ROOT_PASSWORD]) assert.ok(!error.message.includes(value));
  return true;
}
test('Keycloak invalid credentials identify retained volume and safe recovery', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: env.TOI_KEYCLOAK_ADMIN_PASSWORD }), { status: 401 }));
  await assert.rejects(provisionIdentity('/unused', env), error => checkDiagnostic(error, 'keycloak'));
});
test('Keycloak invalid_grant on HTTP 400 also identifies mismatched credentials', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
  await assert.rejects(provisionIdentity('/unused', env), error => checkDiagnostic(error, 'keycloak'));
});
test('Keycloak server failure is not mislabeled as a volume mismatch', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(provisionIdentity('/unused', env), /request failed \(HTTP 503\)/);
});
test('MinIO rejects bad root credentials before any provisioning and hides raw server errors', async () => {
  for (const code of ['SignatureDoesNotMatch', 'InvalidAccessKeyId', 'AccessDenied', 'InvalidToken']) {
    await assert.rejects(verifyStorageCredentials(env, { listBuckets: async () => { throw Object.assign(new Error(env.MINIO_ROOT_PASSWORD), { code }); } }), error => checkDiagnostic(error, 'minio'));
  }
  await verifyStorageCredentials(env, { listBuckets: async () => [] });
  await assert.rejects(verifyStorageCredentials(env, { listBuckets: async () => { throw new Error('ECONNREFUSED'); } }), /connectivity check failed/);
});
test('default diagnostic uses the default project volume', () => {
  assert.match(volumeCredentialError('Keycloak', {}).message, /toi-lite_keycloak-data/);
});

test('mc authentication errors identify the compose volume; other failures remain distinct', () => {
  checkDiagnostic(storageProvisioningError(42, env), 'minio');
  assert.match(storageProvisioningError(43, env).safeSummary, /alias setup failed/);
  assert.match(storageProvisioningError(1, env).safeSummary, /bucket\/user provisioning failed/);
});
