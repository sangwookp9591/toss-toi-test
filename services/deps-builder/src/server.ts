import { createServer, type ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { PackageBuilder } from './builder.js';
import { failureCode, InputError } from './security.js';
const allowedOrigins = new Set(['http://localhost:5173', 'http://localhost:5174']);
function json(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
export function createApp(builder: PackageBuilder) {
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); }
    if (req.method === 'OPTIONS') { res.writeHead(origin && !allowedOrigins.has(origin) ? 403 : 204); res.end(); return; }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { status: 'ok' });
      if (req.method === 'POST' && url.pathname === '/package-sets') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 32768) throw new InputError('Request is too large'); }
        let input: unknown; try { input = JSON.parse(raw); } catch { throw new InputError('Invalid JSON'); }
        const status = await builder.request(input); return json(res, status.status === 'building' ? 202 : 200, status);
      }
      const statusMatch = url.pathname.match(/^\/package-sets\/([a-f0-9]{64})(\/wait)?$/);
      if (req.method === 'GET' && statusMatch) {
        const timeout = Math.min(30000, Math.max(0, Number(url.searchParams.get('timeoutMs') ?? 30000) || 0));
        const status = statusMatch[2] ? await builder.wait(statusMatch[1], timeout) : await builder.status(statusMatch[1]);
        return json(res, status ? 200 : 404, status ?? { error: 'Unknown artifactKey' });
      }
      const assetMatch = url.pathname.match(/^\/assets\/([a-f0-9]{64})\/(.+)$/);
      if (req.method === 'GET' && assetMatch) {
        const [, key, filename] = assetMatch;
        const status = await builder.status(key);
        // Files remain inaccessible until a verified manifest is published.
        if (!status || status.status !== 'ready' || (filename !== 'manifest.json' && !status.manifest.files.some(file => file.path === filename))) return json(res, 404, { error: 'Asset is not published' });
        const stream = await builder.store.stream(`${key}/${filename}`);
        res.writeHead(200, { 'Content-Type': filename.endsWith('.json') ? 'application/json' : filename.endsWith('.css') ? 'text/css' : 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        await pipeline(stream, res); return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      const code = failureCode(error);
      if (!res.headersSent) json(res, code === 'input' ? 400 : code === 'internal' ? 500 : 503, {
        error: code === 'input' ? 'Invalid or unresolvable package set' : code === 'registry_unavailable' ? 'Package registry unavailable' : code === 'storage_unavailable' ? 'Artifact storage unavailable' : 'Internal builder error', code,
      });
      else res.destroy();
    }
  });
}
