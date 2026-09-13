import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from 'dotenv';
import { version } from 'esbuild';
import type { BuildProfile } from '../../../contracts/src/package-set.js';
import { canonicalJson, sha256 } from './hash.js';
export const serviceRoot = fileURLToPath(new URL('../', import.meta.url));
export const repoRoot = path.resolve(serviceRoot, '../..');
config({ path: path.join(repoRoot, '.env'), quiet: true });
export const buildConfig = { revision: 1, splitting: true, format: 'esm', platform: 'browser', minify: false, sourcemap: false, facade: 'static-cjs-exports-v1', mainFields: ['browser', 'module', 'main'], lifecycleScripts: false, npmMinimalAgeGate: 1440, npmPreapprovedPackages: ['@toi/*'] };
export function defaultProfile(): BuildProfile {
  return { builder: 'esbuild', builderVersion: version, packageManager: 'yarn-berry', packageManagerVersion: '4.18.0', target: 'es2022', nodeEnv: 'production', conditions: ['browser', 'import', 'module', 'default'], configDigest: sha256(canonicalJson(buildConfig)), registryNamespace: 'verdaccio-local-v1' };
}
export function settings() {
  return { registry: process.env.TOI_REGISTRY_URL ?? 'http://localhost:4873', token: process.env.TOI_REGISTRY_TOKEN ?? '', publicUrl: process.env.DEPS_BUILDER_PUBLIC_URL ?? 'http://localhost:7100', bucket: process.env.MINIO_BUCKET ?? 'toi-dependencies', minioUrl: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000', accessKey: process.env.MINIO_ROOT_USER ?? 'toi', secretKey: process.env.MINIO_ROOT_PASSWORD ?? 'toi-local-secret' };
}
