import type { FrameToHostFetch, HostToFrameFetch, RevisionToken } from '../../../contracts/src/runtime.ts';
export type FetchBroker = (request: FrameToHostFetch, signal: AbortSignal) => Promise<HostToFrameFetch>;
export function brokerFailure(requestId: string, status: number, brokerError: NonNullable<HostToFrameFetch['brokerError']>): HostToFrameFetch {
  return { kind: 'toi_fetch_result', requestId, status, brokerError, contentType: 'application/json', body: JSON.stringify({ error: brokerError }) };
}
/** One lifetime per document. Invalidation also aborts upstream work and drops late replies. */
export class FrameBroker {
  private valid = true;
  private pending = new Map<string, AbortController>();
  private timestamps: number[] = [];
  constructor(private source: Window, private origin: string, private token: RevisionToken, private fetch: FetchBroker, private now = Date.now) {}
  invalidate() { this.valid = false; for (const abort of this.pending.values()) abort.abort(); this.pending.clear(); }
  async receive(event: Pick<MessageEvent, 'source' | 'origin' | 'data'>) {
    const request = event.data;
    if (!this.valid || event.source !== this.source || event.origin !== this.origin || request?.kind !== 'toi_fetch') return;
    if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128) return;
    const reply = (result: HostToFrameFetch) => { if (this.valid) this.source.postMessage(result, this.origin); };
    if (request.token?.revision !== this.token.revision || request.token?.attemptId !== this.token.attemptId) { reply(brokerFailure(request.requestId, 403, 'NOT_ALLOWED_SOURCE')); return; }
    const now = this.now(); this.timestamps = this.timestamps.filter(time => time > now - 1000);
    if (this.pending.size >= 8 || this.timestamps.length >= 50 || this.pending.has(request.requestId)) { reply(brokerFailure(request.requestId, 429, 'TOO_MANY_REQUESTS')); return; }
    this.timestamps.push(now);
    const abort = new AbortController(); this.pending.set(request.requestId, abort);
    const timeout = setTimeout(() => abort.abort(), 29000);
    try { reply(await this.fetch(request, abort.signal)); }
    catch { reply(brokerFailure(request.requestId, 502, 'UPSTREAM_UNREACHABLE')); }
    finally { clearTimeout(timeout); this.pending.delete(request.requestId); }
  }
}
