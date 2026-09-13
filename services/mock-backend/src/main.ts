import { config } from 'dotenv';
import { createMockBackend } from './server.js';
config({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true });
const token = process.env.TOI_UPSTREAM_SERVICE_TOKEN ?? 'toi-dev-upstream-secret';
if (process.env.NODE_ENV === 'production' && !process.env.TOI_UPSTREAM_SERVICE_TOKEN) throw new Error('Production requires an explicit service token');
const server = createMockBackend(token);
server.listen(7300, '127.0.0.1', () => console.log('mock-backend listening on port 7300'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
