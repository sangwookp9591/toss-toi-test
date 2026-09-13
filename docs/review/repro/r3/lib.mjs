// R3 security review helper. Non-destructive. Reads secrets from root .env at runtime;
// never prints secret values (only lengths / booleans). Drives Keycloak auth-code+PKCE
// over HTTP (toi-studio is a public client with directAccessGrants disabled).
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
export const ISSUER = process.env.TOI_IDENTITY_ISSUER ?? 'http://localhost:8080/realms/toi';
export const STUDIO = 'http://localhost:5173';
export const POLICY = 'http://localhost:7200';
export const AGENT = 'http://localhost:7400';
export const DEPS = 'http://localhost:7100';
export const MOCK = 'http://localhost:7300';
const b64url = buf => Buffer.from(buf).toString('base64url');

// Cookie jar-based auth code + PKCE login (no browser needed).
export async function login(username) {
  const password = process.env['TOI_PASSWORD_' + username.toUpperCase()];
  if (!password) throw new Error('missing password env for ' + username);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(8)), nonce = b64url(randomBytes(8));
  const redirect = STUDIO + '/callback';
  const authUrl = ISSUER + '/protocol/openid-connect/auth?' + new URLSearchParams({
    client_id: 'toi-studio', redirect_uri: redirect, response_type: 'code', scope: 'openid',
    code_challenge: challenge, code_challenge_method: 'S256', state, nonce,
  });
  let res = await fetch(authUrl, { redirect: 'manual' });
  let cookies = collect(res);
  const html = await res.text();
  const action = /action="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&');
  if (!action) throw new Error('login form not found for ' + username);
  res = await fetch(action, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });
  const loc = res.headers.get('location');
  if (!loc) throw new Error('no auth redirect for ' + username + ' (status ' + res.status + ')');
  const code = new URL(loc).searchParams.get('code');
  if (!code) throw new Error('no code in redirect for ' + username + ': ' + loc);
  const tok = await fetch(ISSUER + '/protocol/openid-connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'toi-studio', code, redirect_uri: redirect, code_verifier: verifier }),
  });
  if (!tok.ok) throw new Error('token exchange failed for ' + username + ': ' + tok.status + ' ' + await tok.text());
  const json = await tok.json();
  json.sub = JSON.parse(Buffer.from(json.access_token.split('.')[1], 'base64url').toString()).sub;
  json.username = username;
  return json;
}
function collect(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  return set.map(c => c.split(';')[0]).join('; ');
}
// client_credentials service token (secret from .env)
export async function serviceToken(clientId, secretEnv) {
  const secret = process.env[secretEnv];
  if (!secret) throw new Error('missing ' + secretEnv);
  const res = await fetch(ISSUER + '/protocol/openid-connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }),
  });
  if (!res.ok) throw new Error('service token failed ' + clientId + ': ' + res.status);
  return (await res.json()).access_token;
}
// Convenience request against policy proxy. Pass origin explicitly to simulate a browser context.
export async function req(url, { method = 'GET', token, capability, project, reason, env, body, origin, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  if (capability) h['X-Toi-Capability'] = capability;
  if (project) h['X-Toi-Project'] = project;
  if (reason) h['X-Toi-Reason'] = reason;
  if (env) h['X-Toi-Env'] = env;
  if (origin) h.Origin = origin;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; }
  const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  let parsed; const text = await res.text();
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
}
export function decodeJwt(token) {
  const [h, p] = token.split('.');
  return { header: JSON.parse(Buffer.from(h, 'base64url').toString()), payload: JSON.parse(Buffer.from(p, 'base64url').toString()) };
}
export async function createProject(agentToken, name = 'r3-' + randomBytes(4).toString('hex')) {
  const res = await req(AGENT + '/projects', { method: 'POST', token: agentToken, origin: STUDIO, body: { name, apiIds: ['customers'] } });
  return res;
}
