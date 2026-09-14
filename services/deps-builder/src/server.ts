import { createServer, type ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PackageBuilder } from './builder.js';
import { failureCode, FAILURE_RESPONSES, InputError } from './security.js';
import { storageTimeouts } from './config.js';
import { projectIdFromPreviewOrigin } from '../../../contracts/src/runtime.js';
function json(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
export function idleTimeout<T extends Readable>(stream: T, timeoutMs: number): T {
  let timer = setTimeout(() => stream.destroy(new Error('Storage stream idle timeout')), timeoutMs);
  const reset = () => { clearTimeout(timer); timer = setTimeout(() => stream.destroy(new Error('Storage stream idle timeout')), timeoutMs); };
  stream.on('data', reset).once('close', () => clearTimeout(timer)).once('end', () => clearTimeout(timer));
  return stream;
}
export function createApp(builder: PackageBuilder) {
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method === 'OPTIONS' ? req.headers['access-control-request-method'] : req.method;
    const previewAsset = !!origin && !!projectIdFromPreviewOrigin(origin) && /^\/assets\/[a-f0-9]{64}\//.test(url.pathname) && (method === 'GET' || method === 'HEAD');
    const allowed = origin === 'http://localhost:5173' || previewAsset;
    res.setHeader('Vary', 'Origin');
    if (origin && !allowed) return json(res, 403, {error:'Origin is not allowed'});
    if (origin && allowed) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Methods', previewAsset ? 'GET, HEAD, OPTIONS' : 'GET, HEAD, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
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
      if ((req.method === 'GET' || req.method === 'HEAD') && assetMatch) {
        const [, key, filename] = assetMatch;
        const status = await builder.status(key);
        // Files remain inaccessible until a verified manifest is published.
        if (!status || status.status !== 'ready' || (filename !== 'manifest.json' && !status.manifest.files.some(file => file.path === filename))) return json(res, 404, { error: 'Asset is not published' });
        res.writeHead(200, { 'Content-Type': filename.endsWith('.json') ? 'application/json' : filename.endsWith('.css') ? 'text/css' : 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') {res.end(); return;}
        const stream = idleTimeout(await builder.store.stream(`${key}/${filename}`), storageTimeouts().get);
        await pipeline(stream, res); return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      const code = failureCode(error);
      if (!res.headersSent) json(res, FAILURE_RESPONSES[code].status, { error: FAILURE_RESPONSES[code].error, code });
      else res.destroy();
    }
  });
}
