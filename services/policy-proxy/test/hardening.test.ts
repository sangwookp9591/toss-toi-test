import { token, member, identityConfig } from './identity-fixture.js';
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
let response: unknown, rawBody: string | undefined, contentType = 'application/json';
let contentLength: number | undefined, chunked = false, upstreamStatus = 200, sendBody = true;
let viewer: string, admin: string, cap: string;
const headers = () => ({ Authorization: `Bearer ${viewer}`, 'X-Toi-Capability': cap, 'X-Toi-Project': 'p' });
const post = (endpoint: string, body: unknown, extra: Record<string,string> = {}) => fetch(base + endpoint, {method:'POST', headers:{'Content-Type':'application/json',...extra}, body:JSON.stringify(body)});
beforeAll(async () => {
 dir = await mkdtemp(path.join(os.tmpdir(), 'policy-hardening-'));
 upstream = createServer((req,res) => { seen.push(req.url!); res.statusCode = upstreamStatus; res.setHeader('Content-Type',contentType); if (contentLength !== undefined) res.setHeader('Content-Length', String(contentLength)); if (!sendBody) return res.end(); const value = rawBody ?? (contentType === 'application/json' ? JSON.stringify(response) : String(response)); if (chunked) { res.write(value.slice(0, 8)); setTimeout(() => res.end(value.slice(8)), 1); } else res.end(value); });
 const up = await listen(upstream);
 cfg = {...configuration({NODE_ENV:'test'}), ...identityConfig, dataDir:dir, upstreamUrl:up, upstreamAllowlist:[up], devAuth:true, devAdminToken:'private-bootstrap-token'};
 store = new PolicyStorage(dir); await store.init();
 await store.save({apiId:'reports',name:'reports',description:'test',environments:{preview:{upstreamBaseUrl:up},live:{upstreamBaseUrl:up}},owners:[],schemaVersion:1,openapi:{openapi:'3.1.0',paths:{'/reports/{year}/{month}':{get:{}},'/customers':{get:{},head:{}}}},policy:{mask:{'/items/*/phone':'phone'},requireReason:false,allowedRoles:['viewer'],allowWrite:false}});
 proxy = createPolicyProxy(cfg,store); base = await listen(proxy);
 const exp = Math.floor(Date.now()/1000)+600;
 viewer = await token('owner'); member('p','owner','viewer');
 admin = await token('admin',['platform-admin']);
 cap = signToken({sub:'owner',projectId:'p',mode:'read',env:'preview',ttlSec:600,exp,jti:'test'},cfg.capabilitySecret,'capability');
});
afterAll(async()=>{await close(proxy);await close(upstream);await rm(dir,{recursive:true,force:true});});

test.each(['/dev/session','/capabilities','/apis','/apis/reports','/audit'])('C1 preview rejects %s on server, including simple requests and preflights', async endpoint => {
 for(const method of ['POST','GET','OPTIONS']) {
  const r = await fetch(base+endpoint,{method,headers:{Origin:'http://localhost:5274','Content-Type':'text/plain',Authorization:`Bearer ${admin}`},...(method==='POST'?{body:JSON.stringify({user:'attacker',roles:['viewer','editor','platform-admin']})}:{})});
  expect(r.status).toBe(403);expect(r.headers.get('access-control-allow-origin')).toBeNull();expect(await r.text()).not.toContain('token');
 }
});
test.each(['/dev/session','/capabilities'])('C1 %s requires application/json before parsing/authentication',async endpoint=>{
 for (const origin of [undefined,'http://localhost:5273']) for(const type of [undefined,'text/plain','application/x-www-form-urlencoded']) {
  const r=await fetch(base+endpoint,{method:'POST',headers:{...(origin?{Origin:origin}:{}),...(type?{'Content-Type':type}:{})},body:'{}'});expect(r.status).toBe(415);
 }
});
test('dev session is removed even with a valid identity',async()=>{expect((await post('/dev/session',{user:'u',roles:['platform-admin']},{Authorization:`Bearer ${admin}`})).status).toBe(404);});
test('C1 audit requires project and filters subject before applying limit',async()=>{
 response={ok:true};await fetch(base+'/proxy/reports/customers',{headers:headers()});
 const record=(await store.audit('p',1))[0];await store.append({...record,user:'other'});
 expect((await fetch(base+'/audit',{headers:headers()})).status).toBe(400);
 const scoped=await fetch(base+'/audit?projectId=p&limit=1',{headers:headers()});expect(scoped.status).toBe(200);expect((await scoped.json()).map((r:any)=>r.user)).toEqual(['owner']);
 expect((await fetch(base+'/audit',{headers:{Authorization:`Bearer ${admin}`}})).status).toBe(200);
});
const production: NodeJS.ProcessEnv={NODE_ENV:'production',TOI_DEV_AUTH_ENABLED:'false',TOI_SESSION_SECRET:'s'.repeat(32),TOI_CAPABILITY_SECRET:'c'.repeat(32),TOI_UPSTREAM_SERVICE_TOKEN:'u'.repeat(32),TOI_PREVIEW_SERVICE_TOKEN:'p'.repeat(32),TOI_LIVE_SERVICE_TOKEN:'l'.repeat(32)};
const badProduction: [string,NodeJS.ProcessEnv][]=[];
for(const key of ['TOI_SESSION_SECRET','TOI_CAPABILITY_SECRET','TOI_PREVIEW_SERVICE_TOKEN','TOI_LIVE_SERVICE_TOKEN']) {
 badProduction.push([`${key} missing`,{...production,[key]:''}],[`${key} short`,{...production,[key]:'x'.repeat(31)}]);
 for(const value of knownDevelopmentSecrets) badProduction.push([`${key} known ${value}`,{...production,[key]:value}]);
}
for(const value of ['true']) badProduction.push([`dev auth ${value}`,{...production,TOI_DEV_AUTH_ENABLED:value}]);
for(const value of ['','present']) badProduction.push([`admin token ${value}`,{...production,TOI_DEV_ADMIN_TOKEN:value}]);
test.each(badProduction)('H1 production rejects %s',(_name,env)=>{expect(()=>configuration(env)).toThrow();});
test('H1 valid production disables dev auth; explicit development generates unpredictable process secrets',()=>{
 expect(configuration(production).devAuth).toBe(false);
 const c=configuration({NODE_ENV:'development'});expect(c.devAuth).toBe(false);
 for(const secret of [c.sessionSecret,c.capabilitySecret,c.upstreamToken]) {expect(Buffer.byteLength(secret)).toBeGreaterThanOrEqual(32);expect(knownDevelopmentSecrets.has(secret)).toBe(false);}
 expect(configuration({NODE_ENV:'development'}).sessionSecret).toBe(c.sessionSecret);
 expect(configuration({NODE_ENV:'development',TOI_SESSION_SECRET:'dev-session-secret-change-me'}).sessionSecret).toBe(c.sessionSecret);
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
 expect((await fetch(base+'/proxy/reports/reports/.../admin',{headers:headers()})).status).toBe(400);
 response={ok:true};expect((await fetch(base+'/proxy/reports/reports/%2532%2530%2532%2536/09?size=1',{headers:headers()})).status).toBe(200);expect(seen.at(-1)).toBe('/reports/2026/09?size=1');
});
test('M1 case-insensitive keys and terminal objects/arrays are recursively masked, drift detected and audited',async()=>{
 response={ITEMS:[{Phone:'010-1234-5678',phone:{number:'010-1234-5678',nested:['010-1234-5678']},contact:{phone:'010-1234-5678'},phones:['010-1234-5678']}],extra:'email test@example.com rrn 900101-1234567 account 110-123-456789'};
 const r=await fetch(base+'/proxy/reports/customers',{headers:headers()});expect(r.status).toBe(200);const text=await r.text();
 expect(text).not.toContain('010-1234-5678');
 expect(JSON.parse(text).extra).toBe((response as any).extra);
 expect(JSON.parse(text).ITEMS[0].phone.nested).toEqual(['010-****-5678']);
 const audit=(await store.audit('p',1))[0];expect(audit.policyWarnings).toEqual(['unregistered_pii_field','possible_unregistered_pii']);
 expect(audit.maskedFields).toEqual(['/ITEMS/0/Phone','/ITEMS/0/contact/phone (detected)','/ITEMS/0/phone/nested/0','/ITEMS/0/phone/number','/ITEMS/0/phones/0 (detected)']);
});
test('M1 unmatched rules warn; whole response and none rules still scan residual PII',async()=>{
 response={message:'01012345678'};await fetch(base+'/proxy/reports/customers',{headers:headers()});
 expect((await store.audit('p',1))[0].policyWarnings).toEqual(['possible_unregistered_pii','mask_rules_unmatched']);
 expect(maskJson({plain:true},{'/phone':'phone'}).policyWarnings).toEqual(['mask_rules_unmatched']);
 expect(maskJson(['test@example.com','9001011234567','110123456789'],{})).toEqual({value:['test@example.com','9001011234567','110123456789'],maskedFields:[],policyWarnings:['possible_unregistered_pii']});
 expect(maskJson({phone:['01012345678']},{'/phone':'phone'}).maskedFields).toEqual(['/phone/0']);
 expect(maskJson({phone:'01012345678'},{'/phone':'none'}).policyWarnings).toEqual(['unregistered_pii_field']);
});
test('M1 non-JSON PII is blocked with audited detection and no raw response',async()=>{
 contentType='text/plain';response='contact 010-1234-5678 test@example.com';
 try {const r=await fetch(base+'/proxy/reports/customers',{headers:headers()});expect(r.status).toBe(502);expect(await r.text()).toBe('{"error":"UPSTREAM_PII_RESPONSE"}');const audit=(await store.audit('p',1))[0];expect(audit.policyWarnings).toEqual(['possible_unregistered_pii']);expect(audit.maskedFields).toEqual([]);expect(audit.decision).toBe('denied');}
 finally {contentType='application/json';}
});
test('A1 caps upstream bodies before and during streaming, and audits denials', async () => {
 const original = cfg.upstreamMaxBytes; cfg.upstreamMaxBytes = 16;
 try {
  response = { ok: true, value: 'small' }; contentLength = Buffer.byteLength(JSON.stringify(response));
  expect((await fetch(base+'/proxy/reports/customers',{headers:headers()})).status).toBe(502);
  expect((await store.audit('p',1))[0].denyReason).toBe('UPSTREAM_TOO_LARGE');
  contentLength = undefined; chunked = true; response = 'x'.repeat(64);
  const before = (await store.audit('p',100)).length;
  const result = await fetch(base+'/proxy/reports/customers',{headers:headers()});
  expect(result.status).toBe(502); expect(await result.json()).toEqual({error:'UPSTREAM_TOO_LARGE'});
  const audit = (await store.audit('p',100)).slice(before).at(-1); expect(audit?.denyReason).toBe('UPSTREAM_TOO_LARGE'); expect(audit?.decision).toBe('denied');
 } finally { cfg.upstreamMaxBytes = original; contentLength = undefined; chunked = false; }
});
test('A1 accepts a response within the configured byte cap', async () => {
 const original = cfg.upstreamMaxBytes; cfg.upstreamMaxBytes = 64;
 try { response = { ok: true }; contentLength = Buffer.byteLength(JSON.stringify(response)); expect((await fetch(base+'/proxy/reports/customers',{headers:headers()})).status).toBe(200); }
 finally { cfg.upstreamMaxBytes = original; contentLength = undefined; }
});
test('M4 preserves upstream rejection without reading its body', async () => {
 upstreamStatus = 404; contentLength = 1_000_000_000; response = 'secret-body'; sendBody = false;
 try {
  const started = Date.now(), result = await fetch(base+'/proxy/reports/customers',{headers:headers()});
  expect(result.status).toBe(404); expect(await result.json()).toEqual({error:'UPSTREAM_REJECTED'}); expect(Date.now() - started).toBeLessThan(1000);
  const audit = (await store.audit('p',1))[0]; expect(audit.denyReason).toBe('UPSTREAM_REJECTED'); expect(JSON.stringify(audit)).not.toContain('secret-body');
 } finally { upstreamStatus = 200; contentLength = undefined; response = undefined; sendBody = true; }
});
test('M5 keeps invalid JSON classified as upstream unavailable', async () => {
 contentType = 'application/json'; rawBody = '{not-json';
 try {
  const result = await fetch(base+'/proxy/reports/customers',{headers:headers()});
  expect(result.status).toBe(502); expect(await result.json()).toEqual({error:'UPSTREAM_UNAVAILABLE'}); expect((await store.audit('p',1))[0].denyReason).toBe('UPSTREAM_UNAVAILABLE');
 } finally { rawBody = undefined; }
});
test('L3 HEAD skips content size checks and body reads', async () => {
 contentLength = 1_000_000_000; response = {ok:true};
 try {
  const result = await fetch(base+'/proxy/reports/customers',{method:'HEAD',headers:headers()});
  expect(result.status).toBe(502); expect((await store.audit('p',1))[0].denyReason).toBe('UPSTREAM_UNAVAILABLE');
 } finally { contentLength = undefined; response = undefined; }
});

const guardedEnvironments = ['Production', 'prod', 'staging', 'production ', '', undefined];
test.each(guardedEnvironments)('N5 NODE_ENV=%s applies production guards', NODE_ENV => {
 expect(() => configuration({NODE_ENV})).toThrow();
 expect(() => configuration({...production,NODE_ENV,TOI_DEV_AUTH_ENABLED:'true'})).toThrow();
 expect(() => configuration({...production,NODE_ENV,TOI_DEV_ADMIN_TOKEN:'leftover'})).toThrow();
 expect(configuration({...production,NODE_ENV}).devAuth).toBe(false);
});
test.each(['development','test'])('N5 %s development auth requires exact opt-in', NODE_ENV => {
 for(const TOI_DEV_AUTH_ENABLED of [undefined,'false','TRUE','true ','']) expect(configuration({NODE_ENV,TOI_DEV_AUTH_ENABLED}).devAuth).toBe(false);
 expect(configuration({NODE_ENV,TOI_DEV_AUTH_ENABLED:'true'}).devAuth).toBe(false);
});
test('A1 rejects invalid upstream response caps and defaults to 5 MiB', () => {
 expect(configuration({NODE_ENV:'test'}).upstreamMaxBytes).toBe(5 * 1024 * 1024);
 for (const value of ['', '0', '-1', '1.5', 'abc', '9007199254740992']) expect(() => configuration({NODE_ENV:'test', POLICY_MAX_UPSTREAM_BYTES:value})).toThrow('Invalid POLICY_MAX_UPSTREAM_BYTES');
 expect(configuration({NODE_ENV:'test', POLICY_MAX_UPSTREAM_BYTES:'1024'}).upstreamMaxBytes).toBe(1024);
});
test.each([
 {TOI_CAPABILITY_SECRET:production.TOI_SESSION_SECRET},
 {TOI_PREVIEW_SERVICE_TOKEN:production.TOI_SESSION_SECRET},
 {TOI_PREVIEW_SERVICE_TOKEN:production.TOI_CAPABILITY_SECRET},
 {TOI_CAPABILITY_SECRET:production.TOI_SESSION_SECRET,TOI_PREVIEW_SERVICE_TOKEN:production.TOI_SESSION_SECRET},
])('N5 production requires independent secrets: %j', overrides => {
 expect(() => configuration({...production,...overrides})).toThrow('distinct secrets');
});
const negativePii = [
 ['date','2026-08-01'], ['minute','2026-08-01T00:00'], ['createdAt','2026-08-01T00:00:00.000Z'],
 ['offset','2026-08-01T00:00:00.000+09:00'], ['uuid','01012345-6789-1234-8123-110123456789'],
 ['epoch','1785542400000'], ['amount','110123456789.25'], ['amount','1,101,234,567.89'],
 ['orderId','110123456789'], ['invoiceId','01012345678'], ['trackingNo','110-123-456789'],
] as const;
test.each(negativePii)('N2 preserves non-PII %s=%s', (key,value) => {
 const input = {[key]:value};
 const masked=maskJson(input,{});
 expect(masked.value).toEqual(input);expect(masked.maskedFields).toEqual([]);
 if (['orderId','invoiceId','trackingNo'].includes(key)) expect(masked.policyWarnings).toEqual(['possible_unregistered_pii']);
 else expect(masked.policyWarnings).toEqual([]);
});
test.each(negativePii.slice(0,8))('N2 token exclusions also protect hinted fields: %s', (_key,value) => {
 expect(maskJson({acct:value},{})).toEqual({value:{acct:value},maskedFields:[],policyWarnings:[]});
});
test.each(['Phone','TEL','mobile_number','rrn','SSN','residentId','ACCOUNT','acct','emailAddress'])('N2 residual replacement requires key hint %s', key => {
 const value='010-1234-5678';
 expect(maskJson({[key]:value},{})).toEqual({value:{[key]:'010-****-5678'},maskedFields:[`/${key} (detected)`],policyWarnings:['unregistered_pii_field']});
});
test('N2 unhinted pattern-only response is preserved and only a possible warning is audited',async()=>{
 response={memo:'email test@example.com rrn 900101-1234567 account 110-123-456789'};
 const api=store.apis.get('reports')!;const originalMask=api.policy.mask;api.policy.mask={};
 try {
  const r=await fetch(base+'/proxy/reports/customers',{headers:headers()});expect(r.status).toBe(200);expect(await r.json()).toEqual(response);
  const audit=(await store.audit('p',1))[0];expect(audit.maskedFields).toEqual([]);expect(audit.policyWarnings).toEqual(['possible_unregistered_pii']);
 }finally{api.policy.mask=originalMask;}
});
test.each(['..;/admin','..%3b/admin','2024./admin.','.../admin','2024/a.b','2024/a:b','2024/a@b','2024/a+b','%EF%BC%8E%EF%BC%8E/admin'])('N4 path characters %s are 400 without upstream access',async suffix=>{
 const before=seen.length;
 const status=await new Promise<number>((resolve,reject)=>{const req=request(base,{path:'/proxy/reports/reports/'+suffix,headers:headers()},r=>{r.resume();r.on('end',()=>resolve(r.statusCode!));});req.on('error',reject);req.end();});
 expect(status).toBe(400);expect(seen).toHaveLength(before);
});
test.each(['','/'])('N3 and L3 registered base prefix survives with trailing slash %j and Unicode id',async trailing=>{
 const prefixed=cfg.upstreamUrl+'/tenant-a/api'+trailing;cfg.upstreamAllowlist.push(prefixed);
 const registration={...store.apis.get('reports')!,apiId:'tenant',environments:{preview:{upstreamBaseUrl:prefixed},live:{upstreamBaseUrl:prefixed}},openapi:{openapi:'3.1.0',paths:{'/items/{id}':{get:{}}}}};
 expect((await post('/apis',registration,{Authorization:`Bearer ${admin}`})).status).toBe(201);
 response={ok:true};
 for (const id of ['42','홍길동','abc_123-xyz']) {
  const r=await fetch(base+'/proxy/tenant/items/'+encodeURIComponent(id)+'?page=1',{headers:headers()});
  expect(r.status).toBe(200);expect(seen.at(-1)).toBe('/tenant-a/api/items/'+encodeURIComponent(id)+'?page=1');
 }
});
test('N2 exclusions preserve tokens beside PII but do not override registered rules or email addresses',()=>{
 const value='2026-08-01T00:00:00.000Z 1785542400000 123.45 010-1234-5678';
 expect(maskJson({phone:value},{}).value).toEqual({phone:'2026-08-01T00:00:00.000Z 1785542400000 123.45 010-****-5678'});
 expect(maskJson({ssn:'9001011234567'},{'/ssn':'rrn'}).value).toEqual({ssn:'900101-*******'});
 for (const email of ['123.45@example.com','123.45.67@example.com','123.45+tag@example.com']) expect(maskJson({email},{}).value).toEqual({email:'12***@example.com'});
});
