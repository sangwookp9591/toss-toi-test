import type { VfsFiles, VfsLayer } from '../../../contracts/src/runtime.ts';

export function normalizePath(path: string): string {
  if (!path.startsWith('/')) throw new Error(`VFS path must be absolute: ${path}`);
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}

export function mergeVfs(layers: Partial<Record<VfsLayer, VfsFiles>>): VfsFiles {
  const files: VfsFiles = Object.create(null);
  for (const layer of ['runtime', 'template', 'project', 'user'] as const) {
    for (const [path, source] of Object.entries(layers[layer] ?? {})) files[normalizePath(path)] = source;
  }
  return files;
}

/** Recursively sorted object keys; array order is significant. Shared digest convention. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Digest input must be JSON');
  return json;
}

export async function digestJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Input is the merged VFS, not the unmerged layers. */
export function sourceDigest(files: VfsFiles): Promise<string> {
  return digestJson(mergeVfs({ user: files }));
}

export function isAllowedExternal(specifier: string, imports: Record<string, string>): boolean {
  return Object.hasOwn(imports, specifier);
}

export function resolveVfsPath(specifier: string, importer: string, files: VfsFiles): string | undefined {
  const base = normalizePath(specifier.startsWith('/') ? specifier : importer.slice(0, importer.lastIndexOf('/') + 1) + specifier);
  const extensions = ['.tsx', '.ts', '.jsx', '.js'];
  return [base, ...extensions.map(ext => base + ext), ...extensions.map(ext => base + '/index' + ext)].find(path => Object.hasOwn(files, path));
}
