import type { VfsFiles } from '../../../contracts/src/runtime.ts';
import { ToolError } from './schema.ts';

// A conservative textual guard, not a JavaScript sandbox or a proof of safe code.
// Computed names, aliases and dynamically assembled strings can evade this check.
const rules: Array<[string, RegExp]> = [
  ['raw fetch() is forbidden; use @toi/fetch toiFetch', /\bfetch\s*(?:\/\*[\s\S]*?\*\/\s*)?\(/],
  ['XMLHttpRequest is forbidden', /\bXMLHttpRequest\b/],
  ['WebSocket is forbidden', /\bWebSocket\b/],
  ['EventSource is forbidden', /\bEventSource\b/],
  ['navigator.sendBeacon is forbidden', /\bnavigator\s*\.\s*sendBeacon\b/],
  ['http(s) URLs are forbidden', /https?:\/\//i],
  ['/dev/session is forbidden', /\/dev\/session/],
  ['/capabilities is forbidden', /\/capabilities/],
  ['/audit is forbidden', /\/audit/],
  ['writes to __TOI_FETCH_CONFIG__ are forbidden', /\b__TOI_FETCH_CONFIG__(?:["']\s*\])?(?:\s*(?:\.\s*[\w$]+|\[[^\]\n]*\]))*\s*(?:(?:\?\?|\|\||&&|\*\*|[+\-*/%&|^]|<<|>>>?)?=(?!=|>)|\+\+|--)/],
];

export function assertSourcePolicy(files: VfsFiles): void {
  for (const [path, source] of Object.entries(files)) {
    if (!path.startsWith('/src/')) continue;
    for (const [reason, pattern] of rules) {
      if (pattern.test(source)) throw new ToolError(`${path}: ${reason}`);
    }
  }
}
