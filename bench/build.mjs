import{build}from'esbuild';
await build({entryPoints:{sandpack:'sandpack.tsx',toi:'toi.js'},outdir:'dist',bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',external:['/runtime.js'],define:{'process.env.NODE_ENV':'"production"'}});
