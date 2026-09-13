/** Browser-only, dependency-free ESM client. Credentials stay in the studio. */
export interface ToiFetchConfig { projectId: string; transport: 'broker'; env: 'preview' | 'live'; reason?: string }
export type ToiFetchInit = RequestInit & { reason?: string };
let current: ToiFetchConfig | undefined;
export function configureToiFetch(config: ToiFetchConfig): void {
  current = config?.transport === 'broker' && !('sessionToken' in config) && !('capabilityToken' in config) ? { ...config } : undefined;
}
export function clearToiFetch(): void { current = undefined; }
export class ToiFetchError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'ToiFetchError'; }
}
export class ToiForbiddenError extends ToiFetchError { constructor(code = 'FORBIDDEN') { super(403, code); this.name = 'ToiForbiddenError'; } }
export class ToiReasonRequiredError extends ToiFetchError { constructor() { super(428, 'REASON_REQUIRED'); this.name = 'ToiReasonRequiredError'; } }
interface Bridge { parentOrigin: string; token: { revision: number; attemptId: string } }
export async function toiFetch(apiId: string, path: string, init: ToiFetchInit = {}): Promise<Response> {
  const bridge = (globalThis as typeof globalThis & { __TOI_FETCH_BRIDGE__?: Bridge }).__TOI_FETCH_BRIDGE__;
  if (!current || !bridge || parent === window) throw new ToiFetchError(0, 'CLIENT_NOT_CONFIGURED');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(apiId) || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('#')) throw new ToiFetchError(0, 'INVALID_API_PATH');
  if (!new URL('/proxy/' + apiId + path, bridge.parentOrigin).pathname.startsWith('/proxy/' + apiId + '/')) throw new ToiFetchError(0, 'INVALID_API_PATH');
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new ToiFetchError(0, 'INVALID_API_PATH');
  if (init.body != null && typeof init.body !== 'string') throw new ToiFetchError(413, 'BODY_TOO_LARGE');
  const headers = new Headers(init.headers);
  const requestId = crypto.randomUUID();
  const response = await new Promise<Response>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); init.signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    const receive = (event: MessageEvent) => {
      const result = event.data;
      if (event.source !== parent || event.origin !== bridge.parentOrigin || result?.kind !== 'toi_fetch_result' || result.requestId !== requestId) return;
      if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599 || typeof result.body !== 'string') return;
      cleanup();
      if (result.brokerError) {
        reject(result.status === 403 ? new ToiForbiddenError(result.brokerError) : new ToiFetchError(result.status, result.brokerError)); return;
      }
      try { resolve(new Response([204, 205, 304].includes(result.status) ? null : result.body, { status: result.status, headers: result.contentType ? { 'Content-Type': result.contentType } : {} })); }
      catch { reject(new ToiFetchError(0, 'REQUEST_FAILED')); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new ToiFetchError(0, 'BROKER_TIMEOUT')); }, 30000);
    window.addEventListener('message', receive);
    if (init.signal?.aborted) { abort(); return; }
    init.signal?.addEventListener('abort', abort, { once: true });
    parent.postMessage({ kind: 'toi_fetch', token: bridge.token, requestId, apiId, path, method,
      ...(headers.has('Content-Type') ? { contentType: headers.get('Content-Type') } : {}),
      ...(init.body != null ? { body: init.body } : {}), reason: init.reason ?? current!.reason }, bridge.parentOrigin);
  });
  if (response.status === 428) throw new ToiReasonRequiredError();
  if (!response.ok) { let code = 'REQUEST_FAILED'; try { const error = await response.json(); if (typeof error.error === 'string') code = error.error; } catch { /* Generic typed error. */ } if (response.status === 403) throw new ToiForbiddenError(code); throw new ToiFetchError(response.status, code); }
  return response;
}
