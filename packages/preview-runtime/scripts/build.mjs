import { context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
export async function build(watch = false) {
  await mkdir('dist', { recursive: true });
  const ctx = await context({ entryPoints: { runtime: 'src/index.ts', worker: 'src/worker.ts', frame: 'src/frame.ts', demo: 'demo/main.ts', fixture: 'demo/fixture.ts' }, outdir: 'dist', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', sourcemap: true });
  await ctx.rebuild();
  await cp('node_modules/esbuild-wasm/esbuild.wasm', 'dist/esbuild.wasm');
  if (watch) await ctx.watch(); else await ctx.dispose();
  return ctx;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await build();
