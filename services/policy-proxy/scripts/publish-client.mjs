import { config } from 'dotenv';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
if (process.env.TOI_MANAGED_ENV !== '1') config({ path: path.resolve(root, '../../.env'), quiet: true });
const token = process.env.TOI_REGISTRY_TOKEN, registry = process.env.TOI_REGISTRY_URL ?? 'http://localhost:4973';
try {
  if (!token) throw new Error('Missing registry token');
  await run('npm', ['run', 'build:client'], { cwd: root });
  const existing = await fetch(`${registry}/@toi%2ffetch`, { headers: { Authorization: `Bearer ${token}` } });
  if (existing.ok && (await existing.json()).versions?.['1.1.1']) { console.log('@toi/fetch@1.1.1 already published'); process.exit(0); }
  await mkdir(path.join(root, '.cache'), { recursive: true }); const directory = await mkdtemp(path.join(root, '.cache/publish-'));
  try {
    await cp(path.join(root, 'dist/toi-fetch.js'), path.join(directory, 'index.js')); await cp(path.join(root, 'dist/toi-fetch.d.ts'), path.join(directory, 'index.d.ts'));
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: '@toi/fetch', version: '1.1.1', type: 'module', sideEffects: false, main: './index.js', types: './index.d.ts', exports: { '.': { types: './index.d.ts', import: './index.js', default: './index.js' } }, files: ['index.js', 'index.d.ts'] }));
    await writeFile(path.join(directory, '.npmrc'), `registry=${registry}\n//${new URL(registry).host}/:_authToken=\${TOI_REGISTRY_TOKEN}\n`);
    await run('npm', ['publish', '--registry', registry, '--ignore-scripts'], { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME, TOI_REGISTRY_TOKEN: token } });
    const anonymous = await fetch(`${registry}/@toi%2ffetch`); if (![401, 404].includes(anonymous.status)) throw new Error('Anonymous registry access was allowed');
    console.log('Published @toi/fetch@1.1.1; anonymous metadata is blocked');
  } finally { await rm(directory, { recursive: true, force: true }); }
} catch { console.error('Client publish failed; inspect registry availability and server-side token configuration'); process.exitCode = 1; }
