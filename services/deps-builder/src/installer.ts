import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import type { PackageSetRequest } from '../../../contracts/src/package-set.js';
import { serviceRoot } from './config.js';
import { InputError, redact } from './security.js';
const require = createRequire(import.meta.url);
const yarnCli = require.resolve('@yarnpkg/cli-dist/bin/yarn.js');
export interface Installed { directory: string; lock: Buffer; cleanup: () => Promise<void> }
export async function install(request: PackageSetRequest, options: { registry: string; token: string; cacheRoot?: string }): Promise<Installed> {
  const root = options.cacheRoot ?? path.join(serviceRoot, '.cache');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'workspace-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'toi-package-set', private: true, packageManager: 'yarn@4.18.0', dependencies: request.dependencies }));
    // An empty lock marks this directory as an independent Yarn project.
    await writeFile(path.join(directory, 'yarn.lock'), '');
    const registry = new URL(options.registry);
    await writeFile(path.join(directory, '.yarnrc.yml'), `nodeLinker: node-modules\nenableGlobalCache: false\nenableMirror: false\nglobalFolder: ${JSON.stringify(path.join(root, 'yarn-global'))}\nenableScripts: false\nnpmMinimalAgeGate: 1440\nnpmPreapprovedPackages:\n  - "@toi/*"\ncacheFolder: ${JSON.stringify(path.join(root, 'yarn'))}\nunsafeHttpWhitelist:\n  - ${JSON.stringify(registry.hostname)}\nnpmRegistryServer: ${JSON.stringify(options.registry)}\nnpmScopes:\n  toi:\n    npmRegistryServer: ${JSON.stringify(options.registry)}\n    npmAlwaysAuth: true\n    npmAuthToken: "\${TOI_REGISTRY_TOKEN-}"\n`);
    await new Promise<void>((resolve, reject) => {
      // Explicit environment: no upstream API or object-store credentials reach dependencies.
      const child = spawn(process.execPath, [yarnCli, 'install'], { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, SYSTEMROOT: process.env.SYSTEMROOT, TOI_REGISTRY_TOKEN: options.token, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false', YARN_ENABLE_TELEMETRY: '0', YARN_IGNORE_PATH: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32000); };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new InputError(`Dependency installation failed: ${redact(output, [options.token])}`)); });
    });
    const installedRequire = createRequire(path.join(directory, 'package.json'));
    for (const entry of request.entries) {
      try { installedRequire.resolve(entry); } catch { throw new InputError('Public entry cannot be resolved from installed dependencies'); }
    }
    return { directory, lock: await readFile(path.join(directory, 'yarn.lock')), cleanup };
  } catch (error) { await cleanup(); throw error; }
}
