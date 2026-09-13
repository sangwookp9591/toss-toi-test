import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { afterAll } from 'vitest';
import { Identity } from '../src/identity.ts';
const keys = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture' };
export const subjects: Record<string, { username: string; enabled: boolean }> = Object.fromEntries(['alice','bob','carol','dana','root'].map(username => [username, { username, enabled: true }]));
let issuer: string;
export async function token(sub = 'alice', overrides: Record<string, unknown> = {}) {
  return new SignJWT({ iss: issuer, aud: 'toi-api', sub, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300, preferred_username: sub, azp: 'toi-studio', realm_access: { roles: ['builder'] }, groups: ['/team-a'], ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(keys.privateKey);
}
const idp = createServer(async (req,res) => {
  res.setHeader('Content-Type','application/json');
  if (req.url?.endsWith('/certs')) return res.end(JSON.stringify({keys:[jwk]}));
  if (req.url?.endsWith('/token')) {
    let raw=''; for await (const chunk of req) raw+=chunk;
    const input = new URLSearchParams(raw), client = input.get('client_id');
    if (input.get('client_secret') !== 'fixture-secret' || !['toi-agent-server','toi-policy-proxy'].includes(client!)) { res.writeHead(401); return res.end('{}'); }
    return res.end(JSON.stringify({ access_token: await token('service-account-'+client, { azp: client, preferred_username:'service-account-'+client }), expires_in:300 }));
  }
  const url = new URL(req.url!, issuer);
  const user = url.pathname.split('/users/')[1];
  if (user && subjects[user]) return res.end(JSON.stringify({ id: user, ...subjects[user] }));
  if (url.pathname.endsWith('/users')) return res.end(JSON.stringify(Object.entries(subjects).filter(([,u])=>u.username===url.searchParams.get('username')).map(([id,u])=>({id,...u}))));
  res.writeHead(404); res.end('{}');
});
await new Promise<void>(r=>idp.listen(0,'127.0.0.1',r));
issuer=`http://127.0.0.1:${(idp.address() as {port:number}).port}/realms/toi`;
export const identity = () => new Identity({ issuer, clientId:'toi-agent-server', clientSecret:'fixture-secret' });
afterAll(async()=>{idp.closeAllConnections();await new Promise<void>(r=>idp.close(()=>r()));});
