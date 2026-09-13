import type { Diagnostic, VfsFiles } from '../../../contracts/src/runtime.ts';
export interface BundleRequest { id: number; files: VfsFiles; imports: Record<string, string>; entry: string; wasmUrl: string }
export type BundleResponse = { id: number; code: string; bundleMs: number } | { id: number; diagnostics: Diagnostic[] };
