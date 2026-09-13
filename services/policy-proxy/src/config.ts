import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const serviceRoot = fileURLToPath(new URL('../', import.meta.url));
config({ path: path.resolve(serviceRoot, '../../.env'), quiet: true });
export interface PolicyConfig { dataDir: string; upstreamUrl: string; upstreamToken: string; sessionSecret: string; capabilitySecret: string; upstreamAllowlist: string[]; devAuth: boolean }
export function configuration(): PolicyConfig {
  const upstreamUrl = process.env.TOI_CUSTOMERS_UPSTREAM ?? 'http://localhost:7300';
  return { dataDir: process.env.TOI_POLICY_DATA_DIR || path.join(serviceRoot, 'data'), upstreamUrl, upstreamToken: process.env.TOI_UPSTREAM_SERVICE_TOKEN ?? 'toi-dev-upstream-secret', sessionSecret: process.env.TOI_SESSION_SECRET ?? 'toi-dev-session-secret-change-before-production', capabilitySecret: process.env.TOI_CAPABILITY_SECRET ?? 'toi-dev-capability-secret-change-before-production', upstreamAllowlist: (process.env.TOI_UPSTREAM_ALLOWLIST ?? upstreamUrl).split(','), devAuth: process.env.TOI_DEV_AUTH_ENABLED === 'true' || (process.env.NODE_ENV !== 'production' && process.env.TOI_DEV_AUTH_ENABLED !== 'false') };
}
