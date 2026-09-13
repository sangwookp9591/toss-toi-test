import { installShutdown } from './shutdown.js';
import { configuration } from './config.js';
import { PolicyStorage } from './storage.js';
import { seedRegistry } from './seed.js';
import { createPolicyProxy } from './server.js';
import { S3Objects } from './objects.js';
import { Downloads } from './downloads.js';
import path from 'node:path';
try {
  const config = configuration();
  if (!config.minio || !config.downloads) throw new Error('Download and object storage configuration required');
  const m = config.minio;
  const storage = new PolicyStorage(config.dataDir, new S3Objects(m.endpoint, m.accessKey, m.secretKey, m.auditBucket, config.auditRetentionDays));
  await storage.init();
  if (storage.chain.health.ok) await seedRegistry(storage, config);
  const downloads = new Downloads(path.join(config.dataDir, 'downloads'), new S3Objects(m.endpoint, m.accessKey, m.secretKey, m.downloadBucket), config.downloads);
  await downloads.init();
  const server = createPolicyProxy(config, storage, undefined, downloads); server.listen(7200, '127.0.0.1', () => console.log('policy-proxy listening on port 7200'));
  installShutdown(server, storage.chain, downloads);
} catch { console.error('Policy startup failed; check configuration and mock-backend availability'); process.exitCode = 1; }
