import { validRange } from 'semver';
import type { PackageSetRequest } from '../../../contracts/src/package-set.js';
export class InputError extends Error {}
export function redact(value: unknown, secrets: string[]): string {
  let result = value instanceof Error ? value.message : String(value);
  for (const secret of secrets.filter(Boolean)) {
    for (const representation of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]) result = result.split(representation).join('[REDACTED]');
  }
  return result.replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]').replace(/((?:npmAuthToken|_authToken|TOI_REGISTRY_TOKEN)["']?\s*[:=]\s*)[^\s,"']+/gi, '$1[REDACTED]');
}
export function safeLogger(secrets: string[], sink: (line: string) => void = console.error) {
  return (message: unknown) => sink(redact(message, secrets));
}
const namePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export function validateRequest(value: unknown): PackageSetRequest {
  if (!value || typeof value !== 'object') throw new InputError('Expected a package set object');
  const { entries, dependencies } = value as PackageSetRequest;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 64 || !dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw new InputError('entries and dependencies are required');
  if (Object.keys(dependencies).length > 64) throw new InputError('Too many dependencies');
  for (const [name, version] of Object.entries(dependencies)) if (!namePattern.test(name) || typeof version !== 'string' || version.length > 100 || !validRange(version)) throw new InputError('Only npm package names and semver ranges are supported');
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.length > 200 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*)*$/.test(entry)) throw new InputError('Invalid public entry');
    const packageName = entry.startsWith('@') ? entry.split('/').slice(0, 2).join('/') : entry.split('/')[0];
    if (!Object.hasOwn(dependencies, packageName)) throw new InputError('Every entry must be declared in dependencies');
  }
  return { entries: [...new Set(entries)].sort(), dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))) };
}
