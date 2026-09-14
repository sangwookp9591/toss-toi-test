import { validRange } from 'semver';
import type { PackageSetRequest, PackageSetFailureCode } from '../../../contracts/src/package-set.js';
export class BuilderError extends Error {
  constructor(readonly code: PackageSetFailureCode, message: string) { super(message); }
}
export class InputError extends BuilderError {
  constructor(message: string) { super('input', message); }
}
/** HTTP status and public message per failure code; adding a code without an entry fails to compile. */
export const FAILURE_RESPONSES = {
  input: { status: 400, error: 'Invalid or unresolvable package set' },
  registry_unavailable: { status: 503, error: 'Package registry unavailable' },
  storage_unavailable: { status: 503, error: 'Artifact storage unavailable' },
  internal: { status: 500, error: 'Internal builder error' },
} satisfies Record<PackageSetFailureCode, { status: number; error: string }>;
export function failureCode(error: unknown): PackageSetFailureCode {
  return error instanceof BuilderError ? error.code : 'internal';
}
export async function storageOperation<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = 10000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  let timedOut = false;
  try {
    const pending = operation(controller.signal);
    pending.then(value => {
      if (timedOut && typeof (value as { destroy?: () => void })?.destroy === 'function') (value as { destroy: () => void }).destroy();
    }, () => undefined);
    return await Promise.race([pending, new Promise<T>((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new BuilderError('storage_unavailable', 'Artifact storage unavailable')); }, timeoutMs); })]);
  }
  catch { throw new BuilderError('storage_unavailable', 'Artifact storage unavailable'); }
  finally { if (timer) clearTimeout(timer); }
}
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
