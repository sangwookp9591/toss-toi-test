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
 assert.deepEqual(studio.redirectUris,['http://localhost:5273/*']);assert.deepEqual(studio.webOrigins,['http://localhost:5273']);
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
 assert.equal(serviceEnvironment('agent-server', env).GEMINI_API_KEY, env.GEMINI_API_KEY);
 for (const name of Object.keys(serviceKeys).filter(name => name !== 'agent-server')) assert.equal(serviceEnvironment(name, env).GEMINI_API_KEY, undefined);
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

import { keycloakBase } from './keycloak.mjs';
import { configureDevelopmentPorts, checkListeningPort } from './dev-ports.mjs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
test('issuer migration changes only exact legacy defaults, preserves overrides and is idempotent', async () => {
 const directory = await mkdtemp(path.join(tmpdir(), 'toi-issuer-'));
 const file = path.join(directory, '.env');
 try {
  const old = 'http://localhost:8080/realms/toi';
  await writeFile(file, `export TOI_IDENTITY_ISSUER="${old}" # old default\nVITE_OIDC_ISSUER=${old}\nUNRELATED_SECRET=sentinel\n`);
  const env = {TOI_IDENTITY_ISSUER:old, VITE_OIDC_ISSUER:'https://custom.example/realms/toi'}, logs = [];
  await configureDevelopmentPorts(file, env, line => logs.push(line));
  assert.equal(env.TOI_IDENTITY_ISSUER, 'http://localhost:8180/realms/toi');
  assert.equal(env.VITE_OIDC_ISSUER, 'https://custom.example/realms/toi');
  assert.equal(env.TOI_KEYCLOAK_PORT, '8180');
  assert.deepEqual(logs, ['옛 Keycloak 포트 설정을 8180으로 이행했다']);
  const contents = await readFile(file, 'utf8');
  assert.ok(!contents.includes(old)); assert.ok(contents.includes('UNRELATED_SECRET=sentinel'));
  await configureDevelopmentPorts(file, env, line => logs.push(line));
  assert.equal(logs.length, 1); assert.equal(await readFile(file, 'utf8'), contents);
  const custom = `TOI_IDENTITY_ISSUER=${old}/\nVITE_OIDC_ISSUER=https://custom.example/realms/toi\n`;
  await writeFile(file, custom);
  await configureDevelopmentPorts(file, {TOI_KEYCLOAK_PORT:'8280', TOI_IDENTITY_ISSUER:old+'/', VITE_OIDC_ISSUER:'https://custom.example/realms/toi'});
  assert.equal(await readFile(file, 'utf8'), custom);
  const fresh = {TOI_KEYCLOAK_PORT:'8280'};
  await configureDevelopmentPorts(path.join(directory, 'missing'), fresh);
  assert.equal(fresh.VITE_OIDC_ISSUER, 'http://localhost:8280/realms/toi');
  assert.equal(keycloakBase(fresh), 'http://localhost:8280');
  for (const value of ['0', '65536', 'abc', '8180/path']) assert.throws(() => keycloakBase({TOI_KEYCLOAK_PORT:value}), /Invalid TOI_KEYCLOAK_PORT/);
 } finally { await rm(directory, {recursive:true,force:true}); }
});

test('port preflight rejects IPv4 and IPv6 conflicts, accepts matching Keycloak and a free port', async () => {
 for (const host of ['127.0.0.1', '::1']) {
  let matching = false;
  const server = createServer((request, response) => {
   const base = `http://localhost:${server.address().port}/realms/toi`;
   response.setHeader('Content-Type', 'application/json');
   response.end(JSON.stringify(matching ? {issuer:base, token_endpoint:base+'/protocol/openid-connect/token'} : {service:'unrelated'}));
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, host, resolve);});
  const env = {TOI_KEYCLOAK_PORT:String(server.address().port)};
  try {
   await assert.rejects(checkListeningPort({name:'Keycloak',port:Number(env.TOI_KEYCLOAK_PORT),pathname:'/',matches:body => JSON.parse(body).issuer === keycloakBase(env)+'/realms/toi'}), error => error.safeSummary.includes('occupied') && error.safeSummary.includes(host) && error.safeSummary.includes('localhost / 127.0.0.1 / ::1'));
   matching = true; await checkListeningPort({name:'Keycloak',port:Number(env.TOI_KEYCLOAK_PORT),pathname:'/',matches:body => JSON.parse(body).issuer === keycloakBase(env)+'/realms/toi'});
  } finally { await new Promise(resolve => server.close(resolve)); }
  await checkListeningPort({name:'Keycloak',port:Number(env.TOI_KEYCLOAK_PORT),pathname:'/',matches:body => JSON.parse(body).issuer === keycloakBase(env)+'/realms/toi'});
 }
});

test('development URL migration preserves custom endpoints and shares infrastructure ports with Compose children', async () => {
 const directory = await mkdtemp(path.join(tmpdir(), 'toi-ports-'));
 const file = path.join(directory, '.env');
 try {
  await writeFile(file, '  TOI_REGISTRY_URL="http://localhost:4873"\nMINIO_ENDPOINT=http://localhost:9000\nAGENT_STUDIO_ORIGIN=http://localhost:5173\nCUSTOM_URL=http://localhost:4873\n');
  const env = {TOI_REGISTRY_PORT:'5073',TOI_MINIO_PORT:'9500',TOI_MINIO_CONSOLE_PORT:'9501'}, logs=[];
  await configureDevelopmentPorts(file, env, message=>logs.push(message));
  const contents=await readFile(file,'utf8');
  assert.match(contents,/TOI_REGISTRY_URL=http:\/\/localhost:5073/);
  assert.match(contents,/MINIO_ENDPOINT=http:\/\/localhost:9500/);
  assert.match(contents,/AGENT_STUDIO_ORIGIN=http:\/\/localhost:5273/);
  assert.match(contents,/CUSTOM_URL=http:\/\/localhost:4873/);
  assert.deepEqual(logs,['옛 개발 서비스 포트 설정을 이행했다']);
  const docker=commandEnvironment('docker',env);
  for(const key of ['TOI_REGISTRY_PORT','TOI_MINIO_PORT','TOI_MINIO_CONSOLE_PORT','TOI_KEYCLOAK_PORT']) assert.equal(docker[key],env[key]);
  await writeFile(file,'TOI_REGISTRY_URL=https://registry.example\nMINIO_ENDPOINT=http://localhost:9000/\nAGENT_STUDIO_ORIGIN=https://studio.example\n');
  const before=await readFile(file,'utf8');
  await configureDevelopmentPorts(file,{TOI_REGISTRY_URL:'https://registry.example',MINIO_ENDPOINT:'http://localhost:9000/',AGENT_STUDIO_ORIGIN:'https://studio.example'});
  assert.equal(await readFile(file,'utf8'),before);
 } finally { await rm(directory,{recursive:true,force:true}); }
});
