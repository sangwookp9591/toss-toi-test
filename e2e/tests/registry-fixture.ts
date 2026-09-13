import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export async function registryFixture() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'test/registry-fixture.ts'], {
    cwd: fileURLToPath(new URL('../../services/deps-builder/', import.meta.url)),
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const messages: Array<{ type: string; url?: string; failedRequests?: number }> = [];
  child.on('message', message => messages.push(message as typeof messages[number]));
  // Do not surface child stderr: dependency tools may print service credentials.
  child.stderr?.resume();
  const wait = async (type: string) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const message = messages.find(message => message.type === type);
      if (message) return message;
      if (child.exitCode !== null) throw new Error('Registry fixture exited before ' + type);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Registry fixture timed out: ' + type);
  };
  const close = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.send('close');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    await exited; clearTimeout(timeout);
  };
  try {
    const { url } = await wait('ready');
    return { url: url!, recover: async () => { child.send('recover'); return wait('recovered'); }, close };
  } catch (error) { await close(); throw error; }
}
