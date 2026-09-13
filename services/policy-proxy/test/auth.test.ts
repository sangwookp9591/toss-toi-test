import { beforeAll, afterAll, test, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { token, member, memberships, identityConfig } from './identity-fixture.js';
import { createMockBackend } from '../../mock-backend/src/server.js';
import { createPolicyProxy } from '../src/server.js';
import { configuration, type PolicyConfig } from '../src/config.js';
import { PolicyStorage } from '../src/storage.js';
import { seedRegistry } from '../src/seed.js';
import { Access } from '../src/access.js';
const listen=(s:Server)=>new Promise<string>(r=>s.listen(0,'127.0.0.1',()=>r(`http://127.0.0.1:${(s.address() as {port:number}).port}`)));
const close=(s:Server)=>new Promise<void>(r=>{s.closeAllConnections();s.close(()=>r());});
let backend:Server,server:Server,base:string,dir:string,cfg:PolicyConfig,store:PolicyStorage,access:Access;
let alice:string,bob:string,carol:string,dana:string;
const call=(endpoint:string,t:string,body?:unknown,origin?:string)=>fetch(base+endpoint,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json',...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const preview=(t:string,write?:unknown)=>call('/preview-sessions',t,{projectId:'p',...(write?{write}:{})},'http://localhost:5173');
const cap=(t:string,env='preview',mode='read')=>call('/capabilities',t,{projectId:'p',env,mode,ttlSec:120,...(mode==='write'?{apiIds:['customers']}:{})});
const proxy=(t:string,c:string,method='GET')=>fetch(base+'/proxy/customers'+(method==='GET'?'/customers':'/customers/C001'),{method,headers:{Authorization:'Bearer '+t,'X-Toi-Project':'p','X-Toi-Capability':c,'X-Toi-Reason':'test customer support','Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify({status:'active'})})});
beforeAll(async()=>{
 dir=await mkdtemp(path.join(os.tmpdir(),'policy-auth-'));
 backend=createMockBackend('preview-private','live-private');const upstream=await listen(backend);
 cfg={...configuration({NODE_ENV:'test'}),...identityConfig,dataDir:dir,upstreamUrl:upstream,upstreamToken:'preview-private',liveToken:'live-private',upstreamAllowlist:[upstream+'/preview',upstream+'/live'],apiOwners:['dana'],approvalTtlSec:1};
 store=new PolicyStorage(dir);await store.init();await seedRegistry(store,cfg);access=new Access(cfg,store);server=createPolicyProxy(cfg,store,access);base=await listen(server);
 alice=await token('alice');bob=await token('bob');carol=await token('carol');dana=await token('dana',['api-owner']);member('p','alice','owner');member('p','bob','viewer');
});
afterAll(async()=>{await close(server);await close(backend);await rm(dir,{recursive:true,force:true});});
test('JWKS validates issuer audience signature and expiry; dev session stays removed',async()=>{
 for(const t of [await token('alice',['builder'],{iss:'http://evil'}),await token('alice',['builder'],{aud:'wrong'}),await token('alice',['builder'],{exp:Math.floor(Date.now()/1000)-1}),alice.slice(0,-8)+'invalid0'])expect((await call('/apis',t)).status).toBe(401);
 expect((await call('/dev/session',alice,{})).status).toBe(404);
 const service=await token('service-account-toi-agent-server',[],{azp:'toi-agent-server'});
 expect((await call('/apis',service)).status).toBe(200);expect((await cap(service)).status).toBe(403);
 expect((await call('/apis',await token('alice',[],{azp:'toi-agent-server'}))).status).toBe(403);
});
test('nonmember denied before API/capability; sessions require exact studio origin',async()=>{
 expect((await preview(carol)).status).toBe(404);expect((await cap(carol)).status).toBe(404);expect((await proxy(carol,'forged')).status).toBe(404);
 for(const origin of [undefined,'http://localhost:5174','null']) expect((await call('/preview-sessions',alice,{projectId:'p'},origin)).status).toBe(403);
});
test('preview sessions are downscoped and TTL bounded by the identity',async()=>{
 const short=await token('alice', ['builder'], {exp:Math.floor(Date.now()/1000)+30});
 const r=await preview(short);expect(r.status).toBe(200);const p=await r.json();expect(p.sessionClaims).toMatchObject({roles:['viewer'],aud:'toi-preview',projectId:'p'});expect(p.sessionClaims.exp).toBeLessThanOrEqual(Math.floor(Date.now()/1000)+30);
 expect((await call('/apis',p.sessionToken)).status).toBe(401);expect((await cap(p.sessionToken)).status).toBe(401);
 expect((await preview(alice,{apiIds:['customers'],ttlSec:121})).status).toBe(400);
 expect((await proxy(p.sessionToken,p.capabilityToken)).status).toBe(200);
});
test('viewer reads, editor writes; removing member invalidates already issued sessions on next request',async()=>{
 const read=await (await preview(bob)).json();expect((await proxy(read.sessionToken,read.capabilityToken)).status).toBe(200);
 expect((await preview(bob,{apiIds:['customers'],ttlSec:60})).status).toBe(403);member('p','bob','editor');
 const write=await (await preview(bob,{apiIds:['customers'],ttlSec:60})).json();expect((await proxy(write.sessionToken,write.capabilityToken,'PATCH')).status).toBe(200);
 member('p','bob','viewer');expect((await proxy(write.sessionToken,write.capabilityToken,'PATCH')).status).toBe(403);
 const m=memberships.get('p')!;m.members=m.members.filter(u=>u.sub!=='bob');m.version++;
 expect((await proxy(read.sessionToken,read.capabilityToken)).status).toBe(404);expect((await cap(bob)).status).toBe(404);
});
test('4-eyes live approval, expiry and current API ownership gate both issuing and using capability',async()=>{
 expect((await cap(alice,'live','write')).status).toBe(403);
 const request=await call('/approvals',alice,{projectId:'p',apiId:'customers',scope:'live-write',justification:'test live write approval'});expect(request.status).toBe(201);const a=await request.json();
 expect((await call('/approvals/'+a.approvalId+'/decision',alice,{decision:'approved'})).status).toBe(403);
 expect((await call('/approvals/'+a.approvalId+'/decision',carol,{decision:'approved'})).status).toBe(403);
 expect((await call('/approvals?projectId=p',dana)).status).toBe(200);
 expect((await call('/approvals/'+a.approvalId+'/decision',dana,{decision:'approved'})).status).toBe(200);
 expect((await call('/approvals/'+a.approvalId+'/decision',dana,{decision:'rejected'})).status).toBe(409);
 const issued=await cap(alice,'live','write');expect(issued.status).toBe(200);const live=await issued.json();expect((await proxy(alice,live.token,'PATCH')).status).toBe(200);
 const p=await(await preview(alice)).json();expect((await proxy(p.sessionToken,live.token)).status).toBe(403);
 const restarted=new Access(cfg,store);expect(restarted.approvals.get(a.approvalId)?.status).toBe('approved');
 await new Promise(r=>setTimeout(r,1100));expect((await cap(alice,'live','write')).status).toBe(403);expect((await proxy(alice,live.token,'PATCH')).status).toBe(403);
 expect((await(await call('/approvals?projectId=p',alice)).json())[0].status).toBe('expired');
});
test('preview and live capabilities select only their environment dataset',async()=>{
 const p=await(await preview(alice)).json();const pd=await(await proxy(p.sessionToken,p.capabilityToken)).json();expect(pd.dataset).toBe('preview');expect(JSON.stringify(pd)).not.toContain('live-only');
 const live=await(await cap(alice,'live')).json();const ld=await(await proxy(alice,live.token)).json();expect(ld.dataset).toBe('live');expect(ld.items[0].grade).toBe('live-only');
 expect((await fetch(cfg.upstreamUrl+'/live/customers',{headers:{'X-Service-Token':cfg.upstreamToken}})).status).toBe(401);
});
