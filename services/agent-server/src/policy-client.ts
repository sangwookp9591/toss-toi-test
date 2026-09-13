import type { PublicApi } from '../../../contracts/src/policy.ts';
import { Identity } from './identity.ts';
import { ToolError } from './schema.ts';
export class PolicyClient {
  private session?: string;
  constructor(readonly origin = 'http://localhost:7200', private fetcher: typeof fetch = fetch, session?: string, identity?: Identity) { this.session = session; if (identity) this.identity = identity; }
  private readonly identity = new Identity({ clientId: 'toi-agent-server', clientSecret: process.env.TOI_AGENT_CLIENT_SECRET });
  private async sessionToken(_signal: AbortSignal) {
    return this.session ?? this.identity.serviceToken();
  }
  async get(path: string, signal: AbortSignal): Promise<PublicApi | PublicApi[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.sessionToken(signal);
      const response = await this.fetcher(this.origin + path, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (response.status === 401 && attempt === 0) { this.session = undefined; this.identity.clearServiceToken(); continue; }
      if (!response.ok) throw new ToolError(`policy registry HTTP ${response.status}`);
      return await response.json() as PublicApi | PublicApi[];
    }
    throw new ToolError('policy registry authentication failed');
  }
}
