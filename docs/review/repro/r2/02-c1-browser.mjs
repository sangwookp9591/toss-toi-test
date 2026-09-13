// R2-C1(브라우저): 프리뷰 iframe과 같은 sandbox 플래그(allow-scripts allow-same-origin)로 5174 문서를 띄우고
// 실제 Chrome이 Origin 없이 7200에 요청을 보낼 수 있는 경로가 있는지 확인한다.
// 각 기법을 (1) 헤더 기록용 로컬 echo 서버, (2) 실행 중 :7200 두 곳에 보내 결과를 비교한다. 토큰 원문은 출력하지 않는다.
// 실행: node docs/review/repro/r2/02-c1-browser.mjs  (서비스 기동 상태)
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const seen = [];
const echo = createServer((req, res) => {
  let body = ''; req.on('data', c => body += c).on('end', () => {
    const id = new URL(req.url, 'http://x').searchParams.get('t');
    if (req.method !== 'OPTIONS') seen.push({ t: id, method: req.method, origin: req.headers.origin ?? '(none)', ct: req.headers['content-type'] ?? '(none)', auth: Boolean(req.headers.authorization) });
    res.writeHead(req.method === 'OPTIONS' ? 204 : 200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' });
    res.end('{}');
  });
});
await new Promise(r => echo.listen(0, '127.0.0.1', r));
const ECHO = `http://localhost:${echo.address().port}`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:5173/healthz');
await page.evaluate(() => new Promise(resolve => {
  const f = document.createElement('iframe');
  f.sandbox.add('allow-scripts', 'allow-same-origin'); // controller → preview-runtime index.ts:85 와 동일
  f.src = 'http://localhost:5174/healthz'; f.onload = resolve; document.body.append(f);
}));
const frame = page.frames().find(f => f.url().startsWith('http://localhost:5174'));
const results = await frame.evaluate(async ({ ECHO }) => {
  const P = 'http://localhost:7200';
  const body = JSON.stringify({ user: 'r2-browser', roles: ['viewer', 'editor'] });
  const out = [];
  const attempt = async (name, fn) => { try { out.push({ name, result: await fn() }); } catch (e) { out.push({ name, result: 'threw: ' + String(e.message ?? e).slice(0, 80) }); } };
  const status = async (p) => { const r = await p; let token = false; try { token = typeof (await r.clone().json()).token === 'string'; } catch {} return `${r.type} ${r.status} token=${token}`; };
  const both = (t, init) => Promise.all([status(fetch(`${ECHO}/?t=${t}`, init)).catch(e => 'echo threw'), status(fetch(`${P}/dev/session?t=${t}`, init)).catch(e => 'proxy threw ' + e.message)]);
  await attempt('1 fetch POST cors json', () => both('cors-json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
  await attempt('2 fetch POST no-cors text/plain', () => both('nocors-text', { method: 'POST', mode: 'no-cors', body }));
  await attempt('3 fetch POST no-cors referrerPolicy=no-referrer', () => both('nocors-noref', { method: 'POST', mode: 'no-cors', referrerPolicy: 'no-referrer', body }));
  await attempt('4 fetch GET no-cors + Authorization header', () => both('nocors-get-auth', { mode: 'no-cors', headers: { Authorization: 'Bearer x' } }));
  await attempt('5 sendBeacon Blob(text/plain)', () => [navigator.sendBeacon(`${ECHO}/?t=beacon`, new Blob([body], { type: 'text/plain' })), navigator.sendBeacon(`${P}/dev/session?t=beacon`, new Blob([body], { type: 'text/plain' }))]);
  await attempt('6 sendBeacon Blob(application/json)', () => { try { return navigator.sendBeacon(`${ECHO}/?t=beacon-json`, new Blob([body], { type: 'application/json' })); } catch (e) { return 'threw ' + e.name; } });
  await attempt('7 form POST text/plain (sandbox, no allow-forms)', () => new Promise(resolve => {
    const target = document.createElement('iframe'); target.name = 'sink'; document.body.append(target);
    const form = Object.assign(document.createElement('form'), { method: 'POST', action: `${ECHO}/?t=form`, enctype: 'text/plain', target: 'sink' });
    form.append(Object.assign(document.createElement('input'), { name: body, value: '' })); document.body.append(form);
    try { form.submit(); } catch (e) { resolve('threw ' + e.name); } setTimeout(() => resolve('submitted (see echo log)'), 800);
  }));
  await attempt('8 window.open studio origin', () => { const w = window.open('http://localhost:5173/', '_blank'); return w ? 'opened' : 'blocked (null)'; });
  await attempt('9 top.location → studio', () => { try { top.location.href = 'http://localhost:5173/?project=x'; return 'no exception'; } catch (e) { return 'threw ' + e.name; } });
  await attempt('10 nested srcdoc iframe (Origin: null)', () => new Promise(resolve => {
    const f = document.createElement('iframe'); f.sandbox.add('allow-scripts');
    addEventListener('message', function h(e) { if (e.data?.r2) { removeEventListener('message', h); resolve(e.data.r2); } });
    f.srcdoc = `<script>Promise.all([fetch('${ECHO}/?t=srcdoc',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>'echo '+r.status).catch(()=>'echo threw'),fetch('${P}/dev/session',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(r=>'proxy '+r.status).catch(()=>'proxy threw')]).then(v=>parent.postMessage({r2:v.join(' | ')},'*'))<\/script>`;
    document.body.append(f); setTimeout(() => resolve('timeout'), 3000);
  }));
  await attempt('11 blob: Worker fetch', () => new Promise(resolve => {
    const w = new Worker(URL.createObjectURL(new Blob([`Promise.all([fetch('${ECHO}/?t=worker',{method:'POST',body:'{}'}).then(r=>'echo '+r.status).catch(()=>'echo threw'),fetch('${P}/dev/session',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}}).then(r=>'proxy '+r.status).catch(()=>'proxy threw')]).then(v=>postMessage(v.join(' | ')))`], { type: 'text/javascript' })));
    w.onmessage = e => resolve(e.data); setTimeout(() => resolve('timeout'), 3000);
  }));
  await attempt('12 nested iframe of studio origin 5173 (framable?)', () => new Promise(resolve => {
    const f = document.createElement('iframe'); f.src = 'http://localhost:5173/healthz';
    f.onload = () => { try { f.contentWindow.document; resolve('loaded, DOM readable?!'); } catch { resolve('loaded, cross-origin (DOM not readable)'); } };
    document.body.append(f); setTimeout(() => resolve('timeout'), 3000);
  }));
  await attempt('13 navigator.serviceWorker available / register blob:', async () => { if (!navigator.serviceWorker) return 'no serviceWorker API'; try { await navigator.serviceWorker.register(URL.createObjectURL(new Blob(['//'], { type: 'text/javascript' }))); return 'registered?!'; } catch (e) { return 'rejected ' + e.name; } });
  return out;
}, { ECHO });
await new Promise(r => setTimeout(r, 1000));
console.log('== 기법별 결과 (echo 결과 | :7200 결과)');
for (const r of results) console.log(r.name.padEnd(52), JSON.stringify(r.result));
console.log('== echo 서버가 받은 요청의 Origin 헤더');
for (const s of seen) console.log(String(s.t).padEnd(18), s.method.padEnd(5), 'origin=' + s.origin, 'content-type=' + s.ct, 'authorization=' + s.auth);
console.log('topPageUrlAfter=' + page.url(), 'pages=' + browser.contexts()[0].pages().length);
await browser.close(); echo.close();
