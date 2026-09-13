import { createHash } from 'node:crypto';
import type { BuildProfile } from '../../../contracts/src/package-set.js';
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function hashes(entries: string[], lock: Uint8Array | string, buildProfile: BuildProfile) {
  const sorted = [...entries].sort(), lockfileSha256 = sha256(lock);
  return {
    lockfileSha256,
    tossPackageSetHash: sha256(JSON.stringify({ entries: sorted, lockfileHash: lockfileSha256 })).slice(0, 16),
    artifactKey: sha256(canonicalJson({ entries: sorted, lockfileSha256, buildProfile })),
  };
}
