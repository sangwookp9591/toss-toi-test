import type { PublicApi } from '../../../contracts/src/policy.ts';
import { ToolError } from './schema.ts';
export class PolicyClient {
  private session?: string;
  constructor(readonly origin = 'http://localhost:7200', private fetcher: typeof fetch = fetch, session?: string) { this.session = session; }
  private async sessionToken(signal: AbortSignal) {
    if (!this.session) {
      const response = await this.fetcher(this.origin + '/dev/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'agent-server', roles: ['viewer'] }), signal });
      if (!response.ok) throw new ToolError(`policy session HTTP ${response.status}`);
      const value = await response.json() as { token: string };
      if (!value.token) throw new ToolError('policy session response missing token');
      this.session = value.token;
    }
    return this.session;
  }
  async get(path: string, signal: AbortSignal): Promise<PublicApi | PublicApi[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.sessionToken(signal);
      const response = await this.fetcher(this.origin + path, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (response.status === 401 && attempt === 0) { this.session = undefined; continue; }
      if (!response.ok) throw new ToolError(`policy registry HTTP ${response.status}`);
      return await response.json() as PublicApi | PublicApi[];
    }
    throw new ToolError('policy registry authentication failed');
  }
}
