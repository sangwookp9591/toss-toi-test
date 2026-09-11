import fs from 'node:fs';import path from 'node:path';import {build}from'esbuild';
fs.mkdirSync('public',{recursive:true});
const common={bundle:true,platform:'browser',format:'esm',target:'es2022',define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning'};
await build({...common,entryPoints:['node_modules/sucrase/dist/index.js'],outfile:'public/sucrase.js'});
fs.copyFileSync('node_modules/@babel/standalone/babel.min.js','public/babel.js');
for(const [name,dir,entry]of [['rolldown','node_modules/@rolldown/browser/dist','index.browser.mjs'],['oxc','node_modules/@oxc-transform/binding-wasm32-wasi','transform.wasi-browser.js']]){
 fs.mkdirSync('public/'+name,{recursive:true});await build({...common,entryPoints:[dir+'/'+entry],outfile:'public/'+name+'/index.js'});
 await build({...common,entryPoints:[dir+'/wasi-worker-browser.mjs'],outfile:'public/'+name+'/wasi-worker-browser.mjs'});
 for(const f of fs.readdirSync(dir))if(f.endsWith('.wasm'))fs.copyFileSync(dir+'/'+f,'public/'+name+'/'+f);
}
console.log('Browser tool adapters prepared; published WASM and worker paths preserved.');
