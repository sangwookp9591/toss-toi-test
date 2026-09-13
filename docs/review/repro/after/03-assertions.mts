import assert from 'node:assert/strict';
// R1-M: 정책 프록시 경로 이중 디코딩과 마스킹 누락을 격리 환경에서 재현한다.
// 실행 중인 7200/7300은 건드리지 않는다: 임시 dataDir + 임시 echo upstream + 새 프록시 인스턴스(포트 0).
// 실행(루트): node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/after/03-assertions.mts
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPolicyProxy } from '../../../../services/policy-proxy/src/server.ts';
import { PolicyStorage } from '../../../../services/policy-proxy/src/storage.ts';
import { signToken } from '../../../../services/policy-proxy/src/tokens.ts';
import type { PolicyConfig } from '../../../../services/policy-proxy/src/config.ts';

const listen = (server: Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
const seen: string[] = [];
const upstream = createServer((req, res) => {
  seen.push(req.url ?? '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 대소문자·중첩·배열·객체값 변형. 등록 정책은 seed와 같은 "/items/*/phone" 류 규칙만 가진다.
  res.end(JSON.stringify({ items: [{ id: 'C001', Phone: '010-1234-5678', contact: { phone: '010-1234-5678' }, phones: ['010-1234-5678'], phone: { number: '010-1234-5678' }, rrn: '900101-1234567', account: '5678' }], internalPath: req.url }));
});
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'review-proxy-'));
const up = await listen(upstream);
const cfg: PolicyConfig = { dataDir, upstreamUrl: up, upstreamAllowlist: [up], upstreamToken: 'review-upstream', sessionSecret: 'review-session', capabilitySecret: 'review-cap', devAuth: false };
const store = new PolicyStorage(dataDir); await store.init();
const fields = { name: 'name', phone: 'phone', email: 'email', rrn: 'rrn', account: 'account' } as const;
const mask = Object.fromEntries(Object.entries(fields).flatMap(([f, k]) => [[`/${f}`, k], [`/items/*/${f}`, k]]));
await store.save({ apiId: 'reports', name: 'r', description: 'd', upstreamBaseUrl: up, schemaVersion: 1,
  openapi: { openapi: '3.1.0', paths: { '/reports/{year}/{month}': { get: {} }, '/customers': { get: {} } } },
  policy: { mask, requireReason: false, allowedRoles: ['viewer'], allowWrite: false } });
const proxy = createPolicyProxy(cfg, store); const base = await listen(proxy);
const now = Math.floor(Date.now() / 1000);
const session = signToken({ sub: 'u', roles: ['viewer'], exp: now + 600 }, cfg.sessionSecret, 'session');
const cap = signToken({ sub: 'u', projectId: 'p', mode: 'read', env: 'preview', ttlSec: 600, exp: now + 600, jti: 'j' }, cfg.capabilitySecret, 'capability');
const get = async (p: string) => { const r = await fetch(base + '/proxy/reports' + p, { headers: { Authorization: `Bearer ${session}`, 'X-Toi-Project': 'p', 'X-Toi-Capability': cap } }); return { status: r.status, body: await r.text() }; };

console.log('== 1. 등록된 연산은 GET /reports/{year}/{month} 뿐. 등록되지 않은 /admin 요청');
console.log('direct  /admin                         ->', (await get('/admin')).status);
seen.length = 0;
const bypass = await get('/reports/%252e%252e/admin');
console.log('encoded /reports/%252e%252e/admin      ->', bypass.status, '| upstream received:', JSON.stringify(seen));
assert.equal(bypass.status,400);assert.deepEqual(seen,[]);
const triple = await get('/reports/%25252e%25252e/admin');
assert.equal(triple.status,400);assert.deepEqual(seen,[]);
console.log('triple /reports/%25252e%25252e/admin ->',triple.status,'| upstream received:',JSON.stringify(seen));
console.log('single  /reports/%2e%2e/admin          ->', (await get('/reports/%2e%2e/admin')).status, '(한 번 인코딩은 fetch 클라이언트가 먼저 정규화해 /admin → 미등록 404)');

console.log('== 2. 마스킹 규칙 /items/*/phone 등에 대해 필드 변형이 원문 그대로 통과하는지');
const masked = JSON.parse((await get('/customers')).body);
console.log(JSON.stringify(masked.items[0]));
assert(!JSON.stringify(masked).includes('010-1234-5678'));
assert.equal(masked.items[0].Phone,'010-****-5678');
assert.equal(masked.items[0].phone.number,'010-****-5678');
const audit = await store.audit('p', 1);
console.log('audit maskedFields:', JSON.stringify(audit[0].maskedFields));
console.log('audit policyWarnings:',JSON.stringify(audit[0].policyWarnings));
assert.deepEqual(audit[0].policyWarnings,['unregistered_pii_field']);
assert(audit[0].maskedFields.includes('/items/0/contact/phone (detected)'));
assert(audit[0].maskedFields.includes('/items/0/phones/0 (detected)'));
console.log('PASS: H2 and M1 after-fix assertions');
proxy.close(); upstream.close(); await rm(dataDir, { recursive: true, force: true });
