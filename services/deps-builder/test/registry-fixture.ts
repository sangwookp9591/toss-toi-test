// Private child-process fixture for E2E M: real Yarn + builder, disposable memory
// artifacts/cache and an isolated registry proxy. No shared service is stopped.
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { PackageBuilder } from '../src/builder.js';
import { createApp } from '../src/server.js';
import { settings } from '../src/config.js';
import type { ObjectStore } from '../src/store.js';
let unavailable = true, failedRequests = 0;
const upstream = settings().registry;
const registry = createServer(async (req, res) => {
  if (unavailable) { failedRequests++; res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"test registry unavailable"}'); return; }
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (value && name !== 'host') headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const response = await fetch(upstream + req.url, { headers });
    res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json' });
    const body = Buffer.from(await response.arrayBuffer());
    // Keep tarball requests behind this registry too, preserving Yarn's scoped
    // authentication and HTTP hostname policy after the proxy recovers.
    res.end(response.headers.get('content-type')?.includes('json') ? body.toString().split(upstream).join(registryUrl) : body);
  } catch { res.writeHead(503).end(); }
});
await new Promise<void>(resolve => registry.listen(0, '127.0.0.1', resolve));
const registryUrl = `http://127.0.0.1:${(registry.address() as { port: number }).port}`;
const objects = new Map<string, Buffer>();
const store: ObjectStore = {
  get: async key => objects.get(key), put: async (key, body) => { objects.set(key, body); },
  stream: async key => Readable.from(objects.get(key) ?? []),
};
const cacheRoot = await mkdtemp(join(tmpdir(), 'toi-e2e-registry-'));
const builder = new PackageBuilder(store, { registry: registryUrl, cacheRoot, log: () => {} });
const server = createApp(builder);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://localhost:${(server.address() as { port: number }).port}`;
builder.publicUrl = url;
process.send?.({ type: 'ready', url });
let closing = false;
async function cleanup() {
  if (closing) return; closing = true;
  server.closeAllConnections(); registry.closeAllConnections(); server.close(); registry.close();
  await Promise.all(builder.builds.values()); await rm(cacheRoot, { recursive: true, force: true });
  process.exit(0);
}
process.on('message', message => {
  if (message === 'recover') { unavailable = false; process.send?.({ type: 'recovered', failedRequests }); }
  if (message === 'close') void cleanup();
});
process.on('disconnect', () => void cleanup());
process.on('SIGTERM', () => void cleanup());
