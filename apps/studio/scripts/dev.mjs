import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build } from './build.mjs';
import { previewHostPattern, previewDocument, studioHeaders } from './security.mjs';
const ctx = await build(true);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
const bench = process.env.TOI_ENABLE_BENCH === 'true';
const probes = new Map();
const studioFiles = new Map([['/', 'public/index.html'], ['/studio.js', 'dist/studio.js'], ['/studio.css', 'dist/studio.css'], ['/runtime.js', 'dist/runtime.js'], ['/worker.js', 'dist/worker.js'], ['/esbuild.wasm', 'dist/esbuild.wasm']]);
if (bench) for (const [url, file] of [['/sandpack.html', '../../bench/sandpack.html'], ['/sandpack.js', '../../bench/dist/sandpack.js'], ['/bench.html', '../../bench/toi.html'], ['/bench.js', '../../bench/dist/toi.js']]) studioFiles.set(url, file);
const servers = [5273, 5274].map(port => createServer(async (req, res) => {
  if (port === 5274 && !previewHostPattern.test(req.headers.host ?? '')) { res.writeHead(421).end('Misdirected Request'); return; }
  if (port === 5273) for (const [key, value] of Object.entries(studioHeaders)) res.setHeader(key, value);
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (process.env.TOI_E2E === 'true' && port === 5274 && /^\/__csp_probe_[a-z0-9-]+$/.test(pathname)) probes.set(pathname, (probes.get(pathname) ?? 0) + 1);
  if (process.env.TOI_E2E === 'true' && port === 5273 && pathname === '/__test/csp-requests') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(Object.fromEntries(probes))); return; }
  if (port === 5273 && pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true,"service":"studio"}'); return; }
  const file = port === 5274 ? ({ '/frame.html': '../../packages/preview-runtime/public/frame.html', '/frame.js': 'dist/frame.js' })[pathname] : studioFiles.get(pathname);
  if (!file) { res.writeHead(404).end('Not found'); return; }
  try {
    const content = await readFile(resolve(file));
    if (port === 5274 && pathname === '/frame.html') {
      const document = previewDocument(content.toString()); res.writeHead(200, document.headers).end(document.body);
    } else res.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(content);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Studio ${port === 5273 ? 'app http://localhost:5273' : 'preview http://p-<projectId>.preview.localhost:5274'}`)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { for (const server of servers) server.close(); await ctx.dispose(); process.exit(0); });
