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
