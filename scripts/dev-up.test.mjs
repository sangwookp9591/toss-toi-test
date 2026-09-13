import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkInstallDirectories, installDirectories } from './dev-up.mjs';
import { redact, summarizeFailure } from './dev-diagnostics.mjs';

test('all app, service and runtime package manifests have lockfile install targets', async () => {
 const root = new URL('..', import.meta.url);
 assert.deepEqual(await checkInstallDirectories(root.pathname), installDirectories);
 assert.ok(installDirectories.includes('packages/fake-tds'));
 assert.ok(installDirectories.includes('packages/preview-runtime'));
 assert.ok(installDirectories.includes('apps/studio'));
});
test('a newly added runtime package fails the install inventory check', async () => {
 const root = await mkdtemp(path.join(tmpdir(), 'toi-install-check-'));
 try {
  for (const group of ['apps', 'services', 'packages']) await mkdir(path.join(root, group));
  await mkdir(path.join(root, 'packages/new-runtime'));
  await writeFile(path.join(root, 'packages/new-runtime/package.json'), '{}');
  await assert.rejects(checkInstallDirectories(root), /Install targets missing: packages\/new-runtime/);
 } finally { await rm(root, {recursive:true,force:true}); }
});
test('known failures retain stage/cause while arbitrary subprocess text stays out of summaries', () => {
 assert.equal(summarizeFailure('fake-tds build failed: tsc not found; inspect registry'), 'fake-tds build failed: tsc not found');
 assert.equal(summarizeFailure('sh: tsc: command not found'), 'tsc not found');
 assert.equal(summarizeFailure('npm error code ELOCKVERIFY'), 'npm error ELOCKVERIFY');
 assert.equal(summarizeFailure('secret credential=do-not-print'), 'command failed; inspect the log');
});
test('command logs redact configured secrets, authorization and URL credentials', () => {
 const output = redact('abc top-secret Bearer hidden https://user:pass@host _authToken=xyz', { TOI_REGISTRY_TOKEN:'top-secret' });
 for (const value of ['top-secret','hidden','user:pass','xyz']) assert.ok(!output.includes(value));
 assert.ok(output.includes('[REDACTED]'));
});

test('Keycloak import fixes PKCE, audiences, roles and TTL without plaintext credentials', async () => {
 const {readFile}=await import('node:fs/promises');
 const realm=JSON.parse(await readFile(new URL('../infra/keycloak/realm-toi.json',import.meta.url),'utf8'));
 assert.equal(realm.realm,'toi');assert.equal(realm.accessTokenLifespan,300);assert.equal(realm.ssoSessionIdleTimeout,1800);
 assert.deepEqual(realm.users.map(user=>user.username),['alice','bob','carol','dana','root']);
 for(const user of realm.users) assert.equal(user.credentials,undefined);
 for(const client of realm.clients) {
  assert.equal(client.secret,undefined);assert.equal(client.directAccessGrantsEnabled,false);
  assert.ok(client.protocolMappers.some(mapper=>mapper.protocolMapper==='oidc-audience-mapper'&&mapper.config['included.custom.audience']==='toi-api'));
  assert.ok(client.protocolMappers.some(mapper=>mapper.protocolMapper==='oidc-group-membership-mapper'&&mapper.config['full.path']==='true'));
 }
 const studio=realm.clients.find(client=>client.clientId==='toi-studio');
 assert.equal(studio.publicClient,true);assert.equal(studio.attributes['pkce.code.challenge.method'],'S256');
 assert.deepEqual(studio.redirectUris,['http://localhost:5173/*']);assert.deepEqual(studio.webOrigins,['http://localhost:5173']);
 for(const client of realm.clients.filter(client=>client.clientId!=='toi-studio')) {assert.equal(client.publicClient,false);assert.equal(client.serviceAccountsEnabled,true);assert.equal(client.standardFlowEnabled,false);}
});

import { serviceEnvironment, commandEnvironment, serviceKeys } from './service-env.mjs';
import { ensureDevelopmentSecrets } from './dev-up.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
test('each runtime receives exactly its own allowlist and no inherited credentials', () => {
 const env = Object.fromEntries([...new Set(Object.values(serviceKeys).flat()), 'TOI_POLICY_MINIO_USER', 'TOI_POLICY_MINIO_PASSWORD', 'TOI_PASSWORD_ALICE', 'TOI_KEYCLOAK_ADMIN_PASSWORD', 'UNRELATED_SECRET', 'NODE_OPTIONS', 'PATH', 'HOME'].map(key => [key, 'sentinel-' + key]));
 for (const name of Object.keys(serviceKeys)) {
  const selected = serviceEnvironment(name, env);
  assert.equal(selected.TOI_MANAGED_ENV, '1'); assert.equal(selected.PATH, env.PATH);
  for (const key of Object.keys(selected)) assert.ok(['PATH', 'HOME', 'TOI_MANAGED_ENV', ...serviceKeys[name]].includes(key));
  for (const key of ['UNRELATED_SECRET', 'NODE_OPTIONS', 'TOI_PASSWORD_ALICE', 'TOI_KEYCLOAK_ADMIN_PASSWORD']) assert.equal(selected[key], undefined);
 }
 const studio = serviceEnvironment('studio', env);
 for (const key of Object.keys(env).filter(key => /SECRET|TOKEN|PASSWORD|KEK/.test(key))) assert.equal(studio[key], undefined);
 assert.equal(serviceEnvironment('policy-proxy', env).MINIO_ROOT_PASSWORD, env.TOI_POLICY_MINIO_PASSWORD);
 assert.deepEqual(Object.keys(serviceEnvironment('mock-backend', env)).sort(), ['PATH','HOME','TOI_MANAGED_ENV','TOI_PREVIEW_SERVICE_TOKEN','TOI_LIVE_SERVICE_TOKEN'].sort());
 assert.equal(commandEnvironment('install', env).TOI_SESSION_SECRET, undefined);
 for (const kind of ['registry', 'publish']) {
  const selected = commandEnvironment(kind, env);
  assert.deepEqual(Object.keys(selected).sort(), ['PATH','HOME','TOI_MANAGED_ENV','TOI_REGISTRY_URL','TOI_REGISTRY_TOKEN'].sort());
 }
});
test('download keys are random, persistent, and 32 bytes; environment file is private', async () => {
 const directory = await mkdtemp(path.join(tmpdir(), 'toi-secrets-')); const file = path.join(directory, '.env');
 try {
  const env = {}; await ensureDevelopmentSecrets(file, env);
  for (const key of ['TOI_DOWNLOAD_KEK', 'TOI_DOWNLOAD_URL_SECRET', 'TOI_POLICY_MINIO_PASSWORD']) assert.match(env[key], /^[a-f0-9]{64}$/);
  assert.notEqual(env.TOI_DOWNLOAD_KEK, env.TOI_DOWNLOAD_URL_SECRET);
  const previous = {...env}; await ensureDevelopmentSecrets(file, env); assert.deepEqual(env, previous);
  const {stat}=await import('node:fs/promises'); assert.equal((await stat(file)).mode & 0o777, 0o600);
 } finally { await rm(directory, {recursive:true,force:true}); }
});
test('managed deps-builder never reloads root dotenv secrets', () => {
 const result = execFileSync(process.execPath, ['--import', './services/deps-builder/node_modules/tsx/dist/loader.mjs', '--input-type=module', '-e', "await import('./services/deps-builder/src/config.ts'); if (process.env.TOI_SESSION_SECRET || process.env.TOI_PASSWORD_ALICE || process.env.TOI_REGISTRY_TOKEN) process.exit(1)"], {env:{PATH:process.env.PATH, HOME:process.env.HOME, TOI_MANAGED_ENV:'1'}});
 assert.equal(result.length, 0);
});
test('managed mock-backend refuses startup with absent tokens despite root dotenv file', () => {
 const result = spawnSync(process.execPath, ['--import', './services/mock-backend/node_modules/tsx/dist/loader.mjs', './services/mock-backend/src/main.ts'], {env:{PATH:process.env.PATH, HOME:process.env.HOME, TOI_MANAGED_ENV:'1'}, encoding:'utf8'});
 assert.notEqual(result.status, 0); assert.match(result.stderr, /Distinct preview\/live service tokens required/);
});
