// H1/N5 regression: production config guard. configuration() must reject dev/default/short/
// duplicate secrets and any dev-auth for every non-development NODE_ENV (opt-in dev only).
process.env.TOI_MANAGED_ENV = '1'; // do not auto-load real .env
import { configuration } from '../../../../services/policy-proxy/src/config.ts';
import { randomBytes } from 'node:crypto';
const out: string[] = []; const log = (s: string) => { out.push(s); console.log(s); };
const strong = () => randomBytes(32).toString('hex');
const base = () => ({ TOI_SESSION_SECRET: strong(), TOI_CAPABILITY_SECRET: strong(), TOI_PREVIEW_SERVICE_TOKEN: strong(), TOI_LIVE_SERVICE_TOKEN: strong() });
const probe = (label: string, env: Record<string,string|undefined>) => {
  try { const c = configuration(env as any); log(`${label.padEnd(56)} -> ACCEPTED devAuth=${c.devAuth} devAdminToken=${c.devAdminToken!==undefined}`); }
  catch (e:any) { log(`${label.padEnd(56)} -> REJECTED (${e.message.slice(0,50)})`); }
};
log('# Non-development NODE_ENV values with dev/default/missing secrets (must all be REJECTED):');
for (const nodeEnv of ['production','Production','prod','staging','PRODUCTION','production ', undefined, '']) {
  probe(`NODE_ENV=${JSON.stringify(nodeEnv)} + default secret`, { NODE_ENV: nodeEnv, TOI_SESSION_SECRET:'toi-dev-session-secret-change-before-production', TOI_CAPABILITY_SECRET:'toi-dev-capability-secret-change-before-production', TOI_PREVIEW_SERVICE_TOKEN: strong(), TOI_LIVE_SERVICE_TOKEN: strong() });
}
log('\n# production hardening variants:');
probe('production + missing secrets', { NODE_ENV:'production' });
probe('production + short (<32B) secrets', { NODE_ENV:'production', TOI_SESSION_SECRET:'short', TOI_CAPABILITY_SECRET:'short2', TOI_PREVIEW_SERVICE_TOKEN:'short3', TOI_LIVE_SERVICE_TOKEN:'short4' });
{ const s = strong(); probe('production + duplicate secrets', { NODE_ENV:'production', TOI_SESSION_SECRET:s, TOI_CAPABILITY_SECRET:s, TOI_PREVIEW_SERVICE_TOKEN:strong(), TOI_LIVE_SERVICE_TOKEN:strong() }); }
probe('production + strong distinct + TOI_DEV_AUTH_ENABLED=true', { NODE_ENV:'production', ...base(), TOI_DEV_AUTH_ENABLED:'true' });
probe('production + strong distinct + TOI_DEV_ADMIN_TOKEN set', { NODE_ENV:'production', ...base(), TOI_DEV_ADMIN_TOKEN:'x' });
probe('production + strong distinct (clean)  [should ACCEPT]', { NODE_ENV:'production', ...base() });
log('\n# development / test skip the guard but dev-auth is removed entirely (devAuth always false):');
probe('development + default secrets', { NODE_ENV:'development', TOI_SESSION_SECRET:'toi-dev-session-secret-change-before-production' });
probe('test + no secrets', { NODE_ENV:'test' });
probe('development + TOI_DEV_AUTH_ENABLED=true', { NODE_ENV:'development', TOI_DEV_AUTH_ENABLED:'true', TOI_DEV_ADMIN_TOKEN:'x' });

import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./p01-config.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p01-config.out');
