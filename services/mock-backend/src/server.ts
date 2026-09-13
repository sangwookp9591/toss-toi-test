import { createServer, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { seedCustomers, customerOrders } from './data.js';
import { openapi } from './openapi.js';
const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
export function createMockBackend(serviceToken: string, liveToken: string) {
  if (!serviceToken || !liveToken || serviceToken === liveToken) throw new Error('Distinct environment service tokens required');
  const datasets = { preview: seedCustomers(), live: seedCustomers().map(c => ({ ...c, grade: 'live-only' })) };
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock.invalid');
    const environment = url.pathname.startsWith('/live/') ? 'live' : 'preview';
    const customers = datasets[environment];
    const supplied = req.headers['x-service-token'];
    const actual = Buffer.from(typeof supplied === 'string' ? supplied : ''), expected = Buffer.from(environment === 'preview' ? serviceToken : liveToken);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json(res, 401, { error: 'Service authentication required' });
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && url.pathname === '/openapi.json') return json(res, 200, openapi);
    if (!/^\/(preview|live)\//.test(url.pathname)) return json(res, 404, { error: 'Environment path required' });
    url.pathname = url.pathname.replace(/^\/(preview|live)/, '');
    if (req.method === 'GET' && url.pathname === '/customers') {
      const page = Number(url.searchParams.get('page') ?? 1), size = Number(url.searchParams.get('size') ?? 20), query = (url.searchParams.get('query') ?? '').toLowerCase();
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 100) return json(res, 400, { error: 'Invalid pagination' });
      const filtered = customers.filter(customer => [customer.id, customer.name, customer.email, customer.phone].some(value => value.toLowerCase().includes(query)));
      return json(res, 200, { dataset: environment, items: filtered.slice((page - 1) * size, page * size), total: filtered.length, page, size });
    }
    const match = url.pathname.match(/^\/customers\/(C\d{3})(\/orders)?$/);
    if (match) {
      const customer = customers.find(item => item.id === match[1]);
      if (!customer) return json(res, 404, { error: 'Customer not found' });
      if (req.method === 'GET') return json(res, 200, match[2] ? { items: customerOrders(customer.id) } : customer);
      if (req.method === 'PATCH' && !match[2]) {
        try {
          let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw new Error(); }
          const body = JSON.parse(raw);
          if (!body || Object.keys(body).length !== 1 || !['active', 'inactive', 'suspended'].includes(body.status)) return json(res, 400, { error: 'Only a valid status may be changed' });
          customer.status = body.status; return json(res, 200, customer);
        } catch { return json(res, 400, { error: 'Invalid JSON request' }); }
      }
    }
    json(res, 404, { error: 'Not found' });
  });
}
