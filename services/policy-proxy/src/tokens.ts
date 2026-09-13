import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { CapabilityClaims, CapabilityRequest } from '../../../contracts/src/policy.js';
export interface SessionClaims { sub: string; roles: string[]; exp: number }
export class HttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
export const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value);
export function signToken(claims: object, secret: string, audience: 'session' | 'capability'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ ...claims, iss: 'toi-policy-proxy', aud: audience })).toString('base64url');
  const signed = `${header}.${payload}`;
  return `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`;
}
export function verifyToken(token: string, secret: string, audience: 'session' | 'capability'): Record<string, unknown> {
  if (token.length > 8192) throw new Error('Invalid token');
  const parts = token.split('.'); if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid token');
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const signature = Buffer.from(parts[2], 'base64url');
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected) || signature.toString('base64url') !== parts[2]) throw new Error('Invalid signature');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (header.alg !== 'HS256' || header.typ !== 'JWT' || claims.iss !== 'toi-policy-proxy' || claims.aud !== audience || !Number.isInteger(claims.exp) || claims.exp <= Date.now() / 1000) throw new Error('Invalid claims');
  return claims;
}
export function sessionFromHeader(header: string | undefined, secret: string): SessionClaims {
  try {
    if (!header?.startsWith('Bearer ')) throw new Error();
    const claims = verifyToken(header.slice(7), secret, 'session');
    if (!identifier(claims.sub) || !Array.isArray(claims.roles) || !claims.roles.every(identifier)) throw new Error();
    return claims as unknown as SessionClaims;
  } catch { throw new HttpError(401, 'SESSION_REQUIRED'); }
}
export function capabilityFromToken(token: string, secret: string, projectId: string, sub: string): CapabilityClaims {
  try {
    const claims = verifyToken(token, secret, 'capability');
    if (claims.sub !== sub || !identifier(claims.projectId) || claims.projectId !== projectId || !['read', 'write'].includes(String(claims.mode)) || !['preview', 'live'].includes(String(claims.env)) || typeof claims.jti !== 'string' || !claims.jti || !Number.isInteger(claims.ttlSec) || Number(claims.ttlSec) < 1 || Number(claims.ttlSec) > 3600 || (claims.apiIds !== undefined && (!Array.isArray(claims.apiIds) || !claims.apiIds.every(identifier)))) throw new Error();
    return claims as unknown as CapabilityClaims;
  } catch { throw new HttpError(403, 'CAPABILITY_INVALID'); }
}
export function issueCapability(input: unknown, session: SessionClaims, secret: string) {
  const body = (input ?? {}) as CapabilityRequest;
  const mode = body.mode ?? 'read', env = body.env ?? 'preview', ttlSec = body.ttlSec ?? 300;
  if (!identifier(body.projectId) || !['read', 'write'].includes(mode) || !['preview', 'live'].includes(env) || !Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > 3600 || (body.apiIds !== undefined && (!Array.isArray(body.apiIds) || body.apiIds.length > 100 || !body.apiIds.every(identifier)))) throw new HttpError(400, 'INVALID_CAPABILITY_REQUEST');
  if (mode === 'write' && !session.roles.includes('editor')) throw new HttpError(403, 'EDITOR_REQUIRED');
  if (mode === 'write' && !body.apiIds?.length) throw new HttpError(400, 'WRITE_API_IDS_REQUIRED');
  const claims: CapabilityClaims = { sub: session.sub, projectId: body.projectId, mode, env, ttlSec, ...(body.apiIds ? { apiIds: [...new Set(body.apiIds)] } : {}), exp: Math.min(session.exp, Math.floor(Date.now() / 1000) + ttlSec), jti: randomUUID() };
  return { token: signToken(claims, secret, 'capability'), claims };
}
