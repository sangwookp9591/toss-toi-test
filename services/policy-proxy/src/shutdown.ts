import type { Server } from 'node:http';
import type { AuditChain } from './audit.js';
import type { Downloads } from './downloads.js';
/** Stop admission, anchor immediately, then flush again after in-flight requests drain. */
export function installShutdown(server: Server, chain: AuditChain, downloads: Pick<Downloads, 'close'>) {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    downloads.close(); chain.close();
    const immediate = chain.shutdown().catch(() => { process.exitCode = 1; });
    server.close(() => { void immediate.then(() => chain.shutdown()).then(() => process.exit(process.exitCode || 0), () => process.exit(1)); });
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
