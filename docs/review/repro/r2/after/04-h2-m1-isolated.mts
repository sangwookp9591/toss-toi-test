// R2-H2/M1: 수정된 policy-proxy(createPolicyProxy)를 격리 인스턴스로 띄워 경로 정규화·마스킹 우회를 시도한다.
// 실행 중 7200/7300은 건드리지 않는다: 임시 dataDir + 임시 upstream(요청 경로 기록) + 포트 0.
// 실행(루트): node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/r2/after/04-h2-m1-isolated.mts
import { createServer, request, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import path from 'node:path';
import { createPolicyProxy } from '../../../../../services/policy-proxy/src/server.ts';
import { PolicyStorage } from '../../../../../services/policy-proxy/src/storage.ts';
import { signToken } from '../../../../../services/policy-proxy/src/tokens.ts';
import { maskJson } from '../../../../../services/policy-proxy/src/mask.ts';
import type { PolicyConfig } from '../../../../../services/policy-proxy/src/config.ts';

const listen = (server: Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
const seen: string[] = [];
let responder: (url: string) => { type: string; body: string } = url => ({ type: 'application/json', body: JSON.stringify({ path: url }) });
const upstream = createServer((req, res) => { seen.push(req.url ?? ''); const r = responder(req.url ?? ''); res.writeHead(200, { 'Content-Type': r.type }); res.end(r.body); });
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'r2-proxy-'));
const up = await listen(upstream);
const prefixed = `${up}/tenant-a/api`;
const cfg: PolicyConfig = { dataDir, upstreamUrl: up, upstreamAllowlist: [up, prefixed], upstreamToken: 'r2-upstream-token-000000000000000', sessionSecret: 'r2-session', capabilitySecret: 'r2-cap', devAuth: false };
const store = new PolicyStorage(dataDir); await store.init();
const fields = { name: 'name', phone: 'phone', email: 'email', rrn: 'rrn', account: 'account' } as const;
const mask = Object.fromEntries(Object.entries(fields).flatMap(([f, k]) => [[`/${f}`, k], [`/items/*/${f}`, k]]));
const policy = { mask, requireReason: false, allowedRoles: ['viewer'], allowWrite: false };
await store.save({ apiId: 'reports', name: 'r', description: 'd', upstreamBaseUrl: up, schemaVersion: 1, policy,
  openapi: { openapi: '3.1.0', paths: { '/reports/{year}/{month}': { get: {} }, '/customers/{id}': { get: {} }, '/customers/{id}/orders': { get: {} }, '/customers': { get: {} } } } });
await store.save({ apiId: 'tenant', name: 't', description: 'd', upstreamBaseUrl: prefixed, schemaVersion: 1, policy,
  openapi: { openapi: '3.1.0', paths: { '/items/{id}': { get: {} } } } });
const proxy = createPolicyProxy(cfg, store); const base = await listen(proxy);
const now = Math.floor(Date.now() / 1000);
const session = signToken({ sub: 'u', roles: ['viewer'], exp: now + 600 }, cfg.sessionSecret, 'session');
const cap = signToken({ sub: 'u', projectId: 'p', mode: 'read', env: 'preview', ttlSec: 600, exp: now + 600, jti: 'j' }, cfg.capabilitySecret, 'capability');
// node:http request는 경로를 정규화하지 않으므로 공격자가 보낸 원문 그대로 프록시에 도달한다.
const raw = (p: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const u = new URL(base);
  const req = request({ host: u.hostname, port: u.port, path: p, headers: { Authorization: `Bearer ${session}`, 'X-Toi-Project': 'p', 'X-Toi-Capability': cap } }, res => { let b = ''; res.on('data', c => b += c).on('end', () => resolve({ status: res.statusCode ?? 0, body: b })); });
  req.on('error', reject); req.end();
});

console.log('== H2. 경로 우회 시도 (registered: /reports/{year}/{month}, /customers/{id}, /customers/{id}/orders)');
const payloads: [string, string][] = [
  ['baseline 정상', '/proxy/reports/reports/2024/07'],
  ['이중 인코딩 (R1)', '/proxy/reports/reports/%252e%252e/admin'],
  ['삼중 인코딩', '/proxy/reports/reports/%25252e%25252e/admin'],
  ['사중 인코딩(루프 3회 초과)', '/proxy/reports/reports/%2525252e%2525252e/admin'],
  ['혼합 .%2e', '/proxy/reports/reports/.%2e/admin'],
  ['전각 점 ．． (UTF-8 인코딩)', '/proxy/reports/reports/%EF%BC%8E%EF%BC%8E/admin'],
  ['전각 점 이중 인코딩', '/proxy/reports/reports/%25EF%25BC%258E%25EF%25BC%258E/admin'],
  ['오버롱 UTF-8 %c0%ae', '/proxy/reports/reports/%c0%ae%c0%ae/admin'],
  ['오버롱 UTF-8 %e0%80%ae', '/proxy/reports/reports/%e0%80%ae%e0%80%ae/admin'],
  ['IIS %u002e', '/proxy/reports/reports/%u002e%u002e/admin'],
  ['세미콜론 ..;', '/proxy/reports/reports/..;/admin'],
  ['세미콜론 인코딩 ..%3b', '/proxy/reports/reports/..%3b/admin'],
  ['? 삽입 %3f', '/proxy/reports/customers/C001%3f/orders'],
  ['# 삽입 %23', '/proxy/reports/customers/C001%23/orders'],
  ['이중 인코딩 %253f', '/proxy/reports/customers/C001%253f/orders'],
  ['세그먼트 끝 . (admin.)', '/proxy/reports/reports/2024./admin.'],
  ['점 3개 ...', '/proxy/reports/reports/.../admin'],
  ['백슬래시 %5c', '/proxy/reports/reports/%5c..%5c/admin'],
  ['인코딩 슬래시 %2f', '/proxy/reports/customers/..%2fadmin/orders'],
  ['이중 인코딩 슬래시 %252f', '/proxy/reports/customers/..%252f..%252freports/orders'],
  ['템플릿 교차 /customers/{id}에 reports', '/proxy/reports/customers/%252e%252e%252freports'],
  ['NUL %00', '/proxy/reports/customers/C001%00'],
  ['탭 %09', '/proxy/reports/customers/C001%09'],
  ['빈 세그먼트 //', '/proxy/reports/customers//orders'],
  ['한글 경로 파라미터(정상 입력 회귀 확인)', '/proxy/reports/customers/%ED%99%8D%EA%B8%B8%EB%8F%99'],
  ['"{" 문자 파라미터', '/proxy/reports/customers/%7Bx%7D'],
];
for (const [label, p] of payloads) {
  seen.length = 0;
  const r = await raw(p);
  console.log('%s', label.padEnd(34), String(r.status).padEnd(4), (r.status === 200 ? 'upstream=' + JSON.stringify(seen) : r.body.slice(0, 40)));
}

console.log('== H2 회귀. upstreamBaseUrl에 경로 접두사가 있는 등록 API (base=<up>/tenant-a/api, path=/items/{id})');
seen.length = 0;
const t = await raw('/proxy/tenant/items/42');
console.log('proxy /proxy/tenant/items/42 ->', t.status, '| upstream received:', JSON.stringify(seen), '| R1 시점 코드(문자열 결합)라면 /tenant-a/api/items/42');

console.log('== M1. 마스킹 우회 시도 (응답 형태 변형, 등록 규칙은 seed와 동일)');
const variants: [string, unknown][] = [
  ['키 전각 ｐｈｏｎｅ(문자열)', { items: [{ 'ｐｈｏｎｅ': '010-1234-5678' }] }],
  ['키 키릴 р + hone(문자열)', { items: [{ 'рhone': '010-1234-5678' }] }],
  ['키 zero-width phone\\u200b(문자열)', { items: [{ 'phone​': '010-1234-5678' }] }],
  ['미등록 키, 숫자 전화 1012345678', { items: [{ mobile: 1012345678 }] }],
  ['미등록 키, 숫자 주민번호 9001011234567', { items: [{ ssn: 9001011234567 }] }],
  ['미등록 키, 숫자 계좌 110123456789', { items: [{ bankNo: 110123456789 }] }],
  ['등록 키 phone 숫자값', { items: [{ phone: 1012345678 }] }],
  ['구분자 없음 01012345678', { items: [{ tel: '01012345678' }] }],
  ['밑줄 010_1234_5678', { items: [{ tel: '010_1234_5678' }] }],
  ['en dash 010–1234–5678', { items: [{ tel: '010–1234–5678' }] }],
  ['괄호 (010)1234-5678', { items: [{ tel: '(010)1234-5678' }] }],
  ['전각 숫자 ０１０-１２３４-５６７８', { items: [{ tel: '０１０-１２３４-５６７８' }] }],
  ['국가번호 82-10-1234-5678', { items: [{ tel: '82-10-1234-5678' }] }],
  ['+82 10 1234 5678', { items: [{ tel: '+82 10 1234 5678' }] }],
  ['주민번호 공백 900101 1234567', { items: [{ memo: '900101 1234567' }] }],
  ['문장 내 전화 "연락처:010-1234-5678입니다"', { items: [{ memo: '연락처:010-1234-5678입니다' }] }],
  ['숫자 사이 문자 "010x1234x5678"', { items: [{ memo: '010x1234x5678' }] }],
  ['분할 필드 {p1:"010",p2:"1234",p3:"5678"}', { items: [{ p1: '010', p2: '1234', p3: '5678' }] }],
  ['등록 규칙 매칭 + 같은 객체의 숫자 주민번호(경고 없음?)', { items: [{ phone: '010-1234-5678', ssn: 9001011234567 }] }],
  ['PII가 객체 키 {"010-1234-5678":true}', { items: [{ '010-1234-5678': true }] }],
  ['이메일 대문자·태그 A.B+tag@Example.CO.KR', { items: [{ contact: 'A.B+tag@Example.CO.KR' }] }],
];
for (const [label, value] of variants) {
  const r = maskJson(value, mask);
  console.log(label.padEnd(42), JSON.stringify(r.value).slice(0, 70).padEnd(72), 'warn=' + JSON.stringify(r.policyWarnings));
}

console.log('== M1. content-type 위장 (프록시 경유, /customers)');
const ctCases: [string, string, string][] = [
  ['text/plain + PII', 'text/plain', '{"phone":"010-1234-5678"}'],
  ['application/vnd.api+json + PII', 'application/vnd.api+json', '{"items":[{"tel":"010-1234-5678"}]}'],
  ['application/json 선언 + 비JSON 본문', 'application/json', 'tel=010-1234-5678'],
  ['text/html; x=application/json + JSON', 'text/html; x=application/json', '{"items":[{"tel":"010-1234-5678"}]}'],
  ['application/json + JSON 문자열 루트', 'application/json', '"010-1234-5678"'],
];
for (const [label, type, body] of ctCases) { responder = () => ({ type, body }); const r = await raw('/proxy/reports/customers'); console.log(label.padEnd(40), r.status, r.body.slice(0, 60)); }

console.log('== M1. 대용량/깊은 응답 성능 (재귀 스캔 DoS 가능성). 스캔 중 healthz 지연도 측정');
const measure = async (label: string, body: string) => {
  responder = () => ({ type: 'application/json', body });
  // 프록시·upstream·클라이언트가 한 프로세스이므로 이벤트 루프 최대 지연 = 프록시 동기 처리(파싱·마스킹·스캔·sanitize)로 막힌 최대 시간.
  const histogram = monitorEventLoopDelay({ resolution: 10 }); histogram.enable();
  const started = performance.now();
  const r = await raw('/proxy/reports/customers').catch(e => ({ status: -1, body: 'client error: ' + e.message }));
  histogram.disable();
  const parsed = (() => { try { return JSON.parse(body); } catch { return undefined; } })();
  let maskMs = -1; if (parsed !== undefined) { const m0 = performance.now(); try { maskJson(parsed, mask); maskMs = Math.round(performance.now() - m0); } catch (e) { maskMs = -2; } }
  console.log('%s', label.padEnd(40), 'status=' + r.status, 'total=' + Math.round(performance.now() - started) + 'ms', 'maxEventLoopBlock=' + Math.round(histogram.max / 1e6) + 'ms', 'maskJsonAlone=' + maskMs + 'ms', 'bodyMB=' + (body.length / 1e6).toFixed(1), r.status !== 200 ? r.body.slice(0, 40) : '');
};
const row = (i: number) => ({ id: 'C' + i, name: '홍길동', phone: '010-1234-5678', email: 'user' + i + '@example.com', memo: '메모 ' + 'x'.repeat(80) + ' 연락 010-9876-5432' });
await measure('10k rows (~2MB)', JSON.stringify({ items: Array.from({ length: 10000 }, (_, i) => row(i)) }));
await measure('100k rows (~20MB)', JSON.stringify({ items: Array.from({ length: 100000 }, (_, i) => row(i)) }));
await measure('단일 문자열 10MB 숫자-하이픈 반복', JSON.stringify({ memo: '12-'.repeat(3_400_000) }));
await measure('단일 문자열 5MB a@a. 반복(이메일 regex)', JSON.stringify({ memo: 'a@a.'.repeat(1_250_000) }));
let deep = '"x"'; for (let i = 0; i < 20000; i++) deep = '{"a":' + deep + '}';
await measure('깊이 20000 중첩 객체', deep);
let deepArr = '"010-1234-5678"'; for (let i = 0; i < 100000; i++) deepArr = '[' + deepArr + ']';
await measure('깊이 100000 중첩 배열', deepArr);
const audit = await store.audit('p', 3);
console.log('last audit statuses:', JSON.stringify(audit.map(a => ({ status: a.status, denyReason: a.denyReason, warn: a.policyWarnings }))));
proxy.close(); upstream.close(); await rm(dataDir, { recursive: true, force: true });
