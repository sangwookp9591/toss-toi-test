// Run against dev-up using the repository's existing E2E Playwright install.
// @ts-ignore Playwright is owned by the E2E package, not an agent-server dependency.
import { chromium, expect } from '../../../e2e/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mockFiles } from '../src/templates.ts';
const evidence = fileURLToPath(new URL('../../../docs/qa/fx/', import.meta.url));
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const log: string[] = [];
try {
 const page = await browser.newPage({ viewport: {width:1600,height:1000} });
 await page.goto('http://localhost:5273');
 await page.getByRole('button',{name:'프로젝트 만들기'}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).studio.getSnapshot().lastCommit?.token.revision),{timeout:60000}).toBe(1);
 // Save the current mock generator's actual output through the F2 source boundary.
 await page.evaluate(async (files: Record<string,string>)=>{
  const studio=(window as any).studio;
  await studio.saveFiles({...studio.getSnapshot().project.files,...files});
 },mockFiles('고객 목록',''));
 await expect.poll(()=>page.evaluate(()=>(window as any).studio.getSnapshot().lastCommit?.token.revision),{timeout:60000}).toBe(2);
 const frame=page.frameLocator('#preview iframe');
 await expect(frame.getByRole('status')).toContainText('조회 사유를 입력하고 조회를 눌러 주세요');
 await expect(frame.getByRole('table')).toHaveCount(0);
 log.push('PASS initial: guidance visible; no table');
 await page.screenshot({path:evidence+'mock-initial.png'});
 await frame.getByLabel('조회 사유').fill('고객 문의 확인');
 let complete!:()=>void;
 const gate=new Promise<void>(resolve=>{complete=resolve;});
 let requests=0;
 const pattern='**/proxy/customers/customers';
 await page.route(pattern,async (route:any)=>{
  if(route.request().method()==='OPTIONS'){await route.continue();return;}
  requests++; await gate; await route.continue();
 });
 await frame.getByRole('button',{name:'조회',exact:true}).click();
 await expect(frame.getByRole('button',{name:'조회 중…',exact:true})).toBeDisabled();
 await expect(frame.getByRole('status')).toContainText('조회 중…');
 await page.screenshot({path:evidence+'mock-loading.png'});
 complete();
 await expect(frame.getByRole('table')).toBeVisible();
 await expect(frame.getByText('010-****-5678')).toBeVisible();
 expect(requests).toBe(1);
 log.push('PASS loading → result: disabled button, one request, real masked backend data');
 await page.unroute(pattern);
 for(const [name,status,body,message] of [
  ['empty',200,{items:[]},'조건에 맞는 고객이 없어요'],
  ['reason',428,{error:'REASON_REQUIRED'},'조회 사유를 5자 이상 입력하세요.'],
  ['forbidden',403,{error:'FORBIDDEN'},'조회 권한이 없어요.'],
  ['backend',503,{error:'UNAVAILABLE'},'고객 시스템이 응답하지 않아요. 잠시 후 다시 시도하세요.'],
  ['network',0,{},'정책 서버에 연결하지 못했어요. 잠시 후 다시 시도하세요.'],
 ] as const){
  await page.route(pattern,async(route:any)=>{
   if(route.request().method()==='OPTIONS'){await route.continue();return;}
   if(status===0) await route.abort('connectionrefused');
   else await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'http://localhost:5274'},body:JSON.stringify(body)});
  });
  await frame.getByRole('button',{name:'조회',exact:true}).click();
  await expect(status===200?frame.getByRole('status'):frame.getByRole('alert')).toContainText(message);
  await expect(frame.getByRole('table')).toHaveCount(0);
  await expect(frame.getByRole('button',{name:'조회',exact:true})).toBeEnabled();
  log.push(`PASS ${name}: ${message}`);
  if(['empty','backend','network'].includes(name)) await page.screenshot({path:evidence+`mock-${name}.png`});
  await page.unroute(pattern);
 }
 await frame.getByRole('button',{name:'조회',exact:true}).click();
 await expect(frame.getByRole('table')).toBeVisible();
 log.push('PASS retry: real backend rows restored after all injected errors');
} finally {
 await browser.close();
 await writeFile(evidence+'mock-browser-states.log',log.join('\n')+'\n');
 console.log(log.join('\n'));
}
