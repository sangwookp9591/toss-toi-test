import { beforeAll, afterAll, test, expect } from 'vitest';
import { createMockBackend } from '../src/server.js';
import { seedCustomers } from '../src/data.js';
const server = createMockBackend('test-upstream-token', 'test-upstream-token-live'); let base: string;
beforeAll(async () => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const get = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { 'X-Service-Token': 'test-upstream-token', ...init.headers } });
test('all routes require service authentication, including OpenAPI', async () => { for (const path of ['/customers', '/openapi.json', '/healthz']) expect((await fetch(base + path)).status).toBe(401); });
test('seed is deterministic and contains 200 distinct customer IDs', async () => { expect(seedCustomers()).toEqual(seedCustomers()); expect(new Set(seedCustomers().map(item => item.id)).size).toBe(200); const body = await (await get('/preview/customers?page=2&size=20')).json(); expect(body.total).toBe(200); expect(body.items[0].id).toBe('C021'); expect(body.items).toHaveLength(20); expect((await get('/preview/customers?size=101')).status).toBe(400); });
test('search, detail, orders and validated status patch work', async () => { expect((await (await get('/preview/customers?query=hong')).json()).total).toBe(1); expect((await (await get('/preview/customers/C001')).json()).name).toBe('홍길동'); expect((await (await get('/preview/customers/C001/orders')).json()).items).toHaveLength(3); expect((await get('/preview/customers/C999')).status).toBe(404); expect((await get('/preview/customers/C001', { method: 'PATCH', body: JSON.stringify({ status: 'bad' }) })).status).toBe(400); const updated = await (await get('/preview/customers/C001', { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) })).json(); expect(updated.status).toBe('suspended'); expect((await (await get('/preview/customers/C001')).json()).status).toBe('suspended'); });
test('OpenAPI describes all methods and service token scheme', async () => { const spec = await (await get('/openapi.json')).json(); expect(spec.openapi).toBe('3.1.0'); expect(spec.paths['/customers/{id}'].patch).toBeTruthy(); expect(spec.components.securitySchemes.serviceToken.name).toBe('X-Service-Token'); expect(spec.servers).toBeUndefined(); });

test('environment token and datasets cannot cross', async () => {
  expect((await get('/live/customers')).status).toBe(401);
  const live = await get('/live/customers', { headers: {'X-Service-Token':'test-upstream-token-live'} });
  expect(live.status).toBe(200); const data = await live.json(); expect(data.dataset).toBe('live'); expect(data.items[0].grade).toBe('live-only');
  const preview = await (await get('/preview/customers')).json(); expect(preview.dataset).toBe('preview'); expect(preview.items[0].grade).not.toBe('live-only');
  expect((await get('/preview/customers', {headers:{'X-Service-Token':'test-upstream-token-live'}})).status).toBe(401);
});

test('missing and equal environment tokens are rejected', () => {
  for (const pair of [['', 'live'], ['preview', ''], ['same', 'same']]) expect(() => createMockBackend(pair[0], pair[1])).toThrow('Distinct');
});
