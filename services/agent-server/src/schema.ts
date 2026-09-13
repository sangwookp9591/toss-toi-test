import { z } from 'zod';
import { normalizePath } from './digest.ts';
export class HttpError extends Error {
  constructor(public status: number, message: string, public details: Record<string, unknown> = {}) { super(message); }
}
export class CanceledError extends Error {}
export class ToolError extends Error {}
export class ModelError extends Error { override name = 'ModelError'; }
export const catalog = ['react', 'react-dom', '@tanstack/react-query', '@toi/tds', '@toi/fetch', 'zod', 'date-fns'] as const;
export function packageName(entry: string) { return entry.startsWith('@') ? entry.split('/').slice(0, 2).join('/') : entry.split('/')[0]; }
export const packageSetSchema = z.object({ entries: z.array(z.string().min(1)).min(1), dependencies: z.record(z.string(), z.string().min(1)) }).superRefine((value, ctx) => {
  for (const name of Object.keys(value.dependencies)) if (!(catalog as readonly string[]).includes(name)) ctx.addIssue({ code: 'custom', message: `package not in catalog: ${name}` });
  for (const entry of value.entries) {
    const name = packageName(entry);
    if (!(catalog as readonly string[]).includes(name) || !Object.hasOwn(value.dependencies, name)) ctx.addIssue({ code: 'custom', message: `entry not in package dependencies: ${entry}` });
    if (entry.includes('..') || entry.includes('\\') || entry.includes('?') || entry.includes('#')) ctx.addIssue({ code: 'custom', message: `invalid package entry: ${entry}` });
  }
});
export function sourcePath(path: string): string {
  if (!path.startsWith('/src/') || path.includes('\\') || path.includes('\0') || path.split('/').includes('..') || normalizePath(path) !== path || path.endsWith('/')) throw new ToolError('file path must be a canonical path under /src/');
  return path;
}
export const filesSchema = z.record(z.string(), z.string()).superRefine((files, ctx) => {
  for (const path of Object.keys(files)) { try { sourcePath(path); } catch { ctx.addIssue({ code: 'custom', message: `invalid source path: ${path}` }); } }
});
export const createProjectSchema = z.object({ name: z.string().trim().min(1).max(200), apiIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/)).default([]) });
export const saveSchema = z.object({ baseRevision: z.number().int().positive(), files: filesSchema, packageSet: packageSetSchema.optional() });
export const generationSchema = z.object({ projectId: z.string().min(1), prompt: z.string().trim().min(1).max(100000), baseRevision: z.number().int().positive(), requestId: z.string().min(1).max(200) });
