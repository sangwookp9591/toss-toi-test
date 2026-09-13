import { configuration } from './config.js';
import { PolicyStorage } from './storage.js';
import { seedRegistry } from './seed.js';
import { createPolicyProxy } from './server.js';
try {
  if (process.env.NODE_ENV === 'production' && ['TOI_SESSION_SECRET', 'TOI_CAPABILITY_SECRET', 'TOI_UPSTREAM_SERVICE_TOKEN'].some(key => !process.env[key])) throw new Error('Production secrets are required');
  const config = configuration(), storage = new PolicyStorage(config.dataDir); await storage.init(); await seedRegistry(storage, config);
  const server = createPolicyProxy(config, storage); server.listen(7200, '127.0.0.1', () => console.log('policy-proxy listening on port 7200'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
} catch { console.error('Policy startup failed; check configuration and mock-backend availability'); process.exitCode = 1; }
