import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AuditRecord, CapabilityClaims, RegisteredApi } from '../../../contracts/src/policy.js';
import type { PolicyConfig } from './config.js';
import { PolicyStorage, publicApi, sanitize, validateApi } from './storage.js';
import { HttpError, identifier, issueCapability, sessionFromHeader, capabilityFromToken, signToken, type SessionClaims } from './tokens.js';
import { maskJson } from './mask.js';
const allowedOrigins = new Set(['http://localhost:5173', 'http://localhost:5174']);
const writes = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const header = (req: IncomingMessage, name: string) => typeof req.headers[name] === 'string' ? req.headers[name] as string : '';
async function body(req: IncomingMessage): Promise<unknown> {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 262144) throw new HttpError(413, 'REQUEST_TOO_LARGE'); }
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'INVALID_JSON'); }
}
function allowedPath(api: RegisteredApi, pathname: string, method: string): boolean {
  return Object.entries(api.openapi.paths as Record<string, Record<string, unknown>>).some(([pattern, operations]) => {
    const expected = pattern.split('/'), actual = pathname.split('/');
    return expected.length === actual.length && expected.every((part, index) => /^\{[^{}]+\}$/.test(part) ? Boolean(actual[index]) : part === actual[index]) && Boolean(operations[method.toLowerCase()]);
  });
}
export function createPolicyProxy(config: PolicyConfig, storage: PolicyStorage) {
  const secrets = () => [config.upstreamToken, config.sessionSecret, config.capabilitySecret, ...[...storage.apis.values()].flatMap(api => [api.upstreamBaseUrl, new URL(api.upstreamBaseUrl).host]), config.upstreamUrl, new URL(config.upstreamUrl).host];
  const send = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(sanitize(value, secrets()))); };
  async function proxy(req: IncomingMessage, res: ServerResponse, apiId: string, rawPath: string, query: string) {
    const method = req.method ?? 'GET', projectId = header(req, 'x-toi-project');
    let session: SessionClaims | undefined, capability: CapabilityClaims | undefined, reason: string | undefined, status = 500, value: unknown = { error: 'INTERNAL_ERROR' }, maskedFields: string[] = [], denyReason: string | undefined;
    let pathname = rawPath;
    try {
      // Keep this ordering aligned with contracts/src/policy.ts.
      session = sessionFromHeader(header(req, 'authorization'), config.sessionSecret);
      const api = storage.apis.get(apiId); if (!api) throw new HttpError(404, 'API_NOT_FOUND');
      if (!api.policy.allowedRoles.some(role => session!.roles.includes(role))) throw new HttpError(403, 'ROLE_FORBIDDEN');
      capability = capabilityFromToken(header(req, 'x-toi-capability'), config.capabilitySecret, projectId, session.sub);
      if (header(req, 'x-toi-env') && header(req, 'x-toi-env') !== capability.env) throw new HttpError(403, 'ENV_MISMATCH');
      if (writes.has(method) && (capability.mode !== 'write' || !capability.apiIds?.includes(apiId) || !api.policy.allowWrite)) throw new HttpError(403, 'WRITE_FORBIDDEN');
      if (!writes.has(method) && !['GET', 'HEAD'].includes(method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      const rawReason = header(req, 'x-toi-reason');
      try { reason = rawReason ? decodeURIComponent(rawReason).trim() : undefined; } catch { throw new HttpError(400, 'INVALID_REASON_ENCODING'); }
      if (reason && reason.length > 500) throw new HttpError(400, 'REASON_TOO_LONG');
      if (api.policy.requireReason && (!reason || reason.length < 5)) throw new HttpError(428, 'REASON_REQUIRED');
      try { pathname = decodeURIComponent(rawPath); } catch { throw new HttpError(400, 'INVALID_PATH'); }
      if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') || pathname.split('/').some(part => ['.', '..'].includes(part)) || /[?#\u0000-\u001f]/.test(pathname)) throw new HttpError(400, 'INVALID_PATH');
      if (!allowedPath(api, pathname, method)) throw new HttpError(404, 'OPERATION_NOT_REGISTERED');
      const payload = writes.has(method) && method !== 'DELETE' ? await body(req) : undefined;
      const upstream = await fetch(`${api.upstreamBaseUrl.replace(/\/$/, '')}${pathname}${query}`, { method, headers: { 'X-Service-Token': config.upstreamToken, Accept: 'application/json', ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!upstream.ok) throw new HttpError(upstream.status >= 500 ? 502 : upstream.status, 'UPSTREAM_REJECTED');
      if (!upstream.headers.get('content-type')?.includes('application/json')) throw new HttpError(502, 'UPSTREAM_RESPONSE_INVALID');
      const masked = maskJson(await upstream.json(), api.policy.mask); maskedFields = masked.maskedFields; value = masked.value; status = upstream.status;
    } catch (error) {
      status = error instanceof HttpError ? error.status : 502;
      denyReason = error instanceof HttpError ? error.code : 'UPSTREAM_UNAVAILABLE';
      value = { error: denyReason };
    }
    const record: AuditRecord = {
      ts: new Date().toISOString(), user: session?.sub ?? 'anonymous', projectId: identifier(projectId) ? projectId : 'unknown', apiId, method, path: pathname.slice(0, 500), status,
      ...(reason ? { reason } : {}), capability: capability ? { mode: capability.mode, env: capability.env, jti: capability.jti } : { mode: 'read', env: 'preview', jti: 'unverified' }, maskedFields, decision: denyReason ? 'denied' : 'allowed', ...(denyReason ? { denyReason } : {}),
    };
    // Await durable append before responding. An audit write failure never becomes success.
    await storage.append(sanitize(record, [...secrets(), header(req, 'x-toi-capability'), header(req, 'authorization').replace(/^Bearer /, '')]));
    send(res, status, value);
  }
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
      const requested = header(req, 'access-control-request-headers').split(',').map(item => item.trim().toLowerCase()).filter(item => ['authorization', 'content-type'].includes(item) || /^x-toi-[a-z0-9-]+$/.test(item));
      res.setHeader('Access-Control-Allow-Headers', [...new Set(['Authorization', 'Content-Type', 'X-Toi-Project', 'X-Toi-Capability', 'X-Toi-Reason', 'X-Toi-Env', ...requested])].join(', '));
    }
    if (req.method === 'OPTIONS') { res.writeHead(origin && !allowedOrigins.has(origin) ? 403 : 204); res.end(); return; }
    try {
      const rawUrl = req.url ?? '/', url = new URL(rawUrl, 'http://policy.invalid');
      const proxyMatch = rawUrl.split('?')[0].match(/^\/proxy\/([^/]+)(\/.*)?$/);
      if (proxyMatch) return await proxy(req, res, proxyMatch[1], proxyMatch[2] ?? '/', url.search);
      if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { status: 'ok' });
      if (req.method === 'POST' && url.pathname === '/dev/session') {
        if (!config.devAuth) throw new HttpError(404, 'NOT_FOUND');
        const input = await body(req) as { user?: unknown; roles?: unknown };
        if (!input || !identifier(input.user) || !Array.isArray(input.roles) || !input.roles.every(role => ['viewer', 'editor', 'platform-admin'].includes(role))) throw new HttpError(400, 'INVALID_SESSION_REQUEST');
        const claims: SessionClaims = { sub: input.user, roles: [...new Set(input.roles)] as string[], exp: Math.floor(Date.now() / 1000) + 3600 };
        return send(res, 200, { token: signToken(claims, config.sessionSecret, 'session'), claims });
      }
      const session = sessionFromHeader(header(req, 'authorization'), config.sessionSecret);
      if (req.method === 'GET' && url.pathname === '/apis') return send(res, 200, [...storage.apis.values()].map(api => publicApi(api, secrets())));
      const apiMatch = url.pathname.match(/^\/apis\/([^/]+)$/);
      if (req.method === 'GET' && apiMatch) { const api = storage.apis.get(apiMatch[1]); if (!api) throw new HttpError(404, 'API_NOT_FOUND'); return send(res, 200, publicApi(api, secrets())); }
      if (req.method === 'POST' && url.pathname === '/apis') {
        if (!session.roles.includes('platform-admin')) throw new HttpError(403, 'PLATFORM_ADMIN_REQUIRED');
        const api = validateApi(await body(req), config.upstreamAllowlist); await storage.save(api); return send(res, 201, publicApi(api, secrets()));
      }
      if (req.method === 'POST' && url.pathname === '/capabilities') return send(res, 200, issueCapability(await body(req), session, config.capabilitySecret));
      if (req.method === 'GET' && url.pathname === '/audit') {
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
        const records = await storage.audit(url.searchParams.get('projectId') || undefined, limit);
        return send(res, 200, session.roles.includes('platform-admin') ? records : records.filter(record => record.user === session.sub));
      }
      throw new HttpError(404, 'NOT_FOUND');
    } catch (error) { if (!res.headersSent) send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.code : 'INTERNAL_ERROR' }); else res.destroy(); }
  });
}
