import { config } from 'dotenv';
import { createMockBackend } from './server.js';
config({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true });
const preview = process.env.TOI_PREVIEW_SERVICE_TOKEN, live = process.env.TOI_LIVE_SERVICE_TOKEN;
if (!preview || !live || preview === live) throw new Error('Distinct preview/live service tokens required');
const server = createMockBackend(preview, live);
server.listen(7300, '127.0.0.1', () => console.log('mock-backend listening on port 7300'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
