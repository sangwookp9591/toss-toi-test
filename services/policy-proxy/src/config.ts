import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const serviceRoot = fileURLToPath(new URL('../', import.meta.url));
if (process.env.TOI_MANAGED_ENV !== '1') config({ path: path.resolve(serviceRoot, '../../.env'), quiet: true });
export const knownDevelopmentSecrets = new Set([
  'toi-dev-session-secret-change-before-production', 'toi-dev-capability-secret-change-before-production',
  'dev-session-secret-change-me', 'dev-capability-secret-change-me', 'toi-dev-upstream-secret',
]);
const secretKeys = ['TOI_SESSION_SECRET', 'TOI_CAPABILITY_SECRET', 'TOI_PREVIEW_SERVICE_TOKEN', 'TOI_LIVE_SERVICE_TOKEN'] as const;
// Stable within one process, unpredictable across launches; never use repository defaults.
const ephemeralSecrets = Object.fromEntries(secretKeys.map(key => [key, randomBytes(32).toString('hex')]));
export interface DownloadConfig { kek: string; kekId: string; urlSecret: string; retainMs: number }
export interface PolicyConfig { auditRetentionDays: number; downloads?: DownloadConfig; minio?: { endpoint: string; accessKey: string; secretKey: string; downloadBucket: string; auditBucket: string }; dataDir: string; upstreamUrl: string; upstreamToken: string; sessionSecret: string; capabilitySecret: string; upstreamAllowlist: string[]; devAuth: boolean; devAdminToken?: string; liveToken: string; identityIssuer: string; policyClientSecret?: string; agentUrl: string; apiOwners: string[]; approvalTtlSec: number; upstreamMaxBytes: number }
export function configuration(env: NodeJS.ProcessEnv = process.env): PolicyConfig {
  const development = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  if (!development) {
    if (secretKeys.some(key => !env[key] || Buffer.byteLength(env[key]!, 'utf8') < 32 || knownDevelopmentSecrets.has(env[key]!))) throw new Error('Production requires non-default secrets of at least 32 bytes');
    if (new Set(secretKeys.map(key => env[key])).size !== secretKeys.length) throw new Error('Production requires distinct secrets');
    if (env.TOI_DEV_AUTH_ENABLED === 'true') throw new Error('Production requires TOI_DEV_AUTH_ENABLED=false');
    if (env.TOI_DEV_ADMIN_TOKEN !== undefined) throw new Error('Production forbids TOI_DEV_ADMIN_TOKEN');
  }
  const secret = (key: typeof secretKeys[number]) => env[key] && !knownDevelopmentSecrets.has(env[key]!) ? env[key]! : ephemeralSecrets[key];
  const upstreamUrl = env.TOI_CUSTOMERS_UPSTREAM ?? 'http://localhost:7300';
  const downloads = env.TOI_DOWNLOAD_KEK || env.TOI_DOWNLOAD_URL_SECRET ? {
    kek: env.TOI_DOWNLOAD_KEK ?? '', kekId: env.TOI_DOWNLOAD_KEK_ID ?? '', urlSecret: env.TOI_DOWNLOAD_URL_SECRET ?? '', retainMs: Math.min(86400000, Math.max(1000, Number(env.TOI_DOWNLOAD_RETAIN_MS) || 86400000)),
  } : undefined;
  if (downloads && (!/^[a-f0-9]{64}$/i.test(downloads.kek) || !/^[a-f0-9]{64}$/i.test(downloads.urlSecret) || !/^[a-zA-Z0-9_-]{1,80}$/.test(downloads.kekId) || downloads.kek === downloads.urlSecret)) throw new Error('Invalid download key configuration');
  const auditRetentionDays = Number(env.TOI_AUDIT_RETENTION_DAYS ?? 1);
  if (!Number.isInteger(auditRetentionDays) || auditRetentionDays < 1 || auditRetentionDays > 36500) throw new Error('Invalid audit retention days');
  const upstreamMaxBytes = Number(env.POLICY_MAX_UPSTREAM_BYTES ?? 5 * 1024 * 1024);
  if (!Number.isSafeInteger(upstreamMaxBytes) || upstreamMaxBytes < 1) throw new Error('Invalid POLICY_MAX_UPSTREAM_BYTES');
  const minio = env.MINIO_ROOT_USER && env.MINIO_ROOT_PASSWORD ? { endpoint: env.MINIO_ENDPOINT ?? 'http://localhost:9000', accessKey: env.MINIO_ROOT_USER, secretKey: env.MINIO_ROOT_PASSWORD, downloadBucket: env.TOI_DOWNLOAD_BUCKET ?? 'toi-downloads', auditBucket: env.TOI_AUDIT_BUCKET ?? 'toi-audit' } : undefined;
  return { auditRetentionDays, downloads, minio, dataDir: env.TOI_POLICY_DATA_DIR || path.join(serviceRoot, 'data'), upstreamUrl, upstreamToken: secret('TOI_PREVIEW_SERVICE_TOKEN'), liveToken: secret('TOI_LIVE_SERVICE_TOKEN'), identityIssuer: env.TOI_IDENTITY_ISSUER ?? 'http://localhost:8080/realms/toi', policyClientSecret: env.TOI_POLICY_CLIENT_SECRET, agentUrl: env.TOI_AGENT_URL ?? 'http://localhost:7400', apiOwners: env.TOI_SUB_DANA ? [env.TOI_SUB_DANA] : [], approvalTtlSec: Math.min(3600, Math.max(1, Number(env.TOI_APPROVAL_TTL_SEC) || 300)), upstreamMaxBytes, sessionSecret: secret('TOI_SESSION_SECRET'), capabilitySecret: secret('TOI_CAPABILITY_SECRET'), upstreamAllowlist: (env.TOI_UPSTREAM_ALLOWLIST ?? `${upstreamUrl}/preview,${upstreamUrl}/live`).split(','), devAuth: false, devAdminToken: env.TOI_DEV_ADMIN_TOKEN };
}
