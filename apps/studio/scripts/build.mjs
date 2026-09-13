import { context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
export async function build(watch=false) {
  const ctx = await context({ entryPoints: { studio:'src/main.tsx', worker:'../../packages/preview-runtime/src/worker.ts', frame:'../../packages/preview-runtime/src/frame.ts', runtime:'../../packages/preview-runtime/src/index.ts' }, outdir:'dist', bundle:true, format:'esm', platform:'browser', target:'es2022', jsx:'automatic', sourcemap:true });
  await ctx.rebuild(); await cp('../../packages/preview-runtime/node_modules/esbuild-wasm/esbuild.wasm','dist/esbuild.wasm');
  if(watch)await ctx.watch();else await ctx.dispose();return ctx;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await build();
