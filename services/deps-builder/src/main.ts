import { createApp } from './server.js';
import { PackageBuilder } from './builder.js';
import { MinioStore } from './store.js';
import { safeLogger } from './security.js';
import { settings, storageTimeouts } from './config.js';
const log = safeLogger([settings().token, settings().secretKey]);
try {
  storageTimeouts();
  const store = new MinioStore(); await store.init();
  const builder = new PackageBuilder(store);
  const server = createApp(builder);
  server.listen(7100, '0.0.0.0', () => console.log('deps-builder listening on http://localhost:7100'));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(async () => { await Promise.all(builder.builds.values()); process.exit(0); }); });
} catch (error) { log(error); process.exitCode = 1; }
