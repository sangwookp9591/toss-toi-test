import { auth, LoginRequired, LOGIN_MESSAGE } from './auth.ts';
import type { GenerationEvent } from '../../../contracts/src/generation.ts';
export const API = { agent: 'http://localhost:7400', deps: 'http://localhost:7100', policy: 'http://localhost:7200' };
export class HttpError extends Error { constructor(readonly status: number, readonly body: any) { super(body.error ?? `HTTP ${status}`); } }
export const ACCESS_REVOKED_MESSAGE = '이 프로젝트에 접근할 수 없어요. 멤버에서 제거되었거나 권한이 바뀌었을 수 있어요';
export function accessMessage(error: unknown, fallback: string): string {
  if (error instanceof LoginRequired || error instanceof HttpError && error.status === 401) return LOGIN_MESSAGE;
  if (error instanceof HttpError && error.status === 404) return ACCESS_REVOKED_MESSAGE;
  if (error instanceof HttpError && error.status === 403) return '이 작업을 할 권한이 없어요. 프로젝트 소유자에게 문의해 주세요.';
  if (error instanceof HttpError && error.status === 409 && /owner/i.test(JSON.stringify(error.body))) return '마지막 소유자는 제거하거나 역할을 낮출 수 없어요.';
  return fallback;
}
type Credentials = Pick<ReturnType<typeof auth>, 'token' | 'refresh' | 'invalidate'>;
export async function authenticatedFetch(url: string, init: RequestInit = {}, credentials?: Credentials, transport = fetch): Promise<Response> {
  const origin = new URL(url).origin;
  if (![API.agent, API.policy].includes(origin)) return transport(url, init);
  const identity = credentials ?? auth();
  const send = (token: string) => { const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${token}`); return transport(url, { ...init, headers, redirect: 'error' }); };
  const token = await identity.token();
  let response = await send(token);
  if (response.status === 401) {
    await response.body?.cancel();
    // Another request may already have refreshed the rejected token.
    const latest = await identity.token();
    response = await send(latest !== token ? latest : await identity.refresh());
    if (response.status === 401) { await response.body?.cancel(); await identity.invalidate(); throw new LoginRequired(); }
  }
  return response;
}
export async function json<T>(url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', _token?: string, signal?: AbortSignal): Promise<T> {
  const response = await authenticatedFetch(url, { method, signal, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new HttpError(response.status, value);
  return value as T;
}
export const isTerminal = (event: GenerationEvent) => event.type === 'done' || event.type === 'failed' || event.type === 'canceled';
export async function consumeGeneration(id: string, signal: AbortSignal, onEvent: (event: GenerationEvent) => void, reconnecting: () => void, initialSeq = 0) {
  let lastSeq = initialSeq;
  while (!signal.aborted) {
    try {
      const response = await authenticatedFetch(`${API.agent}/generations/${id}/events`, { signal, headers: lastSeq > 0 ? { 'Last-Event-ID': String(lastSeq) } : {} });
      if (!response.ok) throw new HttpError(response.status, { error: 'Generation stream unavailable' });
      const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
          if (!data) continue;
          const event: GenerationEvent = JSON.parse(data);
          if (event.generationId !== id || event.seq <= lastSeq) continue;
          if (event.seq !== lastSeq + 1) throw new Error('SSE sequence gap');
          lastSeq = event.seq;
          onEvent(event);
          if (isTerminal(event)) { await reader.cancel(); return; }
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof LoginRequired || error instanceof HttpError && [401, 403, 404].includes(error.status)) throw error;
    }
    reconnecting();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
