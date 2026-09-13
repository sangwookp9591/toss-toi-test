import { createHash } from 'node:crypto';
import type { VfsFiles } from '../../../contracts/src/runtime.ts';
export function normalizePath(path: string): string {
  if (!path.startsWith('/')) throw new Error(`VFS path must be absolute: ${path}`);
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return '/' + parts.join('/');
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Digest input must be JSON');
  return json;
}
export function sourceDigest(files: VfsFiles): string {
  const normalized: VfsFiles = Object.create(null);
  for (const [path, content] of Object.entries(files)) normalized[normalizePath(path)] = content;
  return createHash('sha256').update(canonicalJson(normalized)).digest('hex');
}
