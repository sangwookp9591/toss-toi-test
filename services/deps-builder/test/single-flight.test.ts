import test from 'node:test';
import assert from 'node:assert/strict';
import { PackageBuilder, type BuilderOptions } from '../src/builder.js';
import { MemoryStore } from './helpers.js';


function fixture(expectedInstalls: number) {
  const store = new MemoryStore();
  let installs = 0, bundles = 0, cleanups = 0, releaseInstalls!: () => void, releaseBuild!: () => void;
  const installed = new Promise<void>(resolve => { releaseInstalls = resolve; });
  const building = new Promise<void>(resolve => { releaseBuild = resolve; });
  // Deliberately identical raw lock bytes, independent of request descriptors.
  // Real Yarn locks can retain differing range descriptors even for the same version.
  const lock = Buffer.from('__metadata:\n  version: 8\n"react@npm:19.3.0":\n  version: 19.3.0\n');
  const options: BuilderOptions = {
    install: async () => {
      if (++installs === expectedInstalls) releaseInstalls();
      await installed;
      return { directory: 'fixture', lock, cleanup: async () => { cleanups++; } };
    },
    bundle: async () => {
      bundles++; await building;
      return { files: [{ path: 'react.js', body: Buffer.from('export const version = "19.3.0";') }], entryPaths: { react: 'react.js' } };
    },
  };
  return { store, options, releaseBuild: () => releaseBuild(), counts: () => ({ installs, bundles, cleanups }) };
}

test('different ranges converging to identical lock bytes build and upload one manifest', async () => {
  const f = fixture(2), builder = new PackageBuilder(f.store, f.options);
  const results = await Promise.all(['^19.0.0', '19.3.0'].map(react => builder.request({ entries: ['react'], dependencies: { react } })));
  assert.equal(results[0].artifactKey, results[1].artifactKey);
  assert.deepEqual(results.map(result => result.status), ['building', 'building']);
  assert.equal(builder.metrics.installs, 2);
  assert.equal(f.counts().bundles, 1);
  // A third candidate reaches the artifact while the first build is still blocked.
  const third = await builder.request({ entries: ['react'], dependencies: { react: '~19.3.0' } });
  assert.equal(third.artifactKey, results[0].artifactKey);
  assert.equal(f.counts().bundles, 1);
  f.releaseBuild();
  assert.equal((await builder.wait(results[0].artifactKey, 1000))?.status, 'ready');
  assert.equal(builder.metrics.builds, 1);
  assert.deepEqual(f.counts(), { installs: 3, bundles: 1, cleanups: 3 });
  assert.equal(f.store.puts.filter(key => key.endsWith('/react.js')).length, 1);
  assert.equal(f.store.puts.filter(key => key.endsWith('/manifest.json')).length, 1);
  assert.equal([...f.store.objects.keys()].filter(key => key.endsWith('/manifest.json')).length, 1);
  // A fresh process/candidate must recheck the stored manifest after install, too.
  const restarted = new PackageBuilder(f.store, f.options);
  assert.equal((await restarted.request({ entries: ['react'], dependencies: { react: '>=19.3.0' } })).status, 'ready');
  assert.equal(restarted.metrics.builds, 0);
  assert.equal(f.counts().bundles, 1);
});

test('entry order and dependency key order merge before installation', async () => {
  const f = fixture(1), builder = new PackageBuilder(f.store, f.options);
  const results = await Promise.all([
    builder.request({ entries: ['react', 'react/jsx-runtime'], dependencies: { react: '19.3.0', 'react-dom': '19.3.0' } }),
    builder.request({ entries: ['react/jsx-runtime', 'react'], dependencies: { 'react-dom': '19.3.0', react: '19.3.0' } }),
  ]);
  assert.equal(results[0].artifactKey, results[1].artifactKey);
  assert.equal(f.counts().installs, 1);
  f.releaseBuild(); await builder.wait(results[0].artifactKey, 1000);
  assert.equal(f.counts().bundles, 1);
});
