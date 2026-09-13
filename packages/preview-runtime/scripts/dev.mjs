import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build } from './build.mjs';
const ctx = await build(true);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.map': 'application/json' };
const servers = [5173, 5174].map(port => createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const route = pathname === '/' ? 'demo/index.html' : pathname === '/frame.html' ? 'public/frame.html' : 'dist' + pathname;
  const path = resolve(route);
  if (!path.startsWith(resolve('.') + '/')) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(path);
    if (pathname === '/frame.html' && process.env.STUDIO_ORIGIN) {
      body = Buffer.from(body.toString().replace('http://localhost:5173,http://127.0.0.1:5173', process.env.STUDIO_ORIGIN.replace(/[<>&"']/g, '')));
    }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, () => console.log(`Preview ${port === 5173 ? 'studio' : 'origin'}: http://localhost:${port}`)));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { for (const server of servers) server.close(); await ctx.dispose(); process.exit(0); });
