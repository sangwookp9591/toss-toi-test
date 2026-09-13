import { configuration } from '../src/config.js';
import { PolicyStorage } from '../src/storage.js';
import { seedRegistry } from '../src/seed.js';
try { const config = configuration(), store = new PolicyStorage(config.dataDir); await store.init(); await seedRegistry(store, config, true); console.log('Registered customers API from authenticated OpenAPI'); }
catch { console.error('Registry seed failed; check mock-backend configuration'); process.exitCode = 1; }
