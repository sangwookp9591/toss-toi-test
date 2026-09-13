import { test } from 'node:test';
import assert from 'node:assert/strict';
import { User, InMemoryWebStorage, WebStorageStateStore } from 'oidc-client-ts';
import { AuthSession, LoginRequired, oidcSettings } from '../src/auth.ts';
import { authenticatedFetch, API } from '../src/api.ts';
import { previewHostConfig } from '../src/preview-auth.ts';
const user = (token = 'identity-secret', expired = false) => new User({ access_token: token, token_type: 'Bearer', profile: { sub: 'alice', iss: 'issuer', aud: 'toi-api', exp: 9999999999, iat: 0, preferred_username: 'alice' }, expires_at: expired ? 1 : 9999999999, refresh_token: 'refresh-secret' });
function fixture() {
  let refreshes = 0; let removes = 0;
  const driver = { getUser: async () => null, signinSilent: async () => { refreshes++; await new Promise(resolve => setTimeout(resolve, 5)); return user('new-identity'); }, signinRedirect: async () => {}, signoutRedirect: async () => {}, removeUser: async () => { removes++; } };
  return { driver, session: new AuthSession(driver), refreshes: () => refreshes, removes: () => removes };
}
test('anonymous state and refresh failure erase identity and require login', async () => {
  const f = fixture(); f.driver.signinSilent = async () => { throw new Error('secret must not be surfaced'); };
  await f.session.initialize(); assert.equal(f.session.getSnapshot().status, 'anonymous');
  await assert.rejects(f.session.token(), LoginRequired);
  assert.ok(!JSON.stringify(f.session.getSnapshot()).includes('secret'));
});
test('SSO restores memory state; concurrent renewal shares one request; snapshot has no tokens', async () => {
  const f = fixture(); await f.session.initialize(); assert.equal(f.session.getSnapshot().status, 'authenticated');
  f.session.accept(user('expired', true));
  assert.deepEqual(await Promise.all([f.session.token(), f.session.token()]), ['new-identity', 'new-identity']);
  assert.equal(f.refreshes(), 2);
  assert.ok(!JSON.stringify(f.session.getSnapshot()).includes('new-identity'));
  assert.ok(!JSON.stringify(f.session.getSnapshot()).includes('refresh-secret'));
});
test('agent/policy Bearer injection, one renewal and retry preserve method, body, abort and SSE headers', async () => {
  for (const origin of [API.agent, API.policy]) {
    const f = fixture(); f.session.accept(user()); const requests: RequestInit[] = []; const abort = new AbortController();
    const response = await authenticatedFetch(origin + '/test', { method: 'POST', body: '{}', signal: abort.signal, headers: { 'Last-Event-ID': '7' } }, f.session, async (_url, init) => { requests.push(init!); return new Response('{}', { status: requests.length === 1 ? 401 : 200 }); });
    assert.equal(response.status, 200); assert.equal(f.refreshes(), 1); assert.equal(requests.length, 2);
    assert.equal(new Headers(requests[0].headers).get('Authorization'), 'Bearer identity-secret');
    assert.equal(new Headers(requests[1].headers).get('Authorization'), 'Bearer new-identity');
    assert.equal(new Headers(requests[1].headers).get('Last-Event-ID'), '7'); assert.equal(requests[1].signal, abort.signal);
    assert.equal(requests[1].body, '{}'); assert.equal(requests[1].redirect, 'error');
  }
});
test('second 401 stops retrying and clears login, while 403 never refreshes', async () => {
  const f = fixture(); f.session.accept(user()); let calls = 0;
  await assert.rejects(authenticatedFetch(API.agent + '/projects', {}, f.session, async () => { calls++; return new Response('{}', { status: 401 }); }), LoginRequired);
  assert.equal(calls, 2); assert.equal(f.removes(), 1); assert.equal(f.session.getSnapshot().status, 'anonymous');
  f.session.accept(user());
  assert.equal((await authenticatedFetch(API.policy + '/test', {}, f.session, async () => new Response('{}', { status: 403 }))).status, 403);
  assert.equal(f.refreshes(), 1);
});
test('credentials never go to builder or lookalike origin', async () => {
  const f = fixture();
  for (const url of [API.deps + '/package-sets', 'http://localhost.attacker.test:7400/test']) {
    await authenticatedFetch(url, {}, f.session, async (_url, init) => { assert.equal(new Headers(init?.headers).has('Authorization'), false); return new Response('{}'); });
  }
  assert.equal(f.refreshes(), 0);
});
test('OIDC uses PKCE code flow, memory user store and only session-scoped transient state', async () => {
  Object.assign(globalThis, { sessionStorage: new InMemoryWebStorage() });
  const settings = oidcSettings('http://localhost:5173');
  assert.equal(settings.response_type, 'code'); assert.equal(settings.disablePKCE, false);
  assert.equal(settings.client_id, 'toi-studio');
  await settings.userStore!.set('user', 'secret');
  assert.ok(await new WebStorageStateStore({ store: sessionStorage }).get('user') == null);
  assert.equal(await settings.userStore!.get('user'), 'secret');
});
test('preview host configuration includes only downgraded tokens, never Keycloak tokens or extra response fields', () => {
  const input = { sessionToken: 'preview-session', capabilityToken: 'preview-capability', access_token: 'identity-secret', refresh_token: 'refresh-secret', capability: {}, sessionClaims: {} };
  const output = previewHostConfig(input as any, 'project', API.policy);
  assert.deepEqual(output, { toiFetch: { sessionToken: 'preview-session', capabilityToken: 'preview-capability', projectId: 'project', proxyBaseUrl: API.policy, env: 'preview' } });
  assert.ok(!JSON.stringify(output).includes('secret'));
});
test('parallel rejected requests coalesce refresh and each retry at most once', async () => {
  const f = fixture(); f.session.accept(user()); let calls = 0;
  const transport: typeof fetch = async (_url, init) => { calls++; return new Response('{}', { status: new Headers(init?.headers).get('Authorization') === 'Bearer identity-secret' ? 401 : 200 }); };
  const responses = await Promise.all([authenticatedFetch(API.agent + '/a', {}, f.session, transport), authenticatedFetch(API.policy + '/b', {}, f.session, transport)]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]); assert.equal(calls, 4); assert.equal(f.refreshes(), 1);
});
test('failed refresh after 401 never retries with stale credentials', async () => {
  const f = fixture(); f.session.accept(user()); f.driver.signinSilent = async () => { throw new Error('revoked'); }; let calls = 0;
  await assert.rejects(authenticatedFetch(API.agent + '/a', {}, f.session, async () => { calls++; return new Response('{}', { status: 401 }); }), LoginRequired);
  assert.equal(calls, 1); assert.equal(f.session.getSnapshot().status, 'anonymous');
});
test('expiry during renewal preserves authenticated workspace state until renewal settles', async () => {
  const f = fixture(); const old = user(); f.session.accept(old);
  let resolve!: (value: User) => void;
  f.driver.signinSilent = () => new Promise<User>(done => { resolve = done; });
  const states: string[] = []; f.session.subscribe(() => states.push(f.session.getSnapshot().status));
  const renewing = f.session.refresh(); old.expires_at = 1;
  const expired = f.session.expired();
  assert.equal(f.session.getSnapshot().status, 'authenticated');
  const requestToken = f.session.token();
  resolve(user('renewed'));
  await Promise.all([renewing, expired]); assert.equal(await requestToken, 'renewed');
  assert.deepEqual(states, ['authenticated']); assert.equal(f.removes(), 0);
});
test('failed pending renewal logs out once, while a late expiry event ignores a fresh token', async () => {
  const f = fixture(); const old = user(); f.session.accept(old);
  let reject!: (error: Error) => void;
  f.driver.signinSilent = () => new Promise<User>((_resolve, fail) => { reject = fail; });
  const renewing = f.session.refresh(); const rejected = assert.rejects(renewing, LoginRequired);
  old.expires_at = 1; const expired = f.session.expired(); reject(new Error('revoked'));
  await Promise.all([rejected, expired]); assert.equal(f.removes(), 1); assert.equal(f.session.getSnapshot().status, 'anonymous');
  f.session.accept(user()); await f.session.expired(); assert.equal(f.session.getSnapshot().status, 'authenticated');
});
test('signout cannot be undone by an in-flight renewal response', async () => {
  const f = fixture(); f.session.accept(user()); let resolve!: (value: User) => void;
  f.driver.signinSilent = () => new Promise<User>(done => { resolve = done; });
  const renewing = f.session.refresh(); await f.session.invalidate(); resolve(user('late'));
  await assert.rejects(renewing, LoginRequired); assert.equal(f.session.getSnapshot().status, 'anonymous');
});
