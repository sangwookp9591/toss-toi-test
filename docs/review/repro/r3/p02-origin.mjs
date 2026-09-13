// P0-2: PREVIEW_ORIGIN_MISMATCH robustness (policy-proxy Origin parsing) and 5174 Host check.
import { request as httpRequest } from 'node:http';
import { login, req, POLICY, AGENT, STUDIO } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const out = []; const log = s => { out.push(s); console.log(s); };

const alice = await login('alice');
const A = { token: alice.access_token, origin: STUDIO };
const P = (await req(AGENT + '/projects', { method:'POST', ...A, body:{name:'r3-origin', apiIds:['customers']}})).body.projectId;
const preview = (await req(`${POLICY}/preview-sessions`, { method:'POST', ...A, body:{projectId:P}})).body;
const base = { token: preview.sessionToken, capability: preview.capabilityToken, project: P, reason: 'r3 origin probe' };
const exact = `http://p-${P}.preview.localhost:5174`;

log('# /proxy Origin header variants (control=exact preview origin should 200; others 403):');
const originVariants = [
  ['exact preview origin', exact],
  ['UPPERCASE scheme', `HTTP://p-${P}.preview.localhost:5174`],
  ['uppercase host label', `http://P-${P.toUpperCase()}.preview.localhost:5174`],
  ['port omitted', `http://p-${P}.preview.localhost`],
  ['wrong port', `http://p-${P}.preview.localhost:5173`],
  ['trailing dot in host', `http://p-${P}.preview.localhost.:5174`],
  ['suffix hijack', `http://p-${P}.preview.localhost.evil.test:5174`],
  ['different project uuid', `http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5174`],
  ['studio origin', STUDIO],
  ['null literal', 'null'],
  ['extra subdomain', `http://x.p-${P}.preview.localhost:5174`],
];
for (const [label, origin] of originVariants) {
  const r = await req(`${POLICY}/proxy/customers/customers`, { ...base, origin });
  log(`  ${label.padEnd(26)} -> ${r.status} ${typeof r.body==='object'?JSON.stringify(r.body).slice(0,40):''}`);
}

log('\n# X-Toi-Project vs preview-session/capability mismatch:');
{
  const r = await req(`${POLICY}/proxy/customers/customers`, { ...base, origin: exact, project: '00000000-0000-4000-8000-000000000000' });
  log(`  header project != session/cap project -> ${r.status} ${JSON.stringify(r.body).slice(0,40)}`);
}

// 5174 Host header variants (raw HTTP to 127.0.0.1:5174)
const U = P;
function hostProbe(host) {
  return new Promise(resolve => {
    const rq = httpRequest({ host:'127.0.0.1', port:5174, path:'/frame.html', method:'GET', headers:{ Host: host }, timeout:2000 }, res => { res.resume(); resolve(res.statusCode); });
    rq.on('timeout', ()=>{ rq.destroy(); resolve('timeout'); }); rq.on('error', ()=>resolve('error')); rq.end();
  });
}
log('\n# 5174 Host header variants (only exact lowercase p-<uuid>.preview.localhost:5174 -> 200):');
const hostVariants = [
  ['exact', `p-${U}.preview.localhost:5174`],
  ['uppercase', `P-${U.toUpperCase()}.preview.localhost:5174`],
  ['trailing dot', `p-${U}.preview.localhost.:5174`],
  ['suffix hijack (rebinding)', `p-${U}.preview.localhost.evil.test:5174`],
  ['missing port', `p-${U}.preview.localhost`],
  ['IPv6 loopback', `[::1]:5174`],
  ['plain localhost', `localhost:5174`],
  ['bad uuid', `p-not-a-uuid.preview.localhost:5174`],
  ['extra label', `x.p-${U}.preview.localhost:5174`],
];
for (const [label, host] of hostVariants) log(`  ${label.padEnd(28)} -> ${await hostProbe(host)}`);

writeFileSync(new URL('./p02-origin.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p02-origin.out');
