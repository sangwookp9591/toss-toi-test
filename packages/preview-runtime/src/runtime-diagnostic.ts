import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type { Diagnostic, FrameToParent } from '../../../contracts/src/runtime.ts';
import { VFS_NAMESPACE, stripVfsNamespace } from './vfs.ts';

// Private transport extension; public runtime events still expose only Diagnostic.
export type RuntimeFrameMessage = FrameToParent & { stack?: string };
export interface BundleSource {
  url: string;
  map: string;
  files: ReadonlySet<string>;
}

export function runtimeDiagnostic(message: string, stack: unknown, bundle: BundleSource): Diagnostic {
  const diagnostic = { message };
  if (typeof stack !== 'string') return diagnostic;
  try {
    // Decode only on failure. Neither sources nor maps are fetched by this mapper.
    let map: TraceMap | undefined;
    for (const frame of stack.split('\n').slice(1)) {
      // V8/Chrome and Firefox/WebKit stacks; exact URL avoids attributing an
      // external module, another candidate, or a data URL to this revision.
      const position = frame.match(/(?:\(|@|\s)([^\s()]+):(\d+):(\d+)\)?\s*$/);
      if (!position || position[1] !== bundle.url) continue;
      const line = Number(position[2]);
      const column = Number(position[3]) - 1;
      if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 0) continue;
      map ??= new TraceMap(bundle.map);
      const original = originalPositionFor(map, { line, column });
      if (!original.source?.startsWith(`${VFS_NAMESPACE}:/`) || original.line === null || original.column === null) continue;
      const file = stripVfsNamespace(original.source);
      if (!bundle.files.has(file)) continue;
      // Match esbuild diagnostics: one-based lines, zero-based columns.
      return { message, file, line: original.line, column: original.column };
    }
  } catch { /* An absent/invalid map must never hide the original error. */ }
  return diagnostic;
}
