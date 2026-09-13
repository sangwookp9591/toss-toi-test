// P0-1 authorization: membership existence, roles, 4-eyes approvals, capability cross-use,
// preview/live separation. Non-destructive: new project, preview-env only, no live writes committed.
import { login, req, AGENT, POLICY, STUDIO, decodeJwt } from './lib.mjs';
const out = []; const log = (l, r) => { const s = `${l.padEnd(56)} -> ${r.status} ${typeof r.body==='object'?JSON.stringify(r.body).slice(0,90):String(r.body).slice(0,70)}`; out.push(s); console.log(s); };
const ms = async fn => { const t=process.hrtime.bigint(); const r=await fn(); return { r, ms: Number(process.hrtime.bigint()-t)/1e6 }; };

const alice = await login('alice'), bob = await login('bob'), carol = await login('carol'), dana = await login('dana'), root = await login('root');
const SUB = { alice: alice.sub, bob: bob.sub, carol: carol.sub, dana: dana.sub, root: root.sub };
const A = { token: alice.access_token, origin: STUDIO };

// Project owned by alice
const proj = (await req(AGENT + '/projects', { method:'POST', ...A, body:{name:'r3-authz', apiIds:['customers']}})).body;
const P = proj.projectId; console.log('# project', P, 'owner alice');

console.log('\n== Membership existence disclosure (non-member should be 404, not 403) ==');
log('carol GET membership (non-member)', await req(`${AGENT}/projects/${P}/membership`, { token: carol.access_token, origin: STUDIO }));
log('carol GET project (non-member)', await req(`${AGENT}/projects/${P}`, { token: carol.access_token, origin: STUDIO }));
log('carol GET /audit?projectId (non-member via policy)', await req(`${POLICY}/audit?projectId=${P}`, { token: carol.access_token, origin: STUDIO }));
log('carol GET membership of NONEXISTENT project', await req(`${AGENT}/projects/00000000-0000-4000-8000-000000000000/membership`, { token: carol.access_token, origin: STUDIO }));
// timing: member-nonexistent vs nonmember-existing
{ const t1 = await ms(()=>req(`${AGENT}/projects/${P}/membership`, { token: carol.access_token, origin: STUDIO }));
  const t2 = await ms(()=>req(`${AGENT}/projects/11111111-1111-4111-8111-111111111111/membership`, { token: carol.access_token, origin: STUDIO }));
  out.push(`timing: nonmember-existing=${t1.ms.toFixed(1)}ms status=${t1.r.status}; member?-nonexistent=${t2.ms.toFixed(1)}ms status=${t2.r.status}`); console.log(out.at(-1)); }

console.log('\n== Add bob as editor, viewer role checks ==');
log('alice PUT bob=editor', await req(`${AGENT}/projects/${P}/members/${SUB.bob}`, { method:'PUT', ...A, body:{role:'editor'}}));
log('bob (editor) GET membership', await req(`${AGENT}/projects/${P}/membership`, { token: bob.access_token, origin: STUDIO }));
log('bob (editor) PUT carol=viewer (owner-only)', await req(`${AGENT}/projects/${P}/members/${SUB.carol}`, { method:'PUT', token: bob.access_token, origin: STUDIO, body:{role:'viewer'}}));
log('bob (editor) GET /audit (should see own only, owner=false)', await req(`${POLICY}/audit?projectId=${P}`, { token: bob.access_token, origin: STUDIO }));

console.log('\n== Last-owner protection ==');
log('alice demote self to editor (last owner)', await req(`${AGENT}/projects/${P}/members/${SUB.alice}`, { method:'PUT', ...A, body:{role:'editor'}}));
log('alice DELETE self (last owner)', await req(`${AGENT}/projects/${P}/members/${SUB.alice}`, { method:'DELETE', ...A }));

console.log('\n== Role change is visible immediately (no 5s cache) ==');
log('alice PUT bob=viewer', await req(`${AGENT}/projects/${P}/members/${SUB.bob}`, { method:'PUT', ...A, body:{role:'viewer'}}));
// bob now viewer: try to issue a preview WRITE session (needs editor) immediately
log('bob viewer -> preview-session WRITE (immediately)', await req(`${POLICY}/preview-sessions`, { method:'POST', token: bob.access_token, origin: STUDIO, body:{projectId:P, write:{apiIds:['customers'], ttlSec:60}}}));
log('alice PUT bob=editor (restore)', await req(`${AGENT}/projects/${P}/members/${SUB.bob}`, { method:'PUT', ...A, body:{role:'editor'}}));
log('bob editor -> preview-session WRITE (immediately)', await req(`${POLICY}/preview-sessions`, { method:'POST', token: bob.access_token, origin: STUDIO, body:{projectId:P, write:{apiIds:['customers'], ttlSec:60}}}));

console.log('\n== preview-session issuance boundary ==');
log('preview-session from PREVIEW origin (forbidden)', await req(`${POLICY}/preview-sessions`, { method:'POST', token: alice.access_token, origin:`http://p-${P}.preview.localhost:5174`, body:{projectId:P}}));
log('preview-session no origin (server-to-server)', await req(`${POLICY}/preview-sessions`, { method:'POST', token: alice.access_token, body:{projectId:P}}));
log('preview-session ttlSec 999 (write, >120)', await req(`${POLICY}/preview-sessions`, { method:'POST', ...A, body:{projectId:P, write:{apiIds:['customers'], ttlSec:999}}}));

console.log('\n== capability cross-use ==');
const previewA = (await req(`${POLICY}/preview-sessions`, { method:'POST', ...A, body:{projectId:P}})).body;
// alice's read capability + alice session works
log('alice preview read /proxy/customers', await req(`${POLICY}/proxy/customers/customers`, { token: previewA.sessionToken, capability: previewA.capabilityToken, project: P, reason:'r3 review read', origin:`http://p-${P}.preview.localhost:5174`}));
// use alice's capability token with bob's session (sub mismatch)
const previewBob = (await req(`${POLICY}/preview-sessions`, { method:'POST', token: bob.access_token, origin: STUDIO, body:{projectId:P}})).body;
log('bob session + alice capability (sub mismatch)', await req(`${POLICY}/proxy/customers/customers`, { token: previewBob.sessionToken, capability: previewA.capabilityToken, project: P, reason:'r3 mix', origin:`http://p-${P}.preview.localhost:5174`}));
// second project owned by alice; use P capability against P2
const proj2 = (await req(AGENT + '/projects', { method:'POST', ...A, body:{name:'r3-authz2', apiIds:['customers']}})).body; const P2 = proj2.projectId;
log('P capability against P2 (projectId mismatch)', await req(`${POLICY}/proxy/customers/customers`, { token: previewA.sessionToken, capability: previewA.capabilityToken, project: P2, reason:'r3 xproj', origin:`http://p-${P2}.preview.localhost:5174`}));
log('P capability, header project=P2, preview origin=P', await req(`${POLICY}/proxy/customers/customers`, { token: previewA.sessionToken, capability: previewA.capabilityToken, project: P2, reason:'r3 xproj2', origin:`http://p-${P}.preview.localhost:5174`}));

console.log('\n== preview capability used for live data ==');
log('preview read cap + X-Toi-Env: live', await req(`${POLICY}/proxy/customers/customers`, { token: previewA.sessionToken, capability: previewA.capabilityToken, project: P, reason:'r3 live', env:'live', origin:`http://p-${P}.preview.localhost:5174`}));

import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./p01-authz.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p01-authz.out ; P=',P,'P2=',P2);
