import type { FrameToHostFetch, HostToFrameFetch } from '../../../contracts/src/runtime.ts';
import type { PreviewSession } from '../../../contracts/src/auth.ts';
import { brokerFailure } from '../../../packages/preview-runtime/src/broker.ts';
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export function validateBrokerRequest(request: FrameToHostFetch, apiIds: readonly string[], writeAllowed: boolean): HostToFrameFetch | undefined {
  const fail = (status: number, code: NonNullable<HostToFrameFetch['brokerError']>) => brokerFailure(request.requestId, status, code);
  if (typeof request.apiId !== 'string' || !apiIds.includes(request.apiId)) return fail(403, 'API_NOT_IN_PROJECT');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(request.apiId) || typeof request.path !== 'string' || !request.path.startsWith('/') || request.path.startsWith('//') || /[\\#\x00-\x20\x7f]/.test(request.path)) return fail(400, 'INVALID_API_PATH');
  try { if (!new URL('/proxy/' + request.apiId + request.path, 'http://broker.invalid').pathname.startsWith('/proxy/' + request.apiId + '/')) return fail(400, 'INVALID_API_PATH'); } catch { return fail(400, 'INVALID_API_PATH'); }
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return fail(400, 'INVALID_API_PATH');
  if (request.method !== 'GET' && !writeAllowed) return fail(403, 'WRITE_NOT_ALLOWED');
  if (request.body !== undefined && (typeof request.body !== 'string' || bytes(request.body) > 1024 * 1024)) return fail(413, 'BODY_TOO_LARGE');
  if (request.contentType !== undefined && (typeof request.contentType !== 'string' || request.contentType.length > 1024 || /[^\x20-\x7e]/.test(request.contentType))) return fail(400, 'INVALID_API_PATH');
  if (request.reason !== undefined && (typeof request.reason !== 'string' || bytes(request.reason) > 8192)) return fail(400, 'INVALID_API_PATH');
}
export async function proxyBrokerRequest(request: FrameToHostFetch, session: PreviewSession, proxyBaseUrl: string, signal: AbortSignal, network = fetch): Promise<HostToFrameFetch> {
  const headers = new Headers({ Authorization: 'Bearer ' + session.sessionToken, 'X-Toi-Project': session.sessionClaims.projectId, 'X-Toi-Capability': session.capabilityToken, 'X-Toi-Env': session.capability.env });
  if (request.contentType) headers.set('Content-Type', request.contentType);
  if (request.reason) headers.set('X-Toi-Reason', encodeURIComponent(request.reason));
  try {
    const response = await network(proxyBaseUrl + '/proxy/' + request.apiId + request.path, { method: request.method, headers, ...(request.method !== 'GET' && request.body !== undefined ? { body: request.body } : {}), redirect: 'error', signal });
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 5 * 1024 * 1024) { await reader.cancel(); return brokerFailure(request.requestId, 413, 'RESPONSE_TOO_LARGE'); }
        chunks.push(part.value);
      } } finally { reader.releaseLock(); }
    }
    const body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return { kind: 'toi_fetch_result', requestId: request.requestId, status: response.status, contentType: response.headers.get('Content-Type') ?? undefined, body: new TextDecoder().decode(body) };
  } catch { return brokerFailure(request.requestId, 502, 'UPSTREAM_UNREACHABLE'); }
}
