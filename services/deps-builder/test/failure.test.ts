import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install, classifyInstallFailure } from '../src/installer.js';
import { BuilderError, InputError, storageOperation } from '../src/security.js';
import { storageTimeouts } from '../src/config.js';
import { PackageBuilder, type BuilderOptions } from '../src/builder.js';
import { createApp, idleTimeout } from '../src/server.js';
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

test('cleanup failure does not change the build result or retain build ownership', async () => {
  const builder = new PackageBuilder(new MemoryStore(), {
    install: async () => ({ directory: 'fixture', lock: Buffer.from('cleanup-lock'), cleanup: async () => { throw new Error('cleanup failed'); } }),
    bundle: async () => ({ files: [{ path: 'react.js', body: Buffer.from('export default {};') }], entryPaths: { react: 'react.js' } }),
    log: () => {},
  });
  const building = await builder.request({ entries: ['react'], dependencies: { react: '19.3.0' } });
  assert.equal((await builder.wait(building.artifactKey, 1000))?.status, 'ready');
  assert.equal(builder.builds.size, 0);
});

test('storage get timeout is classified and the same artifact can be retried', async () => {
  const previous = process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS;
  process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS = '20';
  let gets = 0;
  let blocked = true;
  const objects = new Map<string, Buffer>();
  const store = {
    get: async (key: string) => {
      if (blocked && ++gets === 3) await new Promise<never>(() => {});
      return objects.get(key);
    },
    put: async (key: string, body: Buffer) => { objects.set(key, body); },
    stream: async () => { throw new Error('unused'); },
  };
  try {
    const builder = new PackageBuilder(store, {
      install: async () => ({ directory: 'fixture', lock: Buffer.from('timeout-lock'), cleanup: async () => {} }),
      bundle: async () => ({ files: [{ path: 'react.js', body: Buffer.from('export default {};') }], entryPaths: { react: 'react.js' } }),
      log: () => {},
    });
    const first = await builder.request({ entries: ['react'], dependencies: { react: '19.3.0' } });
    assert.equal((await builder.wait(first.artifactKey, 1000))?.status, 'failed');
    const failed = await builder.status(first.artifactKey);
    assert.equal(failed && 'code' in failed && failed.code, 'storage_unavailable');
    assert.equal(builder.builds.size, 0);
    blocked = false;
    const retry = await builder.request({ entries: ['react'], dependencies: { react: '19.3.0' } });
    assert.equal((await builder.wait(retry.artifactKey, 1000))?.status, 'ready');
  } finally {
    if (previous === undefined) delete process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS;
    else process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS = previous;
  }
});

test('storage timeout aborts the operation and destroys a late stream', async () => {
  let aborted = false, destroyed = false;
  const late = new Readable({ read() {} });
  late.destroy = ((error?: Error) => { destroyed = true; return Readable.prototype.destroy.call(late, error); }) as typeof late.destroy;
  await assert.rejects(storageOperation(async signal => {
    signal.addEventListener('abort', () => { aborted = true; });
    await new Promise(resolve => setTimeout(resolve, 30));
    return late;
  }, 5), /Artifact storage unavailable/);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(aborted, true); assert.equal(destroyed, true);
});

test('storage timeout environment values require a bounded integer', () => {
  const previous = process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS;
  try {
    for (const value of ['0', '-1', '1.5', 'abc', '2147483648']) {
      process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS = value;
      assert.throws(() => storageTimeouts(), /1 to 2147483647/);
    }
    process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS = '1';
    assert.equal(storageTimeouts().get, 1);
    process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS = '2147483647';
    assert.equal(storageTimeouts().get, 2147483647);
  } finally {
    if (previous === undefined) delete process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS;
    else process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS = previous;
  }
});

test('streaming assets are destroyed after an idle timeout', async () => {
  const stream = new Readable({ read() {} });
  const error = new Promise<Error>(resolve => stream.once('error', resolve));
  idleTimeout(stream, 5);
  assert.match((await error).message, /idle timeout/);
  assert.equal(stream.destroyed, true);
});
