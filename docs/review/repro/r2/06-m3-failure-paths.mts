// R2-M3: 새 artifactKey 예약(single-flight) 로직의 실패 경로 — 교착·영구 building·예약 누수·중복 빌드.
// 실제 install/bundle/MinIO 대신 주입 가능한 fixture를 사용한다(BuilderOptions.install/bundle). 실행 중 7100은 건드리지 않는다.
// 실행(루트): node --import ./services/deps-builder/node_modules/tsx/dist/loader.mjs docs/review/repro/r2/06-m3-failure-paths.mts
import { Readable } from 'node:stream';
import { PackageBuilder, type BuilderOptions } from '../../../../services/deps-builder/src/builder.ts';
import type { ObjectStore } from '../../../../services/deps-builder/src/store.ts';

const unhandled: string[] = [];
process.on('unhandledRejection', error => { unhandled.push(String((error as Error)?.message ?? error)); });
class Store implements ObjectStore {
  objects = new Map<string, Buffer>(); puts: string[] = []; failGet = false; hangGet = false;
  async get(key: string) { await Promise.resolve(); if (this.hangGet && key.endsWith('manifest.json')) await new Promise(() => {}); if (this.failGet && key.endsWith('manifest.json')) throw new Error('store down'); return this.objects.get(key); }
  async put(key: string, body: Buffer) { this.puts.push(key); this.objects.set(key, body); }
  async stream(key: string) { return Readable.from(this.objects.get(key) ?? []); }
}
const lock = Buffer.from('__metadata:\n  version: 8\n"react@npm:19.3.0":\n  version: 19.3.0\n');
function make(opts: { bundleFails?: () => boolean; cleanupThrows?: () => boolean; installDelayMs?: (i: number) => number } = {}) {
  const store = new Store(); const counts = { installs: 0, bundles: 0, cleanups: 0 };
  const options: BuilderOptions = {
    install: async () => { const i = counts.installs++; await new Promise(r => setTimeout(r, opts.installDelayMs?.(i) ?? 5)); return { directory: 'fixture', lock, cleanup: async () => { counts.cleanups++; if (opts.cleanupThrows?.()) throw new Error('cleanup failed'); } }; },
    bundle: async () => { counts.bundles++; await new Promise(r => setTimeout(r, 20)); if (opts.bundleFails?.()) throw new Error('bundle failed'); return { files: [{ path: 'react.js', body: Buffer.from('export {}') }], entryPaths: { react: 'react.js' } }; },
    log: () => {},
  };
  return { store, counts, builder: new PackageBuilder(store, options) };
}
const internals = (b: PackageBuilder) => ({ artifacts: (b as any).artifacts.size as number, requests: (b as any).requests.size as number, builds: b.builds.size });
const req = (react: string) => ({ entries: ['react'], dependencies: { react } });
const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<'TIMEOUT'>(r => setTimeout(() => r('TIMEOUT'), ms))]);

console.log('== 1. 다른 range 3개 동시 요청(설치 완료 시점이 서로 다름) → 빌드 1회, 예약 정리');
{
  const { builder, counts } = make({ installDelayMs: i => [5, 40, 80][i] });
  const results = await Promise.all(['^19.0.0', '19.3.0', '~19.3.0'].map(v => builder.request(req(v))));
  const final = await builder.wait(results[0].artifactKey, 2000);
  console.log(JSON.stringify({ keysEqual: new Set(results.map(r => r.artifactKey)).size === 1, final: final?.status, counts, internals: internals(builder) }));
}
console.log('== 2. 빌드 실패 → failed 로 끝나고 재요청 시 재빌드 (영구 building / 예약 누수 없음)');
{
  let fail = true; const { builder, counts } = make({ bundleFails: () => fail });
  const first = await builder.request(req('19.3.0'));
  const afterFail = await builder.wait(first.artifactKey, 2000);
  fail = false;
  const retry = await builder.request(req('^19.0.0'));
  const afterRetry = await builder.wait(retry.artifactKey, 2000);
  console.log(JSON.stringify({ afterFail: afterFail?.status, retryImmediate: retry.status, afterRetry: afterRetry?.status, counts, internals: internals(builder) }));
}
console.log('== 3. 예약 중 manifest 조회(store.get) 실패 → 동시 대기자 모두 reject, 예약 정리, 이후 복구');
{
  const { builder, store, counts } = make({ installDelayMs: i => [5, 6][i] });
  store.failGet = true;
  const settled = await Promise.allSettled(['^19.0.0', '19.3.0'].map(v => builder.request(req(v))));
  const mid = internals(builder);
  store.failGet = false;
  const recovered = await builder.request(req('19.3.0'));
  console.log(JSON.stringify({ settled: settled.map(s => s.status === 'rejected' ? 'rejected:' + (s.reason as Error).message : s.value.status), internalsAfterFailure: mid, recovered: recovered.status, counts }));
}
console.log('== 4. 예약 중 store.get이 영원히 응답하지 않음 → 같은 artifactKey로 수렴하는 모든 요청이 무기한 대기(타임아웃 없음)');
{
  const { builder, store } = make({ installDelayMs: i => [5, 30][i] });
  store.hangGet = true;
  const a = withTimeout(builder.request(req('^19.0.0')), 500), b = withTimeout(builder.request(req('19.3.0')), 500);
  console.log(JSON.stringify({ results: await Promise.all([a, b]), internals: internals(builder) }));
}
console.log('== 5. 빌드 후 installed.cleanup()이 throw → builds 맵 잔존 여부와 이후 요청 결과');
{
  let throwNow = false; const { builder, counts } = make({ bundleFails: () => true, cleanupThrows: () => throwNow });
  throwNow = true;
  const first = await builder.request(req('19.3.0'));
  await new Promise(r => setTimeout(r, 100));
  const state1 = await builder.status(first.artifactKey);
  const mid = internals(builder);
  throwNow = false;
  const again = await builder.request(req('^19.0.0'));
  await new Promise(r => setTimeout(r, 100));
  console.log(JSON.stringify({ stateAfterFailedBuild: state1?.status, internalsAfter: mid, secondRequest: again.status, bundlesTotal: counts.bundles, unhandledRejections: unhandled }));
}
