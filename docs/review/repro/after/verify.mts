// After-fix assertions complement unchanged original scripts, which stop at the first rejection.
// Run from repository root: node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/after/verify.mts
import assert from 'node:assert/strict';
import {configuration,knownDevelopmentSecrets} from '../../../../services/policy-proxy/src/config.ts';
import {signToken} from '../../../../services/policy-proxy/src/tokens.ts';
const base='http://localhost:7200';
const report=(name:string,result:unknown)=>console.log(name,JSON.stringify(result));
for(const endpoint of ['/dev/session','/capabilities','/apis','/apis/customers','/audit']) {
 const r=await fetch(base+endpoint,{method:endpoint==='/audit'||endpoint.startsWith('/apis')?'GET':'POST',headers:{Origin:'http://localhost:5174','Content-Type':'text/plain'},...(endpoint==='/audit'||endpoint.startsWith('/apis')?{}:{body:JSON.stringify({user:'review-after',roles:['viewer','editor','platform-admin'],projectId:'review-after',mode:'write'})})});
 const body=await r.json();assert.equal(r.status,403);assert.equal(body.token,undefined);assert.equal(r.headers.get('access-control-allow-origin'),null);report('C1 preview '+endpoint,{status:r.status,tokenObtained:false,corsAllowed:false});
}
for(const endpoint of ['/dev/session','/capabilities']) {
 const r=await fetch(base+endpoint,{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'text/plain'},body:'{}'});assert.equal(r.status,415);report('C1 text/plain '+endpoint,{status:r.status});
}
const admin=await fetch(base+'/dev/session',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({user:'review-after',roles:['platform-admin']})});assert.equal(admin.status,403);report('C1 browser admin',{status:admin.status});
const session=await fetch(base+'/dev/session',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({user:'review-after',roles:['viewer','editor']})});assert.equal(session.status,200);const {token}=await session.json();
const audit=await fetch(base+'/audit',{headers:{Authorization:`Bearer ${token}`}});assert.equal(audit.status,400);report('C1 viewer/editor audit without project',{status:audit.status});
const production={NODE_ENV:'production',TOI_DEV_AUTH_ENABLED:'false',TOI_SESSION_SECRET:'s'.repeat(32),TOI_CAPABILITY_SECRET:'c'.repeat(32),TOI_UPSTREAM_SERVICE_TOKEN:'u'.repeat(32)};
const cases=[...['TOI_SESSION_SECRET','TOI_CAPABILITY_SECRET','TOI_UPSTREAM_SERVICE_TOKEN'].flatMap(key=>[['missing '+key,{...production,[key]:''}],['short '+key,{...production,[key]:'x'.repeat(31)}],...Array.from(knownDevelopmentSecrets,secret=>['known default '+key+' '+secret,{...production,[key]:secret}])]),['dev auth missing',{...production,TOI_DEV_AUTH_ENABLED:undefined}],['dev auth true',{...production,TOI_DEV_AUTH_ENABLED:'true'}],['admin token set',{...production,TOI_DEV_ADMIN_TOKEN:'set'}],['admin token empty',{...production,TOI_DEV_ADMIN_TOKEN:''}]] as [string,NodeJS.ProcessEnv][];
for(const [name,env]of cases){assert.throws(()=>configuration(env));report('H1 production '+name,{startupRejected:true});}
assert.equal(configuration(production).devAuth,false);report('H1 valid production',{accepted:true,devAuth:false});
const development=configuration({});assert.equal(development.devAuth,true);for(const value of [development.sessionSecret,development.capabilitySecret,development.upstreamToken])assert(!knownDevelopmentSecrets.has(value));report('H1 absent NODE_ENV',{mode:'development',usesKnownSecrets:false});
for(const secret of knownDevelopmentSecrets){const forged=signToken({sub:'forged-admin',roles:['platform-admin'],exp:Math.floor(Date.now()/1000)+60},secret,'session');const r=await fetch(base+'/audit',{headers:{Authorization:`Bearer ${forged}`}});assert.equal(r.status,401);report('H1 live :7200 forged '+secret,{status:r.status});}
console.log('PASS: C1 and H1 after-fix assertions');
