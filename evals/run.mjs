#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Keep the public command plain node while loading repository TypeScript modules.
if (!process.env.TOI_EVAL_TS_LOADER) {
  const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('../services/agent-server/node_modules/tsx/dist/loader.mjs', import.meta.url)), fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, TOI_EVAL_TS_LOADER: '1' } });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 130 : 1)));
} else {
  await (await import('./runner.mjs')).main();
}
