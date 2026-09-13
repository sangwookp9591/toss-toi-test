globalThis.observations=[];
globalThis.record=(name,data)=>{observations.push({name,time:new Date().toISOString(),...data});fs.writeFileSync('docs/qa/qa2/logs/manual.json',JSON.stringify(observations,null,2));};
globalThis.runStep=async code=>(0,eval)(`(async()=>{${code}})()`);
for(let i=1;i<=2;i++){
 await page.reload(); await page.locator('.question').waitFor();
 const restored=await page.evaluate(()=>({chats:studio.getSnapshot().chats,question:studio.getSnapshot().question}));
 record('refresh-'+i,{same:JSON.stringify(restored)===JSON.stringify(before)});await shot('03-refresh-'+i);
}
globalThis.tab=await ctx.newPage();await tab.goto(baseUrl);await tab.waitForFunction(()=>studio.getSnapshot().lastCommit);
record('other-tab',{question:await tab.locator('.question').count(),text:await tab.locator('body').innerText()});
await tab.screenshot({path:'docs/qa/qa2/shots/04-other-tab.png',fullPage:true});
await page.bringToFront();
for(const width of [400,1600]){await page.setViewportSize({width,height:1000});await shot('05-question-'+width);record('button-'+width,{size:await page.getByRole('button',{name:'답변',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:r.width,height:r.height,right:r.right,lineHeight:s.lineHeight,whiteSpace:s.whiteSpace}})});}
await page.getByLabel('추가 답변').fill('아니요');await page.getByRole('button',{name:'답변',exact:true}).click();
await page.waitForFunction(()=>studio.getSnapshot().lastCommit?.token.revision===2);
record('answered',{revisionReady:await page.evaluate(()=>studio.getSnapshot().generationEvents.some(e=>e.type==='revision_ready'))});await shot('06-generation-ready');
globalThis.frame=()=>page.frameLocator('#preview iframe');
record('query-initial',{text:await frame().locator('body').innerText()});
await frame().getByRole('button',{name:'조회',exact:true}).click();await shot('07-reason-required');
await frame().getByLabel('조회 사유').fill('고객 문의 확인');await frame().getByRole('button',{name:'조회',exact:true}).click();await frame().getByText('010-****-5678').waitFor();await shot('08-masked-list');
await frame().getByRole('button',{name:'고객 상태를 정지로 변경'}).click();await shot('09-write-blocked');
globalThis.writeStart=Date.now();await page.getByRole('checkbox',{name:'쓰기 테스트 허용'}).check();
await page.waitForFunction(()=>studio.getSnapshot().writeAllowed && studio.getSnapshot().lastCommit?.token.attemptId);
await page.waitForTimeout(1000);await frame().getByLabel('조회 사유').fill('고객 상태 변경 확인');await frame().getByRole('button',{name:'고객 상태를 정지로 변경'}).click();await frame().getByText('상태를 정지로 바꿨어요.').waitFor();await shot('10-write-enabled-countdown');
record('write-enabled',{start:writeStart,foot:await page.locator('.preview-foot').innerText()});
