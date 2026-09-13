/** Browser-only, dependency-free ESM client. Tokens are supplied by the trusted host. */
export interface ToiFetchConfig { sessionToken: string; capabilityToken: string; projectId: string; proxyBaseUrl?: string; reason?: string; env?: 'preview' | 'live' }
export type ToiFetchInit = RequestInit & { reason?: string };
let current: ToiFetchConfig | undefined;
export function configureToiFetch(config: ToiFetchConfig): void { current = { ...config }; }
export function clearToiFetch(): void { current = undefined; }
export class ToiFetchError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'ToiFetchError'; }
}
export class ToiForbiddenError extends ToiFetchError { constructor(code = 'FORBIDDEN') { super(403, code); this.name = 'ToiForbiddenError'; } }
export class ToiReasonRequiredError extends ToiFetchError { constructor() { super(428, 'REASON_REQUIRED'); this.name = 'ToiReasonRequiredError'; } }
export async function toiFetch(apiId: string, path: string, init: ToiFetchInit = {}): Promise<Response> {
  if (!current) throw new ToiFetchError(0, 'CLIENT_NOT_CONFIGURED');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(apiId) || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('#')) throw new ToiFetchError(0, 'INVALID_API_PATH');
  const { reason = current.reason, ...options } = init;
  const base = current.proxyBaseUrl ?? 'http://localhost:7200';
  const target = new URL(`${base.replace(/\/$/, '')}/proxy/${encodeURIComponent(apiId)}${path}`);
  if (!target.pathname.startsWith(`/proxy/${apiId}/`)) throw new ToiFetchError(0, 'INVALID_API_PATH');
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${current.sessionToken}`); headers.set('X-Toi-Project', current.projectId); headers.set('X-Toi-Capability', current.capabilityToken);
  if (current.env) headers.set('X-Toi-Env', current.env);
  // Fetch Headers use byte strings; encode Korean/free-form reasons as UTF-8 percent encoding.
  if (reason) headers.set('X-Toi-Reason', encodeURIComponent(reason));
  const response = await fetch(target, { ...options, headers, redirect: 'error' });
  if (response.status === 428) throw new ToiReasonRequiredError();
  if (!response.ok) { let code = 'REQUEST_FAILED'; try { const error = await response.json(); if (typeof error.error === 'string') code = error.error; } catch { /* Generic typed error. */ } if (response.status === 403) throw new ToiForbiddenError(code); throw new ToiFetchError(response.status, code); }
  return response;
}
