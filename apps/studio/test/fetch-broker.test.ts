import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBrokerRequest, proxyBrokerRequest } from '../src/fetch-broker.ts';
import type { FrameToHostFetch } from '../../../contracts/src/runtime.ts';
import type { PreviewSession } from '../../../contracts/src/auth.ts';
const request: FrameToHostFetch = { kind: 'toi_fetch', token: { revision: 1, attemptId: 'a' }, requestId: 'r', apiId: 'customers', path: '/customers', method: 'GET' };
const validate = (change: object, write = false) => validateBrokerRequest({ ...request, ...change }, ['customers'], write)?.brokerError;
test('broker validates API allowlist, normalized prefix, methods, write, headers and UTF-8 body sizes', () => {
  assert.equal(validate({}), undefined); assert.equal(validate({ apiId: 'other' }), 'API_NOT_IN_PROJECT');
  for (const path of ['no-slash', '//evil', '/a\\b', '/a#b', '/../other', '/%2e%2e/other', '/bad\nheader']) assert.equal(validate({ path }), 'INVALID_API_PATH', path);
  for (const method of ['HEAD', 'OPTIONS', 'get', 'TRACE']) assert.equal(validate({ method }), 'INVALID_API_PATH');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) { assert.equal(validate({ method }), 'WRITE_NOT_ALLOWED'); assert.equal(validate({ method }, true), undefined); }
  assert.equal(validate({ body: 'x'.repeat(1024 * 1024) }), undefined);
  assert.equal(validate({ body: '한'.repeat(350000) }), 'BODY_TOO_LARGE'); assert.equal(validate({ body: {} }), 'BODY_TOO_LARGE');
  assert.equal(validate({ contentType: 'application/json\r\nAuthorization: forged' }), 'INVALID_API_PATH');
  assert.equal(validate({ contentType: {} }), 'INVALID_API_PATH'); assert.equal(validate({ reason: {} }), 'INVALID_API_PATH');
});
const session = { sessionToken: 'synthetic-session', capabilityToken: 'synthetic-cap', sessionClaims: { projectId: 'p' }, capability: { env: 'preview' } } as PreviewSession;
test('broker attaches only trusted credentials, Content-Type and encoded reason, forces redirect error', async () => {
  const result = await proxyBrokerRequest({ ...request, method: 'PATCH', contentType: 'application/json', body: '{}', reason: '고객 확인', headers: { Authorization: 'attacker' } } as any, session, 'http://policy', new AbortController().signal, (async (url, init) => {
    assert.equal(url, 'http://policy/proxy/customers/customers'); assert.equal(init.redirect, 'error');
    const headers = init.headers as Headers;
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-session'); assert.equal(headers.get('X-Toi-Capability'), 'synthetic-cap');
    assert.equal(headers.get('X-Toi-Project'), 'p'); assert.equal(headers.get('X-Toi-Env'), 'preview');
    assert.equal(headers.get('X-Toi-Reason'), encodeURIComponent('고객 확인')); assert.equal(headers.get('Content-Type'), 'application/json');
    return new Response('masked', { headers: { 'Set-Cookie': 'private', 'X-Secret': 'private', 'Content-Type': 'text/plain' } });
  }) as typeof fetch);
  assert.equal(result.body, 'masked'); assert.equal(result.contentType, 'text/plain'); assert.ok(!JSON.stringify(result).includes('private'));
});
test('broker streams a maximum of 5 MiB, cancels excess, and sanitizes network errors', async () => {
  let canceled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)); }, cancel() { canceled = true; } });
  const large = await proxyBrokerRequest(request, session, 'http://policy', new AbortController().signal, (async () => new Response(stream)) as typeof fetch);
  assert.equal(large.status, 413); assert.equal(large.brokerError, 'RESPONSE_TOO_LARGE'); assert.ok(canceled);
  const failed = await proxyBrokerRequest(request, session, 'http://policy', new AbortController().signal, (async () => { throw new Error('secret'); }) as typeof fetch);
  assert.equal(failed.brokerError, 'UPSTREAM_UNREACHABLE'); assert.ok(!failed.body.includes('secret'));
});
