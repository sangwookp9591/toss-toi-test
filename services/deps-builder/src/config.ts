import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from 'dotenv';
import { version } from 'esbuild';
import type { BuildProfile } from '../../../contracts/src/package-set.js';
import { canonicalJson, sha256 } from './hash.js';
export const serviceRoot = fileURLToPath(new URL('../', import.meta.url));
export const repoRoot = path.resolve(serviceRoot, '../..');
if (process.env.TOI_MANAGED_ENV !== '1') config({ path: path.join(repoRoot, '.env'), quiet: true });
export const buildConfig = { revision: 1, splitting: true, format: 'esm', platform: 'browser', minify: false, sourcemap: false, facade: 'static-cjs-exports-v1', mainFields: ['browser', 'module', 'main'], lifecycleScripts: false, npmMinimalAgeGate: 1440, npmPreapprovedPackages: ['@toi/*'] };
export function defaultProfile(): BuildProfile {
  return { builder: 'esbuild', builderVersion: version, packageManager: 'yarn-berry', packageManagerVersion: '4.18.0', target: 'es2022', nodeEnv: 'production', conditions: ['browser', 'import', 'module', 'default'], configDigest: sha256(canonicalJson(buildConfig)), registryNamespace: 'verdaccio-local-v1' };
}
export function settings() {
  return { registry: process.env.TOI_REGISTRY_URL ?? 'http://localhost:4873', token: process.env.TOI_REGISTRY_TOKEN ?? '', publicUrl: process.env.DEPS_BUILDER_PUBLIC_URL ?? 'http://localhost:7100', bucket: process.env.MINIO_BUCKET ?? 'toi-dependencies', minioUrl: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000', accessKey: process.env.MINIO_ROOT_USER ?? 'toi', secretKey: process.env.MINIO_ROOT_PASSWORD ?? 'toi-local-secret' };
}
function timeout(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('Storage timeout must be an integer from 1 to 2147483647');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2147483647) throw new Error('Storage timeout must be an integer from 1 to 2147483647');
  return parsed;
}
export function storageTimeouts() {
  return { get: timeout(process.env.DEPS_BUILDER_STORAGE_GET_TIMEOUT_MS, 10000), put: timeout(process.env.DEPS_BUILDER_STORAGE_PUT_TIMEOUT_MS, 60000) };
}
