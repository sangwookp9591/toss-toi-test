import { beforeAll, afterAll, test, expect } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configuration, knownDevelopmentSecrets, serviceRoot, type PolicyConfig } from '../src/config.js';
import { createPolicyProxy } from '../src/server.js';
import { PolicyStorage } from '../src/storage.js';
import { signToken } from '../src/tokens.js';
import { maskJson } from '../src/mask.js';
const listen = (s: Server) => new Promise<string>(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as {port:number}).port}`)));
const close = (s: Server) => new Promise<void>(r => { s.closeAllConnections(); s.close(() => r()); });
let proxy: Server, upstream: Server, base: string, store: PolicyStorage, cfg: PolicyConfig, dir: string;
const seen: string[] = [];
let response: unknown, contentType = 'application/json';
let viewer: string, admin: string, cap: string;
const headers = () => ({ Authorization: `Bearer ${viewer}`, 'X-Toi-Capability': cap, 'X-Toi-Project': 'p' });
const post = (endpoint: string, body: unknown, extra: Record<string,string> = {}) => fetch(base + endpoint, {method:'POST', headers:{'Content-Type':'application/json',...extra}, body:JSON.stringify(body)});
beforeAll(async () => {
 dir = await mkdtemp(path.join(os.tmpdir(), 'policy-hardening-'));
 upstream = createServer((req,res) => { seen.push(req.url!); res.setHeader('Content-Type',contentType); res.end(contentType === 'application/json' ? JSON.stringify(response) : String(response)); });
 const up = await listen(upstream);
 cfg = {...configuration({}), dataDir:dir, upstreamUrl:up, upstreamAllowlist:[up], devAuth:true, devAdminToken:'private-bootstrap-token'};
 store = new PolicyStorage(dir); await store.init();
 await store.save({apiId:'reports',name:'reports',description:'test',upstreamBaseUrl:up,schemaVersion:1,openapi:{openapi:'3.1.0',paths:{'/reports/{year}/{month}':{get:{}},'/customers':{get:{}}}},policy:{mask:{'/items/*/phone':'phone'},requireReason:false,allowedRoles:['viewer'],allowWrite:false}});
 proxy = createPolicyProxy(cfg,store); base = await listen(proxy);
 const exp = Math.floor(Date.now()/1000)+600;
 viewer = signToken({sub:'owner',roles:['viewer'],exp},cfg.sessionSecret,'session');
 admin = signToken({sub:'admin',roles:['platform-admin'],exp},cfg.sessionSecret,'session');
 cap = signToken({sub:'owner',projectId:'p',mode:'read',env:'preview',ttlSec:600,exp,jti:'test'},cfg.capabilitySecret,'capability');
});
afterAll(async()=>{await close(proxy);await close(upstream);await rm(dir,{recursive:true,force:true});});

test.each(['/dev/session','/capabilities','/apis','/apis/reports','/audit'])('C1 preview rejects %s on server, including simple requests and preflights', async endpoint => {
 for(const method of ['POST','GET','OPTIONS']) {
  const r = await fetch(base+endpoint,{method,headers:{Origin:'http://localhost:5174','Content-Type':'text/plain',Authorization:`Bearer ${admin}`},...(method==='POST'?{body:JSON.stringify({user:'attacker',roles:['viewer','editor','platform-admin']})}:{})});
  expect(r.status).toBe(403);expect(r.headers.get('access-control-allow-origin')).toBeNull();expect(await r.text()).not.toContain('token');
 }
});
test.each(['/dev/session','/capabilities'])('C1 %s requires application/json before parsing/authentication',async endpoint=>{
 for (const origin of [undefined,'http://localhost:5173']) for(const type of [undefined,'text/plain','application/x-www-form-urlencoded']) {
  const r=await fetch(base+endpoint,{method:'POST',headers:{...(origin?{Origin:origin}:{}),...(type?{'Content-Type':type}:{})},body:'{}'});expect(r.status).toBe(415);
 }
});
test('C1 browser admin issuance denied even with bootstrap token; server admin requires correct token',async()=>{
 for(const authorization of [undefined,'Bearer wrong',`Bearer ${cfg.devAdminToken}`]) {
  const r=await post('/dev/session',{user:'u',roles:['platform-admin']},{Origin:'http://localhost:5173',...(authorization?{Authorization:authorization}:{})});expect(r.status).toBe(403);
 }
 for(const authorization of [undefined,'Bearer wrong']) expect((await post('/dev/session',{user:'u',roles:['platform-admin']},authorization?{Authorization:authorization}:{})).status).toBe(403);
 expect((await post('/dev/session',{user:'u',roles:['platform-admin']},{Authorization:`Bearer ${cfg.devAdminToken}`})).status).toBe(200);
 for(const origin of [undefined,'http://localhost:5173']) {
  const r=await post('/dev/session',{user:'u',roles:['viewer','editor']},origin?{Origin:origin}:{});expect(r.status).toBe(200);
  const {token}=await r.json(); expect((await post('/capabilities',{projectId:'p',mode:'write',env:'preview',apiIds:['reports'],ttlSec:60},{Authorization:`Bearer ${token}`,...(origin?{Origin:origin}:{})})).status).toBe(200);
 }
 expect((await post('/dev/session',{user:'u',roles:['viewer']},{Origin:'null'})).status).toBe(403);
});
test('C1 audit requires project and filters subject before applying limit',async()=>{
 response={ok:true};await fetch(base+'/proxy/reports/customers',{headers:headers()});
 const record=(await store.audit('p',1))[0];await store.append({...record,user:'other'});
 expect((await fetch(base+'/audit',{headers:headers()})).status).toBe(400);
 const scoped=await fetch(base+'/audit?projectId=p&limit=1',{headers:headers()});expect(scoped.status).toBe(200);expect((await scoped.json()).map((r:any)=>r.user)).toEqual(['owner']);
 expect((await fetch(base+'/audit',{headers:{Authorization:`Bearer ${admin}`}})).status).toBe(200);
});
const production: NodeJS.ProcessEnv={NODE_ENV:'production',TOI_DEV_AUTH_ENABLED:'false',TOI_SESSION_SECRET:'s'.repeat(32),TOI_CAPABILITY_SECRET:'c'.repeat(32),TOI_UPSTREAM_SERVICE_TOKEN:'u'.repeat(32)};
const badProduction: [string,NodeJS.ProcessEnv][]=[];
for(const key of ['TOI_SESSION_SECRET','TOI_CAPABILITY_SECRET','TOI_UPSTREAM_SERVICE_TOKEN']) {
 badProduction.push([`${key} missing`,{...production,[key]:''}],[`${key} short`,{...production,[key]:'x'.repeat(31)}]);
 for(const value of knownDevelopmentSecrets) badProduction.push([`${key} known ${value}`,{...production,[key]:value}]);
}
for(const value of [undefined,'true','FALSE']) badProduction.push([`dev auth ${value}`,{...production,TOI_DEV_AUTH_ENABLED:value}]);
for(const value of ['','present']) badProduction.push([`admin token ${value}`,{...production,TOI_DEV_ADMIN_TOKEN:value}]);
test.each(badProduction)('H1 production rejects %s',(_name,env)=>{expect(()=>configuration(env)).toThrow();});
test('H1 valid production disables dev auth; absent NODE_ENV generates unpredictable process secrets',()=>{
 expect(configuration(production).devAuth).toBe(false);
 const c=configuration({});expect(c.devAuth).toBe(true);
 for(const secret of [c.sessionSecret,c.capabilitySecret,c.upstreamToken]) {expect(Buffer.byteLength(secret)).toBeGreaterThanOrEqual(32);expect(knownDevelopmentSecrets.has(secret)).toBe(false);}
 expect(configuration({}).sessionSecret).toBe(c.sessionSecret);
 expect(configuration({TOI_SESSION_SECRET:'dev-session-secret-change-me'}).sessionSecret).toBe(c.sessionSecret);
});
test('H1 actual main process exits before listen with unsafe production configuration',()=>{
 for(const env of [ {...production,TOI_SESSION_SECRET:'toi-dev-session-secret-change-before-production'}, {...production,TOI_DEV_AUTH_ENABLED:'true'}, {...production,TOI_DEV_ADMIN_TOKEN:'bad'}]) {
  const child=spawnSync(process.execPath,['--import','tsx','src/main.ts'],{cwd:serviceRoot,env:{...process.env,...env},timeout:5000,encoding:'utf8'});
  expect(child.status).toBe(1);expect(child.stderr).toContain('Policy startup failed');expect(child.stdout).not.toContain('listening');
 }
});
test.each([...knownDevelopmentSecrets])('H1 repository secret cannot forge a running development session: %s',async secret=>{
 const token=signToken({sub:'forged',roles:['platform-admin'],exp:Math.floor(Date.now()/1000)+60},secret,'session');
 expect((await fetch(base+'/audit',{headers:{Authorization:`Bearer ${token}`}})).status).toBe(401);
});
const invalidPaths=['/reports/%252e%252e/admin','/reports/%25252e%25252e/admin','/reports/%2e%2e/admin','/reports/../admin','/reports/%2525252e/admin','/reports/%252f/admin','/reports/%2F/admin','/reports/%255c/admin','/reports/%/admin','/reports/%2525/admin','/reports/%00/admin','/reports/%3f/admin'];
test.each(invalidPaths)('H2 raw HTTP path %s is 400 without contacting upstream',async pathname=>{
 const before=seen.length;
 const status=await new Promise<number>((resolve,reject)=>{const req=request(base,{path:'/proxy/reports'+pathname,headers:headers()},r=>{r.resume();r.on('end',()=>resolve(r.statusCode!));});req.on('error',reject);req.end();});
 expect(status).toBe(400);expect(seen).toHaveLength(before);
});
test('H2 template variables cannot contain only dots; safe path matches exact upstream pathname',async()=>{
 expect((await fetch(base+'/proxy/reports/reports/.../admin',{headers:headers()})).status).toBe(404);
 response={ok:true};expect((await fetch(base+'/proxy/reports/reports/%2532%2530%2532%2536/09?size=1',{headers:headers()})).status).toBe(200);expect(seen.at(-1)).toBe('/reports/2026/09?size=1');
});
test('M1 case-insensitive keys and terminal objects/arrays are recursively masked, drift detected and audited',async()=>{
 response={ITEMS:[{Phone:'010-1234-5678',phone:{number:'010-1234-5678',nested:['010-1234-5678']},contact:{phone:'010-1234-5678'},phones:['010-1234-5678']}],extra:'email test@example.com rrn 900101-1234567 account 110-123-456789'};
 const r=await fetch(base+'/proxy/reports/customers',{headers:headers()});expect(r.status).toBe(200);const text=await r.text();
 for(const pii of ['010-1234-5678','test@example.com','900101-1234567','110-123-456789']) expect(text).not.toContain(pii);
 expect(JSON.parse(text).ITEMS[0].phone.nested).toEqual(['010-****-5678']);
 const audit=(await store.audit('p',1))[0];expect(audit.policyWarnings).toEqual(['unregistered_pii_field']);
 expect(audit.maskedFields).toEqual(['/ITEMS/0/Phone','/ITEMS/0/contact/phone (detected)','/ITEMS/0/phone/nested/0','/ITEMS/0/phone/number','/ITEMS/0/phones/0 (detected)','/extra (detected)']);
});
test('M1 unmatched rules warn; whole response and none rules still scan residual PII',async()=>{
 response={message:'01012345678'};await fetch(base+'/proxy/reports/customers',{headers:headers()});
 expect((await store.audit('p',1))[0].policyWarnings).toEqual(['unregistered_pii_field','mask_rules_unmatched']);
 expect(maskJson({plain:true},{'/phone':'phone'}).policyWarnings).toEqual(['mask_rules_unmatched']);
 expect(maskJson(['test@example.com','9001011234567','110123456789'],{}).maskedFields).toHaveLength(3);
 expect(maskJson({phone:['01012345678']},{'/phone':'phone'}).maskedFields).toEqual(['/phone/0']);
 expect(maskJson({phone:'01012345678'},{'/phone':'none'}).policyWarnings).toEqual(['unregistered_pii_field']);
});
test('M1 non-JSON PII is blocked with audited detection and no raw response',async()=>{
 contentType='text/plain';response='contact 010-1234-5678 test@example.com';
 try {const r=await fetch(base+'/proxy/reports/customers',{headers:headers()});expect(r.status).toBe(502);expect(await r.text()).toBe('{"error":"UPSTREAM_PII_RESPONSE"}');const audit=(await store.audit('p',1))[0];expect(audit.policyWarnings).toEqual(['unregistered_pii_field']);expect(audit.maskedFields).toEqual(['/ (detected)']);expect(audit.decision).toBe('denied');}
 finally {contentType='application/json';}
});
