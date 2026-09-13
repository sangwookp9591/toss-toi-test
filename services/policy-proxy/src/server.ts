import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Downloads } from './downloads.js';
import type { DownloadRequest } from '../../../contracts/src/policy.js';
import { projectIdFromPreviewOrigin } from '../../../contracts/src/runtime.js';
import { randomUUID } from 'node:crypto';
import type { CapabilityClaims, RegisteredApi } from '../../../contracts/src/policy.js';
import type { PreviewSessionClaims, Approval } from '../../../contracts/src/auth.ts';
import { Access, type Actor } from './access.js';
import { isService } from './identity.js';
import type { PolicyConfig } from './config.js';
import { PolicyStorage, publicApi, sanitize, validateApi } from './storage.js';
import { HttpError, identifier, issueCapability, capabilityFromToken, signToken } from './tokens.js';
import { maskJson, scanPii, type PolicyWarning } from './mask.js';
import type { PolicyAuditRecord } from './storage.js';
const studioOrigin = 'http://localhost:5173';
const parsedBodies = new WeakMap<IncomingMessage, Record<string, unknown>>();
function requireJson(req: IncomingMessage) {
  if (header(req, 'content-type').split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'JSON_CONTENT_TYPE_REQUIRED');
}
function normalizePath(rawPath: string): string {
  let pathname = rawPath;
  for (let i = 0; i < 3; i++) {
    if (/%2f/i.test(pathname)) throw new HttpError(400, 'INVALID_PATH');
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'INVALID_PATH'); }
    if (decoded === pathname) break;
    pathname = decoded;
  }
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') || pathname.includes('%') || pathname.split('/').some(part => /;|\.$/.test(part.normalize('NFKC'))) || /[?#\u0000-\u0020\u007f]/.test(pathname)) throw new HttpError(400, 'INVALID_PATH');
  return pathname;
}
const writes = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const header = (req: IncomingMessage, name: string) => typeof req.headers[name] === 'string' ? req.headers[name] as string : '';
async function body(req: IncomingMessage): Promise<unknown> {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 262144) throw new HttpError(413, 'REQUEST_TOO_LARGE'); }
  try { const value = JSON.parse(raw); parsedBodies.set(req, value); return value; } catch { throw new HttpError(400, 'INVALID_JSON'); }
}
function allowedPath(api: RegisteredApi, pathname: string, method: string): boolean {
  return Object.entries(api.openapi.paths as Record<string, Record<string, unknown>>).some(([pattern, operations]) => {
    const expected = pattern.split('/'), actual = pathname.split('/');
    if (expected.length !== actual.length || !expected.every((part, index) => /^\{[^{}]+\}$/.test(part) ? Boolean(actual[index]) : part === actual[index]) || !operations[method.toLowerCase()]) return false;
    for (const [index, part] of expected.entries()) {
      if (/^\{[^{}]+\}$/.test(part) && !/^[A-Za-z0-9_\-\u0080-\u{10ffff}]+$/u.test(actual[index].normalize('NFKC'))) throw new HttpError(400, 'INVALID_PATH');
    }
    return true;
  });
}
export function createPolicyProxy(config: PolicyConfig, storage: PolicyStorage, access = new Access(config, storage), downloads?: Downloads) {
  const secrets = () => [config.downloads?.kek ?? '', config.downloads?.urlSecret ?? '', config.minio?.secretKey ?? '', config.upstreamToken, config.liveToken, config.policyClientSecret ?? '', config.sessionSecret, config.capabilitySecret, config.devAdminToken ?? '', ...[...storage.apis.values()].flatMap(api => Object.values(api.environments).flatMap(e => [e.upstreamBaseUrl, new URL(e.upstreamBaseUrl).host])), config.upstreamUrl, new URL(config.upstreamUrl).host];
  const send = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(sanitize(value, secrets()))); };
  async function proxy(req: IncomingMessage, res: ServerResponse, apiId: string, rawPath: string, query: string, download?: DownloadRequest) {
    const method = download ? 'GET' : req.method ?? 'GET', projectId = download?.projectId ?? header(req, 'x-toi-project');
    let session: Actor | undefined, capability: CapabilityClaims | undefined, reason: string | undefined, status = 500, value: unknown = { error: 'INTERNAL_ERROR' }, maskedFields: string[] = [], policyWarnings: PolicyWarning[] = [], denyReason: string | undefined;
    let pathname = rawPath;
    try {
      // Keep this ordering aligned with contracts/src/policy.ts.
      session = await access.authenticate(header(req, 'authorization'), !download);
      if (download) { access.user(session); if (header(req, 'x-toi-project') !== projectId) throw new HttpError(403, 'PROJECT_MISMATCH'); }
      session = await access.member(session, projectId, download ? 'editor' : 'viewer');
      const api = storage.apis.get(apiId); if (!api) throw new HttpError(404, 'API_NOT_FOUND');
      capability = capabilityFromToken(header(req, 'x-toi-capability'), config.capabilitySecret, projectId, session.sub);
      if (download && capability.mode !== 'read') throw new HttpError(403, 'READ_CAPABILITY_REQUIRED');
      access.validateLive(session, capability, apiId);
      if (!api.policy.allowedRoles.some(role => session!.roles.includes(role))) throw new HttpError(403, 'ROLE_FORBIDDEN');
      if (writes.has(method)) await access.member(session, projectId, capability.env === 'live' ? 'owner' : 'editor');
      if (header(req, 'x-toi-env') && header(req, 'x-toi-env') !== capability.env) throw new HttpError(403, 'ENV_MISMATCH');
      if (writes.has(method) && (capability.mode !== 'write' || !capability.apiIds?.includes(apiId) || !api.policy.allowWrite)) throw new HttpError(403, 'WRITE_FORBIDDEN');
      if (!writes.has(method) && !['GET', 'HEAD'].includes(method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      const rawReason = download ? encodeURIComponent(download.reason) : header(req, 'x-toi-reason');
      try { reason = rawReason ? decodeURIComponent(rawReason).trim() : undefined; } catch { throw new HttpError(400, 'INVALID_REASON_ENCODING'); }
      if (reason && reason.length > 500) throw new HttpError(400, 'REASON_TOO_LONG');
      if (api.policy.requireReason && (!reason || reason.length < 5)) throw new HttpError(428, 'REASON_REQUIRED');
      pathname = normalizePath(rawPath);
      if (!allowedPath(api, pathname, method)) throw new HttpError(404, 'OPERATION_NOT_REGISTERED');
      const upstreamUrl = new URL(api.environments[capability.env].upstreamBaseUrl);
      const expectedPath = upstreamUrl.pathname.replace(/\/+$/, '') + pathname.split('/').map(encodeURIComponent).join('/');
      upstreamUrl.pathname = expectedPath;
      if (upstreamUrl.pathname !== expectedPath) throw new HttpError(400, 'INVALID_PATH');
      upstreamUrl.search = query;
      const payload = writes.has(method) && method !== 'DELETE' ? await body(req) : undefined;
      const upstream = await fetch(upstreamUrl, { method, headers: { 'X-Service-Token': capability.env === 'preview' ? config.upstreamToken : config.liveToken, Accept: 'application/json', ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!upstream.ok) throw new HttpError(upstream.status >= 500 ? 502 : upstream.status, 'UPSTREAM_REJECTED');
      if (!upstream.headers.get('content-type')?.includes('application/json')) {
        const detected = scanPii(await upstream.text());
        maskedFields = detected.maskedFields;
        policyWarnings = detected.policyWarnings;
        throw new HttpError(502, policyWarnings.length ? 'UPSTREAM_PII_RESPONSE' : 'UPSTREAM_RESPONSE_INVALID');
      }
      const masked = maskJson(await upstream.json(), api.policy.mask); maskedFields = masked.maskedFields; policyWarnings = masked.policyWarnings; value = sanitize(masked.value, secrets()); status = upstream.status;
      if (download) {
        if (!downloads) throw new HttpError(503, 'DOWNLOADS_UNAVAILABLE');
        value = await downloads.create(download, session.sub, value, maskedFields); status = 201;
      }
    } catch (error) {
      status = error instanceof HttpError ? error.status : 502;
      denyReason = error instanceof HttpError ? error.code : 'UPSTREAM_UNAVAILABLE';
      value = { error: denyReason };
    }
    const record: PolicyAuditRecord = {
      action: download ? 'download-create' : 'proxy', ts: new Date().toISOString(), user: session?.sub ?? 'anonymous', projectId: identifier(projectId) ? projectId : 'unknown', apiId, method, path: pathname.slice(0, 500), status,
      ...(reason ? { reason } : {}), capability: capability ? { mode: capability.mode, env: capability.env, jti: capability.jti } : { mode: 'read', env: 'preview', jti: 'unverified' }, maskedFields, ...(policyWarnings.length ? { policyWarnings } : {}), decision: denyReason ? 'denied' : 'allowed', ...(denyReason ? { denyReason } : {}),
    };
    // Await durable append before responding. An audit write failure never becomes success.
    await storage.append(sanitize(record, [...secrets(), header(req, 'x-toi-capability'), header(req, 'authorization').replace(/^Bearer /, '')]));
    send(res, status, value);
  }
  return createServer(async (req, res) => {
    let actor: Actor | undefined;
    const route = (req.url ?? '/').split('?')[0];
    const action: PolicyAuditRecord['action'] | undefined = route.startsWith('/proxy/') ? 'proxy' : route === '/capabilities' ? 'capability' : route === '/preview-sessions' ? 'preview-session' : route.startsWith('/approvals') ? 'approval' : route === '/downloads' ? 'download-create' : route.startsWith('/downloads/') ? 'download-fetch' : undefined;
    const auditResponse = async (status: number) => {
      if (!action || storage.chain.brokenAt !== undefined) return;
      const input = parsedBodies.get(req);
      const approval = /^\/approvals\/([^/]+)\/decision$/.exec(route);
      const approvalRecord = approval ? access.approvals.get(approval[1]) : undefined;
      const queryProject = new URL(req.url ?? '/', 'http://policy.invalid').searchParams.get('projectId');
      await storage.append(sanitize({ action, ts: new Date().toISOString(), user: actor?.sub ?? 'anonymous', projectId: typeof input?.projectId === 'string' && identifier(input.projectId) ? input.projectId : approvalRecord?.projectId ?? (queryProject && identifier(queryProject) ? queryProject : header(req, 'x-toi-project') || 'unknown'), apiId: typeof input?.apiId === 'string' && identifier(input.apiId) ? input.apiId : approvalRecord?.apiId ?? 'unknown', method: req.method ?? 'GET', path: action === 'download-fetch' ? '/downloads/:id' : route.replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 200), status, maskedFields: [], decision: status < 400 ? 'allowed' : 'denied' } as PolicyAuditRecord, [...secrets(), header(req, 'authorization').replace(/^Bearer /, ''), header(req, 'x-toi-capability')]));
    };
    const reply = async (status: number, value: unknown) => { await auditResponse(status); send(res, status, value); };
    try {
      const rawUrl = req.url ?? '/', url = new URL(rawUrl, 'http://policy.invalid');
      const proxyMatch = rawUrl.split('?')[0].match(/^\/proxy\/([^/]+)(\/.*)?$/);
      const origin = req.headers.origin;
      if (origin && projectIdFromPreviewOrigin(origin)) return send(res, 403, { error: 'PREVIEW_DIRECT_FORBIDDEN' });
      if (req.method === 'GET' && url.pathname === '/healthz') return await reply(200, { status: storage.chain.health.degraded ? 'degraded' : 'ok', audit: storage.chain.health });
      storage.chain.assertHealthy();
      // Reject on the server before executing even simple (non-preflighted) requests.
      if (origin !== undefined && origin !== studioOrigin) throw new HttpError(403, 'ORIGIN_FORBIDDEN');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
        const requested = header(req, 'access-control-request-headers').split(',').map(item => item.trim().toLowerCase()).filter(item => ['authorization', 'content-type'].includes(item) || /^x-toi-[a-z0-9-]+$/.test(item));
        res.setHeader('Access-Control-Allow-Headers', [...new Set(['Authorization', 'Content-Type', 'X-Toi-Project', 'X-Toi-Capability', 'X-Toi-Reason', 'X-Toi-Env', ...requested])].join(', '));
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (['POST','PUT','PATCH','DELETE'].includes(req.method ?? '') && !proxyMatch) requireJson(req);
      if (req.method === 'POST' && ['/preview-sessions', '/downloads'].includes(url.pathname) && origin !== studioOrigin) throw new HttpError(403, 'STUDIO_ORIGIN_REQUIRED');
      if (proxyMatch) return await proxy(req, res, proxyMatch[1], proxyMatch[2] ?? '/', url.search);
      if (req.method === 'GET' && url.pathname === '/healthz') return await reply(200, { status: 'ok' });
      if (url.pathname === '/dev/session') throw new HttpError(404, 'NOT_FOUND');
      const session = await access.authenticate(header(req, 'authorization')); actor = session;
      const registryRead = req.method === 'GET' && /^\/apis(?:\/[^/]+)?$/.test(url.pathname);
      if (!(registryRead && session.identity && isService(session.identity, 'toi-agent-server'))) access.user(session);
      if (req.method === 'GET' && url.pathname === '/audit/verify') {
        if (!session.roles.includes('platform-admin')) throw new HttpError(403, 'PLATFORM_ADMIN_REQUIRED');
        const result = await storage.chain.verify();
        return await reply(result.ok ? 200 : 503, { ...result, ...(!result.ok ? { error: 'AUDIT_CHAIN_BROKEN' } : {}) });
      }
      if (req.method === 'POST' && url.pathname === '/downloads') {
        const input = await body(req) as DownloadRequest;
        if (!input || !identifier(input.projectId) || !identifier(input.apiId) || !['csv', 'xlsx'].includes(input.format) || typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.length > 500 || typeof input.path !== 'string' || input.path.length > 2000 || !input.path.startsWith('/') || input.path.includes('#')) throw new HttpError(400, 'INVALID_DOWNLOAD_REQUEST');
        const split = input.path.indexOf('?');
        return await proxy(req, res, input.apiId, split < 0 ? input.path : input.path.slice(0, split), split < 0 ? '' : input.path.slice(split), input);
      }
      const downloadMatch = /^\/downloads\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (req.method === 'GET' && downloadMatch) {
        if (!downloads) throw new HttpError(503, 'DOWNLOADS_UNAVAILABLE');
        if (url.searchParams.getAll('exp').length !== 1 || url.searchParams.getAll('sig').length !== 1) throw new HttpError(403, 'DOWNLOAD_SIGNATURE_INVALID');
        const fetched = await downloads.fetch(downloadMatch[1], session.sub, url.searchParams.get('exp') ?? '', url.searchParams.get('sig') ?? '');
        try {
          await storage.append({ action: 'download-fetch', ts: new Date().toISOString(), user: session.sub, projectId: fetched.record.projectId, apiId: fetched.record.apiId, method: 'GET', path: '/downloads/:id', status: 200, maskedFields: fetched.record.maskedFields, decision: 'allowed' });
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="download.zip"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          await pipeline(Readable.from([fetched.zip]), res);
          await downloads.remove(downloadMatch[1]);
        } finally { fetched.zip.fill(0); }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/preview-sessions') {
        const input = await body(req) as { projectId: string; write?: { apiIds: string[]; ttlSec: number } };
        if (!input || !identifier(input.projectId) || (input.write !== undefined && (!input.write || !Number.isInteger(input.write.ttlSec) || input.write.ttlSec < 1 || input.write.ttlSec > 120))) throw new HttpError(400, 'INVALID_PREVIEW_REQUEST');
        const member = await access.member(session, input.projectId, input.write ? 'editor' : 'viewer');
        const issued = issueCapability({ projectId: input.projectId, env: 'preview', mode: input.write ? 'write' : 'read', ttlSec: input.write?.ttlSec ?? 120, apiIds: input.write?.apiIds }, member, config.capabilitySecret);
        const sessionClaims: PreviewSessionClaims = { sub: session.sub, projectId: input.projectId, roles: ['viewer'], aud: 'toi-preview', exp: issued.claims.exp, jti: randomUUID() };
        return await reply(200, { sessionToken: signToken(sessionClaims, config.sessionSecret, 'toi-preview'), sessionClaims, capabilityToken: issued.token, capability: issued.claims });
      }
      if (req.method === 'POST' && url.pathname === '/approvals') {
        const input = await body(req) as Approval;
        if (!input || !identifier(input.projectId) || !identifier(input.apiId) || input.scope !== 'live-write' || typeof input.justification !== 'string' || input.justification.trim().length < 5 || input.justification.length > 500) throw new HttpError(400, 'INVALID_APPROVAL_REQUEST');
        await access.member(session, input.projectId, 'owner');
        const api = storage.apis.get(input.apiId);
        if (!api) throw new HttpError(404, 'API_NOT_FOUND');
        if (!api.policy.allowWrite) throw new HttpError(403, 'WRITE_FORBIDDEN');
        return await reply(201, access.save({ projectId: input.projectId, apiId: input.apiId, scope: 'live-write', justification: sanitize(input.justification.trim(), secrets()), approvalId: randomUUID(), requestedBy: session.sub, status: 'pending', expiresAt: new Date(Date.now() + config.approvalTtlSec * 1000).toISOString() }));
      }
      const decisionRoute = /^\/approvals\/([^/]+)\/decision$/.exec(url.pathname);
      if (req.method === 'POST' && decisionRoute) {
        const a = access.approvals.get(decisionRoute[1]);
        if (!a) throw new HttpError(404, 'APPROVAL_NOT_FOUND');
        if (a.requestedBy === session.sub) throw new HttpError(403, 'FOUR_EYES_REQUIRED');
        if (!access.owns(session, a.apiId)) throw new HttpError(403, 'API_OWNER_REQUIRED');
        const input = await body(req) as { decision: string };
        if (!input || !['approved','rejected'].includes(input.decision)) throw new HttpError(400, 'INVALID_DECISION');
        // The requester must still be owner when a decision is recorded.
        const membership = await access.membership(a.projectId);
        if (!membership.members.some(m => m.sub === a.requestedBy && m.role === 'owner')) throw new HttpError(403, 'PROJECT_OWNER_REQUIRED');
        if (access.current(access.approvals.get(a.approvalId)!).status !== 'pending') throw new HttpError(409, 'APPROVAL_NOT_PENDING');
        return await reply(200, access.save({ ...a, status: input.decision as 'approved' | 'rejected', decidedBy: session.sub, decidedAt: new Date().toISOString() }));
      }
      if (req.method === 'GET' && url.pathname === '/approvals') {
        const projectId = url.searchParams.get('projectId') ?? '';
        if (!identifier(projectId)) throw new HttpError(400, 'PROJECT_REQUIRED');
        const values = [...access.approvals.values()].filter(a => a.projectId === projectId);
        try { await access.member(session, projectId); return await reply(200, values.map(a => access.current(a))); }
        catch (e) { if (!(e instanceof HttpError) || e.status !== 404) throw e; }
        const owned = values.filter(a => access.owns(session, a.apiId));
        if (!owned.length) throw new HttpError(404, 'PROJECT_NOT_FOUND');
        return await reply(200, owned.map(a => access.current(a)));
      }
      if (req.method === 'GET' && url.pathname === '/apis') return await reply(200, [...storage.apis.values()].map(api => publicApi(api, secrets())));
      const apiMatch = url.pathname.match(/^\/apis\/([^/]+)$/);
      if (req.method === 'GET' && apiMatch) { const api = storage.apis.get(apiMatch[1]); if (!api) throw new HttpError(404, 'API_NOT_FOUND'); return await reply(200, publicApi(api, secrets())); }
      if (req.method === 'POST' && url.pathname === '/apis') {
        if (!session.roles.includes('platform-admin')) throw new HttpError(403, 'PLATFORM_ADMIN_REQUIRED');
        const api = validateApi(await body(req), config.upstreamAllowlist); await storage.save(api); return await reply(201, publicApi(api, secrets()));
      }
      if (req.method === 'POST' && url.pathname === '/capabilities') {
        const input = await body(req) as CapabilityClaims;
        const member = await access.member(session, input?.projectId, input?.env === 'live' ? 'owner' : input?.mode === 'write' ? 'editor' : 'viewer');
        const issued = issueCapability(input, member, config.capabilitySecret);
        access.validateLive(session, issued.claims);
        return await reply(200, issued);
      }
      if (req.method === 'GET' && url.pathname === '/audit') {
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
        const isAdmin = session.roles.includes('platform-admin'), projectId = url.searchParams.get('projectId');
        if (!isAdmin && !identifier(projectId)) throw new HttpError(400, 'AUDIT_PROJECT_REQUIRED');
        let owner = false;
        if (!isAdmin) owner = (await access.member(session, projectId!)).roles.includes('owner');
        const records = await storage.audit(projectId || undefined, limit, isAdmin || owner ? undefined : session.sub);
        return await reply(200, records);
      }
      throw new HttpError(404, 'NOT_FOUND');
    } catch (error) { if (!res.headersSent) { try { await reply(error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.code : 'INTERNAL_ERROR', ...(storage.chain.brokenAt !== undefined ? { brokenAt: storage.chain.brokenAt } : {}) }); } catch (auditError) { send(res, 503, { error: auditError instanceof HttpError ? auditError.code : 'AUDIT_CHAIN_BROKEN' }); } } else res.destroy(); }
  });
}
