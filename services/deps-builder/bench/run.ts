import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PackageBuilder } from '../src/builder.js';
import { createApp } from '../src/server.js';
import { MinioStore } from '../src/store.js';
import { serviceRoot, defaultProfile } from '../src/config.js';
import { sha256 } from '../src/hash.js';
import type { PackageSetStatus } from '../../../contracts/src/package-set.js';
const request = { entries: ['react', 'react/jsx-runtime', 'react-dom/client', '@toi/tds'], dependencies: { react: '19.3.0', 'react-dom': '19.3.0', '@toi/tds': '1.0.0' } };
const samples: { repeat: number; coldMs: number; warmMs: number; downloadMs: number; bytes: number; files: number; artifactKey: string }[] = [];
await mkdir(path.join(serviceRoot, '.cache'), { recursive: true });
for (let repeat = 1; repeat <= 3; repeat++) {
  const store = new MinioStore(`toi-bench-${randomUUID()}`); await store.init();
  const cacheRoot = await mkdtemp(path.join(serviceRoot, '.cache/bench-'));
  const builder = new PackageBuilder(store, { cacheRoot });
  const server = createApp(builder);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; builder.publicUrl = base;
  const post = () => fetch(`${base}/package-sets`, { method: 'POST', body: JSON.stringify(request) });
  try {
    const start = performance.now(), response = await post();
    if (response.status !== 202) throw new Error(`Expected cold miss; HTTP ${response.status}`);
    let status = await response.json() as PackageSetStatus;
    while (status.status === 'building') status = await (await fetch(`${base}/package-sets/${status.artifactKey}/wait?timeoutMs=30000`)).json() as PackageSetStatus;
    if (status.status !== 'ready') throw new Error('Benchmark build failed');
    const coldMs = performance.now() - start;
    const warmStart = performance.now(), hit = await post(); await hit.arrayBuffer();
    const warmMs = performance.now() - warmStart; if (hit.status !== 200) throw new Error('Warm cache miss');
    const downloadStart = performance.now(), manifestResponse = await fetch(status.manifestUrl), manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
    const manifest = JSON.parse(manifestBytes.toString());
    const bodies = await Promise.all(status.manifest.files.map(async file => {
      const response = await fetch(manifest.assetBaseUrl + file.path), body = Buffer.from(await response.arrayBuffer());
      if (sha256(body) !== file.sha256) throw new Error('Download integrity mismatch'); return body;
    }));
    samples.push({ repeat, coldMs, warmMs, downloadMs: performance.now() - downloadStart, bytes: manifestBytes.length + bodies.reduce((sum, body) => sum + body.length, 0), files: bodies.length, artifactKey: status.artifactKey });
    console.log(`Sample ${repeat}: cold ${coldMs.toFixed(1)}ms, warm ${warmMs.toFixed(1)}ms`);
  } finally {
    await Promise.all(builder.builds.values()); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    const objects: string[] = []; for await (const object of store.client.listObjectsV2(store.bucket, '', true)) if (object.name) objects.push(object.name);
    if (objects.length) await store.client.removeObjects(store.bucket, objects); await store.client.removeBucket(store.bucket); await rm(cacheRoot, { recursive: true, force: true });
  }
}
const median = (key: 'coldMs' | 'warmMs' | 'downloadMs') => samples.map(sample => sample[key]).sort((a, b) => a - b)[1];
await writeFile(path.join(serviceRoot, 'bench/results.json'), JSON.stringify({ measuredAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model }, request, buildProfile: defaultProfile(), methodology: { cold: 'New MinIO bucket, empty local Yarn cache and temporary workspace each trial; HTTP POST through ready includes resolution, install, build, upload and readback verification; Verdaccio upstream and OS caches not cleared', warm: 'Same request HTTP POST through body consumption; persistent request index plus manifest cache', download: 'Fetch manifest then all assets concurrently over local HTTP, consume bytes and verify SHA256; no browser cache or compression' }, samples, medians: { coldMs: median('coldMs'), warmMs: median('warmMs'), downloadMs: median('downloadMs') } }, null, 2) + '\n');
