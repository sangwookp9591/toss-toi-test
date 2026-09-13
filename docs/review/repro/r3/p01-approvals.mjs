// P0-1 4-eyes live-write approvals. Non-destructive: no live write is committed; we only
// exercise the approval/capability gate (capability issuance is the proof point).
import { login, req, serviceToken, AGENT, POLICY, STUDIO } from './lib.mjs';
const out = []; const log = (l, r) => { const s = `${l.padEnd(58)} -> ${r.status} ${typeof r.body==='object'?JSON.stringify(r.body).slice(0,90):String(r.body).slice(0,70)}`; out.push(s); console.log(s); };
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const alice = await login('alice'), bob = await login('bob'), carol = await login('carol'), dana = await login('dana'), root = await login('root');
const A = { token: alice.access_token, origin: STUDIO };

// Second live-writable API owned by dana, same allowed upstream, to test cross-api approval reuse.
const customers = (await req(`${POLICY}/apis/customers`, { token: root.access_token, origin: STUDIO })).body;
const api2 = { ...customers, apiId: 'customers2', owners: [dana.sub],
  environments: { preview: { upstreamBaseUrl: 'http://localhost:7300/preview' }, live: { upstreamBaseUrl: 'http://localhost:7300/live' } } };
log('root register customers2 (owner=dana)', await req(`${POLICY}/apis`, { method:'POST', token: root.access_token, origin: STUDIO, body: api2 }));

const proj = (await req(AGENT + '/projects', { method:'POST', ...A, body:{name:'r3-approval', apiIds:['customers']}})).body;
const P = proj.projectId; console.log('# project', P);

console.log('\n== request + self/cross approvals ==');
const ap = (await req(`${POLICY}/approvals`, { method:'POST', ...A, body:{projectId:P, apiId:'customers', scope:'live-write', justification:'r3 review live write test'}}));
log('alice request approval (customers)', ap);
const approvalId = ap.body.approvalId;
log('alice self-approve (four-eyes)', await req(`${POLICY}/approvals/${approvalId}/decision`, { method:'POST', ...A, body:{decision:'approved'}}));
log('carol decide (not api-owner)', await req(`${POLICY}/approvals/${approvalId}/decision`, { method:'POST', token: carol.access_token, origin: STUDIO, body:{decision:'approved'}}));
log('bob decide (member editor, not api-owner)', await req(`${POLICY}/approvals/${approvalId}/decision`, { method:'POST', token: bob.access_token, origin: STUDIO, body:{decision:'approved'}}));
log('dana approve (api-owner, four-eyes ok)', await req(`${POLICY}/approvals/${approvalId}/decision`, { method:'POST', token: dana.access_token, origin: STUDIO, body:{decision:'approved'}}));
log('dana re-decide already-approved', await req(`${POLICY}/approvals/${approvalId}/decision`, { method:'POST', token: dana.access_token, origin: STUDIO, body:{decision:'rejected'}}));

console.log('\n== capability gated by approval ==');
log('alice issue LIVE write cap for customers (approved)', await req(`${POLICY}/capabilities`, { method:'POST', ...A, body:{projectId:P, env:'live', mode:'write', apiIds:['customers'], ttlSec:60}}));
log('alice issue LIVE write cap for customers2 (approval is for customers)', await req(`${POLICY}/capabilities`, { method:'POST', ...A, body:{projectId:P, env:'live', mode:'write', apiIds:['customers2'], ttlSec:60}}));
log('alice issue LIVE write cap [customers,customers2] (partial)', await req(`${POLICY}/capabilities`, { method:'POST', ...A, body:{projectId:P, env:'live', mode:'write', apiIds:['customers','customers2'], ttlSec:60}}));

console.log('\n== cross-project reuse of approval ==');
const proj2 = (await req(AGENT + '/projects', { method:'POST', ...A, body:{name:'r3-approval2', apiIds:['customers']}})).body; const P2 = proj2.projectId;
log('alice LIVE write cap for customers in P2 (approval was for P)', await req(`${POLICY}/capabilities`, { method:'POST', ...A, body:{projectId:P2, env:'live', mode:'write', apiIds:['customers'], ttlSec:60}}));

console.log('\n== approval reuse (same approval, second capability) ==');
log('alice re-issue LIVE write cap (reuse approval)', await req(`${POLICY}/capabilities`, { method:'POST', ...A, body:{projectId:P, env:'live', mode:'write', apiIds:['customers'], ttlSec:60}}));

console.log('\n== approval expiry (running instance TTL) ==');
const ap2 = (await req(`${POLICY}/approvals`, { method:'POST', ...A, body:{projectId:P, apiId:'customers', scope:'live-write', justification:'r3 expiry probe justification'}})).body;
await req(`${POLICY}/approvals/${ap2.approvalId}/decision`, { method:'POST', token: dana.access_token, origin: STUDIO, body:{decision:'approved'}});
log('cap right after approve', await req(`${POLICY}/capabilities`, { method:'POST', ...A, body:{projectId:P, env:'live', mode:'write', apiIds:['customers'], ttlSec:60}}));
console.log('   ...sleeping 9s to cross approval TTL...');
await sleep(9000);
const listed = await req(`${POLICY}/approvals?projectId=${P}`, { ...A });
out.push('approvals after 9s: ' + JSON.stringify(listed.body).slice(0,200)); console.log(out.at(-1));
log('cap after TTL (expired approval)', await req(`${POLICY}/capabilities`, { method:'POST', ...A, body:{projectId:P, env:'live', mode:'write', apiIds:['customers'], ttlSec:60}}));

import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./p01-approvals.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p01-approvals.out');
