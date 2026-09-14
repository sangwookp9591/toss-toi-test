import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AccessClaims } from '../../../contracts/src/auth.ts';
export interface IdentityOptions { issuer?: string; jwksUri?: string; clientId?: string; clientSecret?: string }
export class Identity {
  readonly issuer: string;
  private readonly jwks;
  private cached?: { token: string; until: number };
  constructor(readonly options: IdentityOptions = {}) {
    this.issuer = options.issuer ?? process.env.TOI_IDENTITY_ISSUER ?? 'http://localhost:8180/realms/toi';
    this.jwks = createRemoteJWKSet(new URL(options.jwksUri ?? `${this.issuer}/protocol/openid-connect/certs`), { timeoutDuration: 3000 });
  }
  async verify(authorization: string | undefined): Promise<AccessClaims> {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 16384) throw new Error('authentication required');
    const { payload } = await jwtVerify(authorization.slice(7), this.jwks, { issuer: this.issuer, audience: 'toi-api', algorithms: ['RS256'], requiredClaims: ['sub','exp','iat','azp','preferred_username'] });
    if (typeof payload.sub !== 'string' || typeof payload.azp !== 'string' || typeof payload.preferred_username !== 'string' || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat)) throw new Error('invalid identity');
    const roles = (payload.realm_access as { roles?: unknown })?.roles ?? [];
    const groups = payload.groups ?? [];
    if (!Array.isArray(roles) || !roles.every(r => typeof r === 'string') || !Array.isArray(groups) || !groups.every(g => typeof g === 'string')) throw new Error('invalid identity');
    return { ...payload, realm_access: { roles }, groups } as unknown as AccessClaims;
  }
  async serviceToken(): Promise<string> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.token;
    if (!this.options.clientId || !this.options.clientSecret) throw new Error('service identity is not configured');
    const response = await fetch(`${this.issuer}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.options.clientId, client_secret: this.options.clientSecret }), signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('service authentication failed');
    const value = await response.json() as { access_token: string; expires_in: number };
    if (!value.access_token || !Number.isFinite(value.expires_in)) throw new Error('invalid service token');
    this.cached = { token: value.access_token, until: Date.now() + Math.max(0, value.expires_in - 10) * 1000 };
    return value.access_token;
  }
}
export const isService = (identity: AccessClaims, clientId: string) => identity.azp === clientId && identity.preferred_username === `service-account-${clientId}`;
export const isUser = (identity: AccessClaims) => identity.azp === 'toi-studio' && !identity.preferred_username.startsWith('service-account-');
