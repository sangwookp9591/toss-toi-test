import { readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeArguments, repositoryRoot } from './compose.mjs';
import { commandEnvironment } from './service-env.mjs';
import { redact } from './dev-diagnostics.mjs';

export function devDownArguments(options = [], env = process.env) {
  if (options.some(option => option !== '--volumes')) throw new Error('Usage: node scripts/dev-down.mjs [--volumes]');
  return composeArguments(['down', ...(options.includes('--volumes') ? ['--volumes'] : [])], env);
}
async function main() {
  try { process.loadEnvFile(path.join(repositoryRoot, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const args = devDownArguments(process.argv.slice(2));
  const file = new URL('.run/processes.json', import.meta.url);
  let managed = []; try { managed = JSON.parse(await readFile(file, 'utf8')); } catch {}
  for (const { name, pid } of managed.reverse()) {
    try { process.kill(-pid, 'SIGTERM'); console.log(`Stopped ${name}`); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await rm(file, { force: true });
  await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: repositoryRoot, env: commandEnvironment('docker'), stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => console.log(redact(line)));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Docker exited ${code}`)));
  });
  console.log('Managed processes stopped; externally started services are left running.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
}
