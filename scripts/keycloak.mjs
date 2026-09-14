import { parseEnv } from 'node:util';
import { configuredPort } from './dev-ports.mjs';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { volumeCredentialError } from './compose.mjs';
// Bootstrap runs only in dev-up. Credentials and admin responses are never logged.
export async function provisionIdentity(envFile, env = process.env) {
  const base = keycloakBase(env);
  const auth = await fetch(base + '/realms/master/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'toi-bootstrap', password: env.TOI_KEYCLOAK_ADMIN_PASSWORD }), signal: AbortSignal.timeout(5000) });
  if (!auth.ok) {
    const body = await auth.json().catch(() => ({}));
    if (auth.status === 401 || (auth.status === 400 && body.error === 'invalid_grant')) throw volumeCredentialError('Keycloak', env);
    const summary = `Keycloak bootstrap authentication request failed (HTTP ${auth.status})`;
    throw Object.assign(new Error(summary), { safeSummary: summary });
  }
  const { access_token } = await auth.json();
  async function admin(path, method = 'GET', body) {
    const response = await fetch(base + '/admin/realms/toi' + path, { method, headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Keycloak provisioning failed (${response.status})`);
    return response.status === 204 ? undefined : response.json();
  }
  let contents = await readFile(envFile, 'utf8');
  const set = (key, value) => { env[key] = value; contents = contents.replace(new RegExp('^(?:export\\s+)?' + key + '=.*$', 'gm'), '').trimEnd() + '\n' + key + '=' + value + '\n'; };
  for (const username of ['alice','bob','carol','dana','root']) {
    const users = await admin('/users?exact=true&username=' + username);
    if (users.length !== 1) throw new Error('Keycloak seed user missing');
    await admin('/users/' + users[0].id + '/reset-password', 'PUT', { type: 'password', temporary: false, value: env['TOI_PASSWORD_' + username.toUpperCase()] });
    set('TOI_SUB_' + username.toUpperCase(), users[0].id);
  }
  const clients = await admin('/clients');
  for (const [clientId, key] of [['toi-agent-server','TOI_AGENT_CLIENT_SECRET'],['toi-policy-proxy','TOI_POLICY_CLIENT_SECRET']]) {
    const client = clients.find(c => c.clientId === clientId);
    if (!client) throw new Error('Keycloak seed client missing');
    await admin('/clients/' + client.id, 'PUT', { ...client, secret: env[key] });
  }
  // Realm imports do not update clients already persisted in the Keycloak volume.
  const studio = clients.find(c => c.clientId === 'toi-studio');
  const migrateOrigin = value => value === 'http://localhost:5173' ? 'http://localhost:5273' : value === 'http://localhost:5173/*' ? 'http://localhost:5273/*' : value;
  await admin('/clients/' + studio.id, 'PUT', { ...studio,
    redirectUris: studio.redirectUris.map(migrateOrigin), webOrigins: studio.webOrigins.map(migrateOrigin),
    attributes: { ...studio.attributes, 'post.logout.redirect.uris': migrateOrigin(studio.attributes['post.logout.redirect.uris']) },
  });
  // Only the agent may resolve real identities for owner-authorized member management.
  const agent = clients.find(c => c.clientId === 'toi-agent-server');
  const management = clients.find(c => c.clientId === 'realm-management');
  const serviceUser = await admin('/clients/' + agent.id + '/service-account-user');
  const viewUsers = await admin('/clients/' + management.id + '/roles/view-users');
  await admin('/users/' + serviceUser.id + '/role-mappings/clients/' + management.id, 'POST', [viewUsers]);
  if (!parseEnv(contents).TOI_IDENTITY_ISSUER) set('TOI_IDENTITY_ISSUER', env.TOI_IDENTITY_ISSUER || base + '/realms/toi');
  await writeFile(envFile, contents, { mode: 0o600 }); await chmod(envFile, 0o600);
}

export function keycloakBase(env = process.env) {
  return `http://localhost:${configuredPort('TOI_KEYCLOAK_PORT', 8180, env)}`;
}
