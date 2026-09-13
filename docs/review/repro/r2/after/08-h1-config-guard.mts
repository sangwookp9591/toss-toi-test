// R2-H1: 운영 가드 우회 시도. configuration(env)에 명시적 env 객체만 넘긴다(실제 서비스 기동 없음, 비밀값 출력 없음).
// 실행(루트): node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/r2/after/08-h1-config-guard.mts
import { configuration, knownDevelopmentSecrets } from '../../../../../services/policy-proxy/src/config.ts';
const strong = (c: string) => c.repeat(40);
const good = { TOI_SESSION_SECRET: strong('s'), TOI_CAPABILITY_SECRET: strong('c'), TOI_UPSTREAM_SERVICE_TOKEN: strong('u'), TOI_DEV_AUTH_ENABLED: 'false' };
const cases: [string, Record<string, string>][] = [
  ['production + 유효 설정(기준)', { NODE_ENV: 'production', ...good }],
  ['production + 과거 저장소 기본 시크릿', { NODE_ENV: 'production', ...good, TOI_SESSION_SECRET: [...knownDevelopmentSecrets][0] }],
  ['production + TOI_DEV_AUTH_ENABLED 미설정', { NODE_ENV: 'production', ...good, TOI_DEV_AUTH_ENABLED: undefined as any }],
  ['production + TOI_DEV_ADMIN_TOKEN=""', { NODE_ENV: 'production', ...good, TOI_DEV_ADMIN_TOKEN: '' }],
  ['production + 세 시크릿 동일 값', { NODE_ENV: 'production', ...good, TOI_CAPABILITY_SECRET: strong('s'), TOI_UPSTREAM_SERVICE_TOKEN: strong('s') }],
  ['production + 저엔트로피 32바이트 "a"x32', { NODE_ENV: 'production', ...good, TOI_SESSION_SECRET: 'a'.repeat(32) }],
  ['production + TOI_DEV_AUTH_ENABLED=FALSE(대문자)', { NODE_ENV: 'production', ...good, TOI_DEV_AUTH_ENABLED: 'FALSE' }],
  ['NODE_ENV=Production (대문자 P)', { NODE_ENV: 'Production', ...good, TOI_DEV_AUTH_ENABLED: 'true', TOI_DEV_ADMIN_TOKEN: 'x' }],
  ['NODE_ENV=prod', { NODE_ENV: 'prod', ...good, TOI_DEV_AUTH_ENABLED: 'true' }],
  ['NODE_ENV="production " (공백)', { NODE_ENV: 'production ', TOI_DEV_AUTH_ENABLED: 'true' }],
  ['NODE_ENV=staging, 시크릿 없음', { NODE_ENV: 'staging' }],
  ['NODE_ENV 미설정, 시크릿 없음 (단독 기동)', {}],
];
for (const [label, env] of cases) {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
  try {
    const c = configuration(clean as NodeJS.ProcessEnv);
    const a = configuration(clean as NodeJS.ProcessEnv);
    console.log('%s', label.padEnd(44), 'ACCEPTED', JSON.stringify({ devAuth: c.devAuth, devAdminToken: c.devAdminToken !== undefined, sessionFromEnv: c.sessionSecret === clean.TOI_SESSION_SECRET, ephemeralStableInProcess: a.sessionSecret === c.sessionSecret }));
  } catch (e) { console.log('%s', label.padEnd(44), 'REJECTED', (e as Error).message); }
}
