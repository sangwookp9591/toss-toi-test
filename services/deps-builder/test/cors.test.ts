import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {previewOriginForProject} from '../../../contracts/src/runtime.js';
import {Readable} from 'node:stream';
test('project preview CORS is restricted to GET/HEAD published assets; management remains studio-only', async () => {
 const key='a'.repeat(64); let requests=0;
 const server=createApp({status:async()=>({status:'ready',manifest:{files:[{path:'entry.js'}]}}),store:{stream:async()=>Readable.from(['export const ok=true'])},request:async()=>{requests++;return {status:'building'};}} as any);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 try {
  const origin=previewOriginForProject('00000000-0000-4000-8000-000000000000');
  for(const method of ['GET','HEAD']) {
   const result=await fetch(`${base}/assets/${key}/entry.js`,{method,headers:{Origin:origin}});
   assert.equal(result.status,200);assert.equal(result.headers.get('access-control-allow-origin'),origin);assert.equal(result.headers.get('vary'),'Origin');assert.equal(result.headers.get('access-control-allow-credentials'),null);
  }
  for(const other of ['http://localhost:5274','http://evil.invalid','http://p-invalid.preview.localhost:5274']) {
   const result=await fetch(`${base}/assets/${key}/entry.js`,{headers:{Origin:other}});assert.equal(result.status,403);assert.equal(result.headers.get('access-control-allow-origin'),null);
  }
  for(const path of ['/package-sets',`/package-sets/${key}`]) assert.equal((await fetch(base+path,{method:'POST',headers:{Origin:origin},body:'{}'})).status,403);
  assert.equal(requests,0);
  assert.equal((await fetch(base+'/package-sets',{method:'POST',headers:{Origin:'http://localhost:5273'},body:'{}'})).status,202);
  assert.equal(requests,1);
  assert.equal((await fetch(`${base}/assets/${key}/entry.js`,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST'}})).status,403);
 } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
