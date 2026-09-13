// After N1 fix; derived from the preserved original repro.
// R2-신규: 프리뷰 origin(5174, 실제 프리뷰와 같은 sandbox 플래그)의 코드가 agent-server(:7400)에
// preflight 없는 단순 요청(no-cors, text/plain)으로 생성 작업을 시작해 프로젝트 소스를 바꿀 수 있는지 확인한다.
// 격리: 이 스크립트가 새로 만든 프로젝트만 대상으로 한다(agentMode=mock). 실행: node docs/review/repro/r2/after/07-preview-to-agent-csrf.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
const require = createRequire(new URL('../../../../../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const A = 'http://localhost:7400';
const health = await (await fetch(A + '/healthz')).json();
const created = await (await fetch(A + '/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'r2-csrf-probe', apiIds: ['customers'] }) })).json();
assert.equal(health.agentMode, 'mock', 'probe must run in mock mode');
const before = await (await fetch(`${A}/projects/${created.projectId}`)).json();
console.log('agentMode=' + health.agentMode, 'probe project revision before =', before.revision, 'files=', Object.keys(before.files).join(','));

const storage = new URL('../../../../../services/agent-server/data/', import.meta.url);
const snapshot = () => ['projects', 'generations'].flatMap(kind => {
  const dir = new URL(kind + '/', storage);
  return readdirSync(dir).sort().map(name => {
    const file = new URL(name, dir);
    return { file: kind + '/' + name, content: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs };
  });
});
const storageBefore = snapshot();
const browser = await chromium.launch({ channel: 'chrome' });
console.log('browser = Google Chrome ' + browser.version());
const page = await browser.newPage();
const responses = [];
page.on('response', response => {
  if (response.url().startsWith(A)) responses.push({ method: response.request().method(), url: response.url(), status: response.status() });
});
await page.goto('http://localhost:5173/healthz');
await page.evaluate(() => new Promise(resolve => { const f = document.createElement('iframe'); f.sandbox.add('allow-scripts', 'allow-same-origin'); f.src = 'http://localhost:5174/healthz'; f.onload = resolve; document.body.append(f); }));
const frame = page.frames().find(f => f.url().startsWith('http://localhost:5174'));
const requestId = 'r2-csrf-' + Date.now();
const result = await frame.evaluate(async ({ A, projectId, revision, requestId }) => {
  const out = {};
  // 1) Opaque 응답만으로는 차단을 알 수 없으므로 아래에서 디스크 무변화를 확인한다.
  const r = await fetch(A + '/generations', { method: 'POST', mode: 'no-cors', body: JSON.stringify({ projectId, prompt: '고객 목록 화면 만들어줘', baseRevision: revision, requestId }) });
  out.generationPost = r.type + ' ' + r.status;
  // 2) CORS 모드로 응답을 읽으려는 시도 (ACAO 없음 → 차단 기대)
  try { await fetch(A + '/projects/' + projectId); out.corsRead = 'readable?!'; } catch { out.corsRead = 'blocked (no ACAO for 5174)'; }
  return out;
}, { A, projectId: created.projectId, revision: before.revision, requestId });
console.log('preview →', JSON.stringify(result));
console.log('Chrome network responses →', JSON.stringify(responses));
await browser.close();
let after = before;
for (let i = 0; i < 40 && after.revision === before.revision; i++) { await new Promise(r => setTimeout(r, 250)); after = await (await fetch(`${A}/projects/${created.projectId}`)).json(); }
console.log('probe project revision after =', after.revision, '| source changed =', JSON.stringify(before.files) !== JSON.stringify(after.files), '| files=', Object.keys(after.files).join(','));
// agent-server 데이터 디렉터리에서 프리뷰가 보낸 requestId의 generation이 실제로 만들어졌는지 확인(응답은 opaque라 id를 모름).
const dir = new URL('../../../../../services/agent-server/data/generations/', import.meta.url);
const hit = readdirSync(dir).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'))).find(g => g.request?.requestId === requestId);
console.log('server-side generation from preview request:', hit ? JSON.stringify({ state: hit.state, projectId: hit.request.projectId === created.projectId ? '<probe project>' : 'other', events: hit.events.map(e => e.type) }) : 'not found');

assert.equal(hit, undefined, 'preview must not create a generation');
assert.deepEqual(after, before, 'project must remain unchanged');
assert.deepEqual(snapshot(), storageBefore, 'project and generation/event files must remain unchanged');
const denied = await fetch(A + '/generations', { method: 'POST', headers: { Origin: 'http://localhost:5174', 'Content-Type': 'text/plain' }, body: JSON.stringify({ projectId: created.projectId, baseRevision: before.revision, prompt: 'probe', requestId }) });
assert.equal(denied.status, 403);
assert.deepEqual(snapshot(), storageBefore);
console.log('server-side preview POST status =', denied.status);
console.log('PASS: no generation created; all project and generation/event files unchanged (contents + mtime).');
