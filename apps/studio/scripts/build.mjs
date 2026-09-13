import { context } from 'esbuild';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
export async function build(watch=false) {
  // Vite-compatible public env names; this app keeps its existing esbuild pipeline.
  const { parseEnv } = await import('node:util');
  let fileEnv = {}; try { fileEnv = parseEnv(await readFile('../../.env', 'utf8')); } catch {}
  const publicEnv = Object.fromEntries(['VITE_OIDC_ISSUER', 'VITE_OIDC_CLIENT_ID'].flatMap(key => {
    const value = process.env[key] ?? fileEnv[key]; return value ? [[key, value]] : [];
  }));
  const ctx = await context({ define: { 'import.meta.env': JSON.stringify(publicEnv) }, entryPoints: { studio:'src/main.tsx', worker:'../../packages/preview-runtime/src/worker.ts', frame:'../../packages/preview-runtime/src/frame.ts', runtime:'../../packages/preview-runtime/src/index.ts' }, outdir:'dist', bundle:true, format:'esm', platform:'browser', target:'es2022', jsx:'automatic', sourcemap:true });
  await ctx.rebuild(); await cp('../../packages/preview-runtime/node_modules/esbuild-wasm/esbuild.wasm','dist/esbuild.wasm');
  if(watch)await ctx.watch();else await ctx.dispose();return ctx;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await build();
