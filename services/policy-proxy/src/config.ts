import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const serviceRoot = fileURLToPath(new URL('../', import.meta.url));
config({ path: path.resolve(serviceRoot, '../../.env'), quiet: true });
export const knownDevelopmentSecrets = new Set([
  'toi-dev-session-secret-change-before-production', 'toi-dev-capability-secret-change-before-production',
  'dev-session-secret-change-me', 'dev-capability-secret-change-me', 'toi-dev-upstream-secret',
]);
const secretKeys = ['TOI_SESSION_SECRET', 'TOI_CAPABILITY_SECRET', 'TOI_UPSTREAM_SERVICE_TOKEN'] as const;
// Stable within one process, unpredictable across launches; never use repository defaults.
const ephemeralSecrets = Object.fromEntries(secretKeys.map(key => [key, randomBytes(32).toString('hex')]));
export interface PolicyConfig { dataDir: string; upstreamUrl: string; upstreamToken: string; sessionSecret: string; capabilitySecret: string; upstreamAllowlist: string[]; devAuth: boolean; devAdminToken?: string }
export function configuration(env: NodeJS.ProcessEnv = process.env): PolicyConfig {
  const development = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  if (!development) {
    if (secretKeys.some(key => !env[key] || Buffer.byteLength(env[key]!, 'utf8') < 32 || knownDevelopmentSecrets.has(env[key]!))) throw new Error('Production requires non-default secrets of at least 32 bytes');
    if (new Set(secretKeys.map(key => env[key])).size !== secretKeys.length) throw new Error('Production requires three distinct secrets');
    if (env.TOI_DEV_AUTH_ENABLED !== 'false') throw new Error('Production requires TOI_DEV_AUTH_ENABLED=false');
    if (env.TOI_DEV_ADMIN_TOKEN !== undefined) throw new Error('Production forbids TOI_DEV_ADMIN_TOKEN');
  }
  const secret = (key: typeof secretKeys[number]) => env[key] && !knownDevelopmentSecrets.has(env[key]!) ? env[key]! : ephemeralSecrets[key];
  const upstreamUrl = env.TOI_CUSTOMERS_UPSTREAM ?? 'http://localhost:7300';
  return { dataDir: env.TOI_POLICY_DATA_DIR || path.join(serviceRoot, 'data'), upstreamUrl, upstreamToken: secret('TOI_UPSTREAM_SERVICE_TOKEN'), sessionSecret: secret('TOI_SESSION_SECRET'), capabilitySecret: secret('TOI_CAPABILITY_SECRET'), upstreamAllowlist: (env.TOI_UPSTREAM_ALLOWLIST ?? upstreamUrl).split(','), devAuth: development && env.TOI_DEV_AUTH_ENABLED === 'true', devAdminToken: env.TOI_DEV_ADMIN_TOKEN };
}
