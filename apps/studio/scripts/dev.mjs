import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build } from './build.mjs';
const ctx=await build(true);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const servers=[5173,5174].map(port=>createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true,"service":"studio"}');return;}
  let file=path==='/'?'public/index.html':path==='/frame.html'?'../../packages/preview-runtime/public/frame.html':'dist'+path;
  if(path==='/sandpack.html')file='../../bench/sandpack.html';
  if(path==='/sandpack.js')file='../../bench/dist/sandpack.js';
  if(path==='/bench.html')file='../../bench/toi.html';
  if(path==='/bench.js')file='../../bench/dist/toi.js';
  if(path.includes('..')){res.writeHead(403).end();return;}
  try {const content=await readFile(resolve(file));res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(404).end('Not found');}
}).listen(port,()=>console.log(`Studio ${port===5173?'app':'preview'} http://localhost:${port}`)));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{for(const server of servers)server.close();await ctx.dispose();process.exit(0);});
