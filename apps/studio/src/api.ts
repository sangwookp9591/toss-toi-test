import type { GenerationEvent } from '../../../contracts/src/generation.ts';
export const API = { agent: 'http://localhost:7400', deps: 'http://localhost:7100', policy: 'http://localhost:7200' };
export class HttpError extends Error { constructor(readonly status: number, readonly body: any) { super(body.error ?? `HTTP ${status}`); } }
export async function json<T>(url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', token?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, signal, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new HttpError(response.status, value);
  return value as T;
}
export async function consumeGeneration(id: string, signal: AbortSignal, onEvent: (event: GenerationEvent) => void, reconnecting: () => void, initialSeq = 0) {
  let lastSeq = initialSeq;
  while (!signal.aborted) {
    try {
      const response = await fetch(`${API.agent}/generations/${id}/events`, { signal, headers: { 'Last-Event-ID': String(lastSeq) } });
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
          if (['done', 'failed', 'canceled'].includes(event.type)) { await reader.cancel(); return; }
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof HttpError && error.status === 404) throw error;
    }
    reconnecting();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
