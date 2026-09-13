import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RegisteredApi, PublicApi, AuditRecord, MaskKind } from '../../../contracts/src/policy.js';
import type { PolicyWarning } from './mask.js';
export interface PolicyAuditRecord extends AuditRecord { policyWarnings?: PolicyWarning[] }
import { HttpError, identifier } from './tokens.js';
export function sanitize<T>(value: T, secrets: string[]): T {
  const clean = (item: unknown): unknown => {
    if (typeof item === 'string') {
      for (const secret of secrets.filter(Boolean)) for (const representation of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]) item = (item as string).split(representation).join('[REDACTED]');
      return item;
    }
    if (Array.isArray(item)) return item.map(clean);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [String(clean(key)), clean(child)]));
    return item;
  };
  return clean(value) as T;
}
function stripOpenapiServers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOpenapiServers);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'servers').map(([key, child]) => [key, stripOpenapiServers(child)]));
  return value;
}
export function publicApi(api: RegisteredApi, secrets: string[]): PublicApi {
  const { upstreamBaseUrl, ...safe } = api;
  // Service-token auth is internal; the public operation contract uses proxy headers instead.
  const openapi = stripOpenapiServers(safe.openapi) as Record<string, unknown>;
  delete openapi.security;
  if (openapi.components && typeof openapi.components === 'object') delete (openapi.components as Record<string, unknown>).securitySchemes;
  return sanitize({ ...safe, openapi }, [...secrets, upstreamBaseUrl, new URL(upstreamBaseUrl).host]);
}
export function validateApi(input: unknown, allowedUpstreams: string[]): RegisteredApi {
  const api = input as RegisteredApi;
  if (!api || !identifier(api.apiId) || typeof api.name !== 'string' || api.name.length > 200 || typeof api.description !== 'string' || api.description.length > 2000 || !Number.isInteger(api.schemaVersion) || api.schemaVersion < 1 || !api.openapi || typeof api.openapi !== 'object' || !String(api.openapi.openapi).startsWith('3.1.') || !api.openapi.paths || typeof api.openapi.paths !== 'object') throw new HttpError(400, 'INVALID_API');
  let url: URL; try { url = new URL(api.upstreamBaseUrl); } catch { throw new HttpError(400, 'INVALID_UPSTREAM'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !allowedUpstreams.map(value => value.replace(/\/$/, '')).includes(api.upstreamBaseUrl.replace(/\/$/, ''))) throw new HttpError(400, 'UPSTREAM_NOT_ALLOWED');
  const policy = api.policy, kinds: MaskKind[] = ['none', 'name', 'phone', 'email', 'rrn', 'account'];
  if (!policy || typeof policy.requireReason !== 'boolean' || typeof policy.allowWrite !== 'boolean' || !Array.isArray(policy.allowedRoles) || !policy.allowedRoles.every(identifier) || !policy.mask || typeof policy.mask !== 'object' || Array.isArray(policy.mask) || !Object.entries(policy.mask).every(([pointer, kind]) => pointer.startsWith('/') && !/~(?![01])/.test(pointer) && kinds.includes(kind))) throw new HttpError(400, 'INVALID_POLICY');
  return structuredClone(api);
}
export class PolicyStorage {
  readonly apis = new Map<string, RegisteredApi>();
  private registryQueue = Promise.resolve();
  private auditQueue = Promise.resolve();
  constructor(readonly directory: string) {}
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { const values = JSON.parse(await readFile(path.join(this.directory, 'apis.json'), 'utf8')) as RegisteredApi[]; for (const api of values) this.apis.set(api.apiId, api); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async save(api: RegisteredApi) {
    const operation = this.registryQueue.then(async () => {
      const next = new Map(this.apis); next.set(api.apiId, api);
      const temp = path.join(this.directory, `apis-${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify([...next.values()], null, 2), { mode: 0o600 });
      await rename(temp, path.join(this.directory, 'apis.json')); this.apis.set(api.apiId, api);
    });
    this.registryQueue = operation.catch(() => {}); return operation;
  }
  append(record: PolicyAuditRecord): Promise<void> {
    const operation = this.auditQueue.then(() => appendFile(path.join(this.directory, 'audit.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 }));
    this.auditQueue = operation.catch(() => {}); return operation;
  }
  async audit(projectId: string | undefined, limit: number, subject?: string): Promise<PolicyAuditRecord[]> {
    await this.auditQueue;
    try { const lines = (await readFile(path.join(this.directory, 'audit.jsonl'), 'utf8')).trim(); return (lines ? lines.split('\n').map(line => JSON.parse(line) as PolicyAuditRecord) : []).filter(record => (!projectId || record.projectId === projectId) && (!subject || record.user === subject)).slice(-limit); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
}
