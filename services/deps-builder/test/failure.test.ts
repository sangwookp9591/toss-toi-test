import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install, classifyInstallFailure } from '../src/installer.js';
import { BuilderError, InputError } from '../src/security.js';
import { PackageBuilder, type BuilderOptions } from '../src/builder.js';
import { createApp } from '../src/server.js';
import { listen, close, MemoryStore } from './helpers.js';
const request = { entries: ['react'], dependencies: { react: '9999.0.0-missing' } };

test('real Yarn distinguishes connection refusal from a healthy registry package 404', async () => {
  const server = createServer((req, res) => { res.writeHead(req.url === '/-/ping' ? 200 : 404, { 'Content-Type': 'application/json' }); res.end('{}'); });
  const url = await listen(server);
  const cacheRoot = await mkdtemp(join(tmpdir(), 'toi-registry-classification-'));
  try {
    await assert.rejects(install(request, { registry: url, token: '', cacheRoot }), (error: unknown) => error instanceof InputError);
    await close(server);
    await assert.rejects(install(request, { registry: url, token: '', cacheRoot }), (error: unknown) => error instanceof BuilderError && error.code === 'registry_unavailable');
  } finally { if (server.listening) await close(server); await rm(cacheRoot, { recursive: true, force: true }); }
});

test('network, DNS, timeout and 5xx are registry failures; ambiguous failures probe health', async () => {
  let healthy = true, pings = 0;
  const server = createServer((_req, res) => { pings++; res.writeHead(healthy ? 200 : 503).end('{}'); });
  const url = await listen(server);
  try {
    for (const message of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'Request timed out', 'Response Code: 503', 'HTTP 502']) {
      assert.equal((await classifyInstallFailure(message, url)).code, 'registry_unavailable');
    }
    assert.equal(pings, 0);
    assert.equal((await classifyInstallFailure('YN0082: No candidates found', url)).code, 'input');
    assert.equal((await classifyInstallFailure('Unexpected Yarn crash', url)).code, 'internal');
    healthy = false;
    assert.equal((await classifyInstallFailure('No candidates found', url)).code, 'registry_unavailable');
    assert.equal((await classifyInstallFailure('Unknown installation failure', url)).code, 'registry_unavailable');
    assert.equal(pings, 4);
  } finally { await close(server); }
});

test('HTTP failure codes, async failed codes, and identical-request retries are not cached', async () => {
  const store = new MemoryStore();
  let installFailure: BuilderError | undefined = new BuilderError('registry_unavailable', 'masked');
  let bundleFailure: Error | undefined;
  const options: BuilderOptions = {
    log: () => {},
    install: async () => { if (installFailure) throw installFailure; return { directory: 'fixture', lock: Buffer.from('lock'), cleanup: async () => {} }; },
    bundle: async () => { if (bundleFailure) throw bundleFailure; return { files: [{ path: 'react.js', body: Buffer.from('export default {};') }], entryPaths: { react: 'react.js' } }; },
  };
  const builder = new PackageBuilder(store, options), server = createApp(builder), url = await listen(server);
  const post = () => fetch(url + '/package-sets', { method: 'POST', body: JSON.stringify(request) });
  try {
    for (const [code, status] of [['registry_unavailable', 503], ['input', 400], ['internal', 500]] as const) {
      installFailure = new BuilderError(code, 'do-not-display');
      const response = await post(); assert.equal(response.status, status); assert.equal((await response.json()).code, code);
    }
    installFailure = undefined; store.fail = true;
    const unavailable = await post(); assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).code, 'storage_unavailable');
    store.fail = false; bundleFailure = new Error('Unexpected bundler crash');
    const first = await (await post()).json();
    const failed = await builder.wait(first.artifactKey, 1000);
    assert.equal(failed?.status, 'failed'); assert.equal(failed && 'code' in failed && failed.code, 'internal');
    // Fail an actual storage operation after the build has started.
    bundleFailure = undefined; options.beforeUpload = async () => { store.fail = true; };
    await post(); const storageFailed = await builder.wait(first.artifactKey, 1000);
    assert.equal(storageFailed?.status, 'failed'); assert.equal(storageFailed && 'code' in storageFailed && storageFailed.code, 'storage_unavailable');
    store.fail = false; options.beforeUpload = undefined;
    assert.equal((await post()).status, 202);
    assert.equal((await builder.wait(first.artifactKey, 1000))?.status, 'ready');
    assert.equal(builder.metrics.builds, 3);
    assert.equal((await post()).status, 200);
  } finally { await close(server); }
});
