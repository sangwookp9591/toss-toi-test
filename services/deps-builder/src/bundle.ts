import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { init, parse } from 'cjs-module-lexer';
import { build } from 'esbuild';
import type { BuildProfile } from '../../../contracts/src/package-set.js';
import { InputError } from './security.js';
export interface BundleFile { path: string; body: Buffer }
// Static inspection preserves CJS named exports without executing package code in the worker.
async function cjsNames(filename: string, visited = new Set<string>()): Promise<string[]> {
  if (visited.has(filename) || !/\.[cm]?js$/.test(filename)) return [];
  visited.add(filename);
  const text = await readFile(filename, 'utf8');
  let names: string[];
  try { names = [...parse(text).exports]; } catch { return []; }
  const localRequire = createRequire(filename);
  for (const match of text.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
    try { names.push(...await cjsNames(localRequire.resolve(match[1]), visited)); } catch { /* Optional conditional module. */ }
  }
  return [...new Set(names)].filter(name => name !== 'default' && name !== '__esModule' && /^[A-Za-z_$][\w$]*$/.test(name));
}
export async function bundle(directory: string, entries: string[], profile: BuildProfile): Promise<{ files: BundleFile[]; entryPaths: Record<string, string> }> {
  await init();
  const require = createRequire(path.join(directory, 'package.json'));
  const entryPoints: Record<string, string> = {}, entryPaths: Record<string, string> = {};
  await mkdir(path.join(directory, 'facades'));
  for (const [index, entry] of entries.entries()) {
    let resolved: string;
    try { resolved = require.resolve(entry); } catch { throw new InputError('Public entry cannot be resolved from the installed dependencies'); }
    const names = await cjsNames(resolved);
    const source = `import * as ns from ${JSON.stringify(entry)}; export * from ${JSON.stringify(entry)}; const api = ns.default ?? ns; export default api;\n${names.map(name => `export const ${name} = api[${JSON.stringify(name)}] ?? ns[${JSON.stringify(name)}];`).join('\n')}`;
    const filename = path.join(directory, 'facades', `entry-${index}.js`);
    await writeFile(filename, source);
    entryPoints[`entry-${index}`] = filename;
    entryPaths[entry] = `entry-${index}.js`;
  }
  const outdir = path.join(directory, 'out');
  const output = await build({ absWorkingDir: directory, entryPoints, outdir, bundle: true, splitting: true, format: 'esm', platform: 'browser', target: profile.target, conditions: profile.conditions, mainFields: ['browser', 'module', 'main'], define: { 'process.env.NODE_ENV': JSON.stringify(profile.nodeEnv) }, chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]', write: false, metafile: true, logLevel: 'silent', minify: false });
  // Duplicated React in nested node_modules violates the singleton contract; fail closed.
  const reactRoots = new Set(Object.keys(output.metafile.inputs).filter(input => /node_modules\/react\//.test(input)).map(input => input.split(/node_modules\/react\//)[0]));
  if (reactRoots.size > 1) throw new Error('Multiple React installations in bundle graph');
  return { files: output.outputFiles.map(file => ({ path: path.relative(outdir, file.path).split(path.sep).join('/'), body: Buffer.from(file.contents) })), entryPaths };
}
