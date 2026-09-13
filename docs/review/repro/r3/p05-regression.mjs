// Regression re-check of R1/R2 findings via the live policy-proxy: H2 (encoding/traversal),
// N2 (ISO-date false-positive masking), N3 (upstream base path prefix), N4 (semicolon/trailing dot),
// M1 (masking variants), L3 (non-ASCII path param).
import { login, req, POLICY, AGENT, STUDIO } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const out = []; const log = s => { out.push(s); console.log(s); };
const alice = await login('alice');
const A = { token: alice.access_token, origin: STUDIO };
const P = (await req(AGENT + '/projects', { method:'POST', ...A, body:{name:'r3-regress', apiIds:['customers']}})).body.projectId;
const pv = (await req(`${POLICY}/preview-sessions`, { method:'POST', ...A, body:{projectId:P}})).body;
const origin = `http://p-${P}.preview.localhost:5174`;
const base = { token: pv.sessionToken, capability: pv.capabilityToken, project: P, reason: 'r3 regression', origin };
const proxy = (path) => req(`${POLICY}/proxy/customers${path}`, base);

log('# H2/N4 path traversal & injection variants (expect 400/404, never upstream traversal):');
for (const p of ['/customers/%252e%252e/admin','/customers/%2e%2e/x','/reports/..;/admin','/reports/..%3b/admin','/customers/2024./admin.','/customers/%2f/x','/customers/..%2f..%2fadmin','/customers/x%00y','/customers/x%5cy','/customers/%c0%ae%c0%ae/admin']) {
  const r = await proxy(p);
  log(`  ${p.padEnd(34)} -> ${r.status} ${typeof r.body==='object'?JSON.stringify(r.body).slice(0,45):''}`);
}

log('\n# N3 upstream base-path prefix preserved (customers env=preview => upstream /preview/...):');
{ const r = await proxy('/customers'); log(`  GET /customers -> ${r.status} dataset=${r.body?.dataset} (preview means the /preview prefix survived)`); }

log('\n# N2 ISO-date must NOT be masked as account (orders.createdAt):');
{ const r = await proxy('/customers/C001/orders');
  const s = JSON.stringify(r.body);
  const createdAt = r.body?.items?.[0]?.createdAt;
  log(`  GET /customers/C001/orders -> ${r.status} firstCreatedAt=${JSON.stringify(createdAt)} maskedStar=${String(createdAt).includes('*')}`);
  log(`  body sample: ${s.slice(0,140)}`); }

log('\n# M1 masking on registered fields (name/phone/email/rrn/account):');
{ const r = await proxy('/customers'); log(`  first item: ${JSON.stringify(r.body?.items?.[0]).slice(0,160)}`); }

log('\n# L3 non-ASCII path parameter accepted (not 400 INVALID_PATH):');
{ const r = await proxy('/customers/' + encodeURIComponent('홍길동')); log(`  GET /customers/홍길동 -> ${r.status} ${JSON.stringify(r.body).slice(0,50)}`); }

writeFileSync(new URL('./p05-regression.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p05-regression.out');
