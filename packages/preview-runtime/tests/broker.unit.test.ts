import { afterEach, expect, it, vi } from 'vitest';
import { FrameBroker, brokerFailure } from '../src/broker.ts';
import { configureToiFetch, toiFetch, clearToiFetch, ToiAccessRevokedError, ToiFetchError } from '../../../services/policy-proxy/client/toi-fetch.ts';
const token = { projectId: 'p', revision: 1, attemptId: 'a', sourceDigest: 's', manifestDigest: 'm' };
const request = { kind: 'toi_fetch', token, requestId: 'r', apiId: 'customers', path: '/customers', method: 'GET' };
const origin = 'http://p.preview.localhost';
afterEach(() => { clearToiFetch(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('authenticates source, origin, token; invalidated documents never fetch or receive late results', async () => {
  const source = { postMessage: vi.fn() } as unknown as Window;
  let finish!: (value: any) => void;
  const fetch = vi.fn((_request, signal) => new Promise<any>(resolve => { finish = resolve; expect(signal.aborted).toBe(false); }));
  const broker = new FrameBroker(source, origin, token, fetch);
  await broker.receive({ source: {} as Window, origin, data: request });
  await broker.receive({ source, origin: 'evil', data: request });
  expect(fetch).not.toHaveBeenCalled();
  await broker.receive({ source, origin, data: { ...request, token: { ...token, attemptId: 'other' } } });
  expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({ brokerError: 'NOT_ALLOWED_SOURCE' }), origin);
  const pending = broker.receive({ source, origin, data: request }); broker.invalidate();
  expect(fetch.mock.calls[0][1].aborted).toBe(true);
  finish(brokerFailure('r', 502, 'UPSTREAM_UNREACHABLE')); await pending;
  await broker.receive({ source, origin, data: { ...request, requestId: 'later' } });
  expect(fetch).toHaveBeenCalledTimes(1); expect(source.postMessage).toHaveBeenCalledTimes(1);
});
it('limits concurrency to eight and rolling rate to fifty per second', async () => {
  const source = { postMessage: vi.fn() } as unknown as Window;
  const waiting: Array<(value: any) => void> = [];
  const broker = new FrameBroker(source, origin, token, () => new Promise(resolve => waiting.push(resolve)));
  const calls = Array.from({ length: 9 }, (_, i) => broker.receive({ source, origin, data: { ...request, requestId: String(i) } }));
  expect(waiting).toHaveLength(8); expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({ status: 429 }), origin);
  waiting.forEach(resolve => resolve(brokerFailure('r', 502, 'UPSTREAM_UNREACHABLE'))); await Promise.all(calls);
  let now = 1000;
  const network = vi.fn(async () => brokerFailure('r', 502, 'UPSTREAM_UNREACHABLE'));
  const rate = new FrameBroker(source, origin, token, network, () => now);
  for (let i = 0; i < 51; i++) await rate.receive({ source, origin, data: { ...request, requestId: String(i) } });
  expect(network).toHaveBeenCalledTimes(50); now = 2001;
  await rate.receive({ source, origin, data: request }); expect(network).toHaveBeenCalledTimes(51);
});
function clientHarness() {
  const window = new EventTarget(); const parent = { postMessage: vi.fn() };
  vi.stubGlobal('window', window); vi.stubGlobal('parent', parent);
  vi.stubGlobal('__TOI_FETCH_BRIDGE__', { parentOrigin: 'http://localhost:5273', token });
  configureToiFetch({ projectId: 'p', env: 'preview', transport: 'broker' });
  const receive = (data: any, source: any = parent, origin = 'http://localhost:5273') => { const event = new Event('message'); Object.assign(event, { data, source, origin }); window.dispatchEvent(event); };
  return { window, parent, receive };
}
it('client checks parent source, boot origin and request id; creates a Response', async () => {
  const { parent, receive } = clientHarness();
  const pending = toiFetch('customers', '/customers', { reason: 'test reason', headers: { Authorization: 'ignored' } });
  const sent = parent.postMessage.mock.calls[0][0];
  expect(parent.postMessage.mock.calls[0][1]).toBe('http://localhost:5273');
  expect(sent).not.toHaveProperty('headers');
  const response = { kind: 'toi_fetch_result', requestId: sent.requestId, status: 200, body: '{"ok":true}', contentType: 'application/json' };
  receive(response, {}, 'http://localhost:5273'); receive(response, parent, 'http://evil'); receive({ ...response, requestId: 'wrong' });
  receive(response); expect(await (await pending).json()).toEqual({ ok: true });
});
it('client times out at 30 seconds and refuses legacy credentials', async () => {
  vi.useFakeTimers(); clientHarness();
  const pending = toiFetch('customers', '/customers');
  const assertion = expect(pending).rejects.toMatchObject({ status: 0, code: 'BROKER_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(30000); await assertion;
  configureToiFetch({ projectId: 'p', sessionToken: 'synthetic', capabilityToken: 'synthetic' } as any);
  await expect(toiFetch('customers', '/customers')).rejects.toMatchObject({ status: 0, code: 'CLIENT_NOT_CONFIGURED' });
});

it.each([{ error: 'PROJECT_NOT_FOUND' }, { code: 'PROJECT_NOT_FOUND' }])('membership 404 throws ToiAccessRevokedError with status/code: %j', async body => {
  const { parent, receive } = clientHarness();
  const pending = toiFetch('customers', '/customers');
  const requestId = parent.postMessage.mock.calls[0][0].requestId;
  receive({ kind: 'toi_fetch_result', requestId, status: 404, body: JSON.stringify(body) });
  await expect(pending).rejects.toBeInstanceOf(ToiAccessRevokedError);
  await expect(pending).rejects.toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' });
});
it('resource 404 keeps its ordinary error type', async () => {
  const { parent, receive } = clientHarness();
  const pending = toiFetch('customers', '/customers/missing');
  receive({ kind: 'toi_fetch_result', requestId: parent.postMessage.mock.calls[0][0].requestId, status: 404, body: '{"error":"NOT_FOUND"}' });
  const error = await pending.catch(error => error);
  expect(error).toBeInstanceOf(ToiFetchError); expect(error).not.toBeInstanceOf(ToiAccessRevokedError);
  expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
});
