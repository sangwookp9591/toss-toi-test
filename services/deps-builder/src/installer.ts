import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import type { PackageSetRequest } from '../../../contracts/src/package-set.js';
import { serviceRoot } from './config.js';
import { BuilderError, InputError, redact } from './security.js';
const require = createRequire(import.meta.url);
const yarnCli = require.resolve('@yarnpkg/cli-dist/bin/yarn.js');
/** Only an explicit resolution failure is an input error; unknown failures stay internal. */
export async function classifyInstallFailure(output: string, registry: string): Promise<BuilderError> {
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|timed?\s*out|timeout|(?:HTTP(?:\/\d(?:\.\d)?)?|response code|status(?: code)?)\s*[:=]?\s*5\d\d/i.test(output)) {
    return new BuilderError('registry_unavailable', 'Package registry unavailable');
  }
  // Yarn may omit the network cause or report a misleading resolution failure.
  // Verify registry health before assigning blame to the package input.
  try {
    const response = await fetch(registry.replace(/\/$/, '') + '/-/ping', { signal: AbortSignal.timeout(3000) });
    await response.body?.cancel();
    if (!response.ok) return new BuilderError('registry_unavailable', 'Package registry health check failed');
  } catch { return new BuilderError('registry_unavailable', 'Package registry health check failed'); }
  if (/YN0082|no candidates found|no matching version|couldn.t find (?:any versions|package)|package not found|(?:response code|status(?: code)?|HTTP)\s*[:=]?\s*404|404[^\n]*not found/i.test(output)) {
    return new InputError(`Dependency installation failed: ${output}`);
  }
  return new BuilderError('internal', `Dependency installation failed: ${output}`);
}
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
    await writeFile(path.join(directory, '.yarnrc.yml'), `nodeLinker: node-modules\nenableGlobalCache: false\nenableMirror: false\nglobalFolder: ${JSON.stringify(path.join(root, 'yarn-global'))}\nenableScripts: false\nhttpTimeout: 10000\nhttpRetry: 0\nnpmMinimalAgeGate: 1440\nnpmPreapprovedPackages:\n  - "@toi/*"\ncacheFolder: ${JSON.stringify(path.join(root, 'yarn'))}\nunsafeHttpWhitelist:\n  - ${JSON.stringify(registry.hostname)}\nnpmRegistryServer: ${JSON.stringify(options.registry)}\nnpmScopes:\n  toi:\n    npmRegistryServer: ${JSON.stringify(options.registry)}\n    npmAlwaysAuth: true\n    npmAuthToken: "\${TOI_REGISTRY_TOKEN-}"\n`);
    await new Promise<void>((resolve, reject) => {
      // Explicit environment: no upstream API or object-store credentials reach dependencies.
      const child = spawn(process.execPath, [yarnCli, 'install'], { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, SYSTEMROOT: process.env.SYSTEMROOT, TOI_REGISTRY_TOKEN: options.token, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false', YARN_ENABLE_TELEMETRY: '0', YARN_IGNORE_PATH: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32000); };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 120000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else void classifyInstallFailure(timedOut ? 'Installation timed out' : redact(output, [options.token]), options.registry).then(reject, reject);
      });
    });
    const installedRequire = createRequire(path.join(directory, 'package.json'));
    for (const entry of request.entries) {
      try { installedRequire.resolve(entry); } catch { throw new InputError('Public entry cannot be resolved from installed dependencies'); }
    }
    return { directory, lock: await readFile(path.join(directory, 'yarn.lock')), cleanup };
  } catch (error) { await cleanup(); throw error; }
}
