import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { generateKeyPair, exportJWK, SignJWT } from '../services/agent-server/node_modules/jose/dist/webapi/index.js';
import { createAgentServer } from '../services/agent-server/src/server.ts';
import { Identity } from '../services/agent-server/src/identity.ts';
import { PolicyClient } from '../services/agent-server/src/policy-client.ts';
import { createPolicyProxy } from '../services/policy-proxy/src/server.ts';
import { PolicyStorage } from '../services/policy-proxy/src/storage.ts';
import { listen, close, startUpstream, seedApis, json, budgetSignal, studioOrigin } from './fixtures.mjs';

/** Local test IdP: real RS256/JWKS verification, isolated keys, no production credentials. */
async function startIdentity() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'eval-key', alg: 'RS256', use: 'sig' };
  let issuer;
  const issue = async (client = 'toi-studio') => new SignJWT({ preferred_username: client === 'toi-studio' ? 'eval-owner' : `service-account-${client}`, azp: client, realm_access: { roles: ['builder', 'platform-admin'] }, groups: ['/eval'] }).setProtectedHeader({ alg: 'RS256', kid: 'eval-key' }).setIssuer(issuer).setAudience('toi-api').setSubject(client === 'toi-studio' ? 'eval-owner' : client).setIssuedAt().setExpirationTime('4h').sign(privateKey);
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/certs')) { res.end(JSON.stringify({ keys: [jwk] })); return; }
    if (req.url.endsWith('/token')) { let body = ''; for await (const chunk of req) body += chunk; const input = new URLSearchParams(body); const client = input.get('client_id'); if (!['toi-agent-server', 'toi-policy-proxy'].includes(client) || input.get('client_secret') !== secret) { res.writeHead(401).end('{}'); return; } res.end(JSON.stringify({ access_token: await issue(client), expires_in: 14400 })); return; }
    res.writeHead(404).end('{}');
  });
  const secret = randomBytes(32).toString('hex');
  issuer = await listen(server) + '/realms/eval';
  return { issuer, secret, issue, close: () => close(server) };
}
export async function environment(driver) {
  if (process.env.EVAL_AGENT_URL && (!process.env.EVAL_POLICY_URL || !process.env.EVAL_UPSTREAM_URL)) throw new Error('External mode requires EVAL_POLICY_URL and allowlisted EVAL_UPSTREAM_URL');
  await mkdir(new URL('.cache/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('.cache/run-', import.meta.url).pathname);
  const upstream = await startUpstream();
  if (process.env.EVAL_AGENT_URL) {
    if (!process.env.EVAL_POLICY_URL || !process.env.EVAL_UPSTREAM_URL) throw new Error('External mode requires EVAL_POLICY_URL and allowlisted EVAL_UPSTREAM_URL');
    const token = process.env.EVAL_AUTH_TOKEN;
    return { agentUrl: process.env.EVAL_AGENT_URL, policyUrl: process.env.EVAL_POLICY_URL, token, upstream, external: true,
      async seed(attack) { await seedApis(this.policyUrl, process.env.EVAL_ADMIN_TOKEN ?? token, process.env.EVAL_UPSTREAM_URL, attack); },
      async preview(project, write) { return previewSession(this.policyUrl, token, project, write); },
      async close() { await upstream.close(); await rm(directory, { recursive: true, force: true }); } };
  }
  const idp = await startIdentity();
  const token = await idp.issue();
  const config = { dataDir: directory + '/policy', upstreamUrl: upstream.url, upstreamToken: randomBytes(32).toString('hex'), liveToken: randomBytes(32).toString('hex'), sessionSecret: randomBytes(32).toString('hex'), capabilitySecret: randomBytes(32).toString('hex'), upstreamAllowlist: [upstream.url], devAuth: false, identityIssuer: idp.issuer, policyClientSecret: idp.secret, agentUrl: '', apiOwners: ['eval-owner'], approvalTtlSec: 300 };
  const storage = new PolicyStorage(config.dataDir); await storage.init();
  const policy = createPolicyProxy(config, storage); const policyUrl = await listen(policy);
  const app = createAgentServer({ dataDir: directory + '/agent', driver, identity: new Identity({ issuer: idp.issuer }), policy: new PolicyClient(policyUrl, fetch, await idp.issue('toi-agent-server')) });
  const agentUrl = await listen(app.server); config.agentUrl = agentUrl;
  return { app, agentUrl, policyUrl, token, upstream, external: false,
    async seed(attack) { upstream.reset(attack); await seedApis(policyUrl, token, upstream.url, attack); },
    async preview(project, write) { return previewSession(policyUrl, token, project, write); },
    async audit(projectId) { return json(policyUrl + '/audit?projectId=' + projectId, undefined, token); },
    async close() { await app.close(); await close(policy); await upstream.close(); await idp.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
async function previewSession(policyUrl, token, project, write) {
  const response = await fetch(policyUrl + '/preview-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: studioOrigin, Authorization: `Bearer ${token}` }, body: JSON.stringify({ projectId: project.projectId, ...(write ? { write: { apiIds: project.apiIds, ttlSec: 120 } } : {}) }), signal: budgetSignal() });
  if (!response.ok) throw new Error(`preview-session HTTP ${response.status}`);
  const value = await response.json();
  // Node-only credentials for readback/security probes; frames receive previewHostConfig instead.
  return { session: value, toiFetch: { sessionToken: value.sessionToken, capabilityToken: value.capabilityToken, projectId: project.projectId, proxyBaseUrl: policyUrl, env: 'preview' } };
}
