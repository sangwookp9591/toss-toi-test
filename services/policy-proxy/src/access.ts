import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { AccessClaims, Approval, ProjectMembership, ProjectRole, PreviewSessionClaims } from '../../../contracts/src/auth.js';
import { PROJECT_ROLE_RANK } from '../../../contracts/src/auth.js';
import type { CapabilityClaims } from '../../../contracts/src/policy.ts';
import { Identity, isUser } from './identity.js';
import type { PolicyConfig } from './config.js';
import { HttpError, identifier, verifyToken, type SessionClaims } from './tokens.js';
import type { PolicyStorage } from './storage.js';
export type Actor = SessionClaims & { identity?: AccessClaims; preview?: PreviewSessionClaims };
export class Access {
  readonly identity: Identity;
  readonly approvals = new Map<string, Approval>();
  constructor(readonly config: PolicyConfig, readonly storage: PolicyStorage, identity?: Identity) {
    this.identity = identity ?? new Identity({ issuer: config.identityIssuer, clientId: 'toi-policy-proxy', clientSecret: config.policyClientSecret });
    try { for (const a of JSON.parse(readFileSync(path.join(storage.directory, 'approvals.json'), 'utf8')) as Approval[]) this.approvals.set(a.approvalId, a); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  async authenticate(header: string, allowPreview = false): Promise<Actor> {
    if (allowPreview && header.startsWith('Bearer ')) {
      try {
        const p = verifyToken(header.slice(7), this.config.sessionSecret, 'toi-preview') as unknown as PreviewSessionClaims;
        if (!identifier(p.sub) || !identifier(p.projectId) || !p.jti || JSON.stringify(p.roles) !== '["viewer"]') throw new Error();
        return { sub: p.sub, exp: p.exp, roles: ['viewer'], preview: p };
      } catch { /* A Keycloak token is checked with its separate RS256 trust root below. */ }
    }
    try {
      const identity = await this.identity.verify(header);
      return { sub: identity.sub, exp: identity.exp, roles: identity.realm_access.roles, identity };
    } catch { throw new HttpError(401, 'SESSION_REQUIRED'); }
  }
  user(actor: Actor) { if (!actor.identity || !isUser(actor.identity)) throw new HttpError(403, 'USER_IDENTITY_REQUIRED'); }
  async membership(projectId: string): Promise<ProjectMembership> {
    if (!identifier(projectId)) throw new HttpError(404, 'PROJECT_NOT_FOUND');
    try {
      // No membership cache: removal is visible on the very next request.
      const response = await fetch(`${this.config.agentUrl}/internal/projects/${encodeURIComponent(projectId)}/membership`, { headers: { Authorization: `Bearer ${await this.identity.serviceToken()}` }, signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (response.status === 404) throw new HttpError(404, 'PROJECT_NOT_FOUND');
      if (!response.ok) throw new Error();
      const value = await response.json() as ProjectMembership;
      if (value.projectId !== projectId || !Array.isArray(value.members)) throw new Error();
      return value;
    } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(503, 'MEMBERSHIP_UNAVAILABLE'); }
  }
  async member(actor: Actor, projectId: string, minimum: ProjectRole = 'viewer') {
    if (actor.preview ? actor.preview.projectId !== projectId : !actor.identity || !isUser(actor.identity)) throw new HttpError(404, 'PROJECT_NOT_FOUND');
    const membership = await this.membership(projectId);
    const member = membership.members.find(m => m.sub === actor.sub);
    if (!member) throw new HttpError(404, 'PROJECT_NOT_FOUND');
    if (!(PROJECT_ROLE_RANK[member.role] >= PROJECT_ROLE_RANK[minimum])) throw new HttpError(403, 'PROJECT_ROLE_FORBIDDEN');
    return { ...actor, roles: Object.keys(PROJECT_ROLE_RANK).filter(role => PROJECT_ROLE_RANK[role as ProjectRole] <= PROJECT_ROLE_RANK[member.role]) };
  }
  save(approval: Approval) {
    const next = new Map(this.approvals); next.set(approval.approvalId, approval);
    const file = path.join(this.storage.directory, 'approvals.json'), temp = file + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, JSON.stringify([...next.values()]), { mode: 0o600 }); renameSync(temp, file);
    this.approvals.set(approval.approvalId, approval); return approval;
  }
  current(a: Approval): Approval { return Date.parse(a.expiresAt) <= Date.now() ? { ...a, status: 'expired' } : a; }
  owns(actor: Actor, apiId: string) { return !!actor.identity && isUser(actor.identity) && actor.roles.includes('api-owner') && !!this.storage.apis.get(apiId)?.owners.includes(actor.sub); }
  approved(sub: string, projectId: string, apiId: string) {
    const approval = [...this.approvals.values()].find(a => a.requestedBy === sub && a.projectId === projectId && a.apiId === apiId && a.scope === 'live-write' && this.current(a).status === 'approved' && a.decidedBy !== sub && !!a.decidedBy && this.storage.apis.get(apiId)?.owners.includes(a.decidedBy));
    if (!approval) throw new HttpError(403, 'LIVE_APPROVAL_REQUIRED');
    return approval;
  }
  validateLive(actor: Actor, cap: CapabilityClaims, apiId?: string) {
    if (actor.preview && cap.env !== 'preview') throw new HttpError(403, 'ENV_FORBIDDEN');
    if (cap.env === 'live' && cap.mode === 'write') for (const id of apiId ? [apiId] : cap.apiIds ?? []) this.approved(actor.sub, cap.projectId, id);
  }
}
