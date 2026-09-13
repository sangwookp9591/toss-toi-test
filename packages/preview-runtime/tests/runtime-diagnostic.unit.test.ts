import { expect, it } from 'vitest';
import { transform } from 'esbuild';
import { runtimeDiagnostic, type BundleSource } from '../src/runtime-diagnostic.ts';

const url = 'https://studio.test/__toi_preview__/attempt-a.js';
const bundle: BundleSource = {
  url, files: new Set(['/src/App.tsx']),
  // First line is generated-only; the second maps to App line 5, column 2.
  map: JSON.stringify({ version: 3, sources: ['vfs:/src/App.tsx'], names: [], mappings: 'A;AAIE' }),
};

it('skips external and generated-only frames and returns the nearest VFS frame', () => {
  expect(runtimeDiagnostic('x', `Error: x\n    at react (https://esm.sh/react.js:2:8)\n    at helper (${url}:1:1)\n    at App (${url}:2:1)`, bundle))
    .toEqual({ message: 'x', file: '/src/App.tsx', line: 5, column: 2 });
});

it('accepts Firefox/WebKit frame syntax and exact source URL only', () => {
  expect(runtimeDiagnostic('x', `Error: x\nApp@${url}:2:1`, bundle))
    .toEqual({ message: 'x', file: '/src/App.tsx', line: 5, column: 2 });
});

it.each([
  undefined,
  'Error: x',
  'Error: x\n    at external (https://esm.sh/react.js:2:1)',
  `Error: x\n    at wrong (${url.replace('attempt-a', 'attempt-b')}:2:1)`,
  `Error: x\n    at suffix (https://evil.test/${url}:2:1)`,
  `Error: x\n    at invalid (${url}:0:0)`,
  `Error: x\n    at beyond (${url}:999:1)`,
])('does not guess a location for %s', stack => {
  expect(runtimeDiagnostic('x', stack, bundle)).toEqual({ message: 'x' });
});

it('does not attribute map sources outside the actual VFS', () => {
  expect(runtimeDiagnostic('x', `Error: x\n    at App (${url}:2:1)`, { ...bundle, files: new Set() })).toEqual({ message: 'x' });
  expect(runtimeDiagnostic('x', `Error: x\n    at App (${url}:2:1)`, { ...bundle, map: bundle.map.replace('vfs:/src/App.tsx', 'https://esm.sh/react.js') })).toEqual({ message: 'x' });
});

it('preserves the message when a map is absent or corrupt', () => {
  expect(runtimeDiagnostic('x', `Error: x\n    at App (${url}:2:1)`, { ...bundle, map: 'invalid' })).toEqual({ message: 'x' });
});

it('traces an actual esbuild map after blank lines, comments and TS erasure', async () => {
  const result = await transform('\n// comment\n/* comment */\nconst count: number = 1;\nthrow new Error("x");', { loader: 'tsx', sourcefile: 'vfs:/src/App.tsx', sourcemap: 'external', sourcesContent: false });
  const lines = result.code.split('\n');
  const generatedLine = lines.findIndex(line => line.includes('throw'));
  const generatedColumn = lines[generatedLine].indexOf('new Error');
  expect(runtimeDiagnostic('x', `Error: x\n    at ${url}:${generatedLine + 1}:${generatedColumn + 1}`, { ...bundle, map: result.map }))
    .toEqual({ message: 'x', file: '/src/App.tsx', line: 5, column: 6 });
  expect(JSON.parse(result.map)).not.toHaveProperty('sourcesContent');
});
