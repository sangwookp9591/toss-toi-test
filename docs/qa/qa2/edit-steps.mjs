globalThis.mainPage=page; page=await ctx.newPage();await page.goto('http://localhost:5173');await page.getByRole('button',{name:'프로젝트 만들기'}).click();await page.waitForFunction(()=>studio.getSnapshot().lastCommit);
globalThis.saveUI=async code=>{await page.getByLabel('소스 코드').fill(code);await page.getByRole('button',{name:'저장하고 반영'}).click();};
await saveUI('export default function App(){return <h1>QA2 정상 편집</h1>}');await frame().getByText('QA2 정상 편집').waitFor();await shot('11-edit-normal');
for(const [name,code] of [['syntax','export default function App( { return <h1>oops</h1> }'],['runtime',"throw new Error('QA runtime failure'); export default function App(){return <h1>실패</h1>}"],['axios',"import axios from 'axios'; export default function App(){return <h1>{String(axios)}</h1>}"]]){
 await saveUI(code);await page.waitForTimeout(800);await shot('12-error-'+name);record('diagnostic-'+name,{diagnostics:await page.getByRole('alert',{name:'편집 오류'}).innerText(),preview:await frame().locator('body').innerText()});
}
await saveUI('export default function App(){return <h1>QA2 편집 복구</h1>}');await frame().getByText('QA2 편집 복구').waitFor();
globalThis.casTab=await ctx.newPage();await casTab.goto(page.url());await casTab.waitForFunction(()=>studio.getSnapshot().lastCommit);
await page.getByLabel('소스 코드').fill('export default function App(){return <h1>QA2 보관할 내 편집</h1>}');
await casTab.getByLabel('소스 코드').fill('export default function App(){return <h1>QA2 다른 탭 최신 내용</h1>}');await casTab.getByRole('button',{name:'저장하고 반영'}).click();await casTab.frameLocator('#preview iframe').getByText('QA2 다른 탭 최신 내용').waitFor();
await page.getByRole('button',{name:'저장하고 반영'}).click();await page.locator('.conflict').waitFor();await shot('13-cas-conflict');await page.getByRole('button',{name:'최신 내용 불러오기'}).click();await frame().getByText('QA2 다른 탭 최신 내용').waitFor();
await page.locator('.edit-backups details').filter({has:page.locator('summary',{hasText:'/src/App.tsx'})}).locator('summary').click();await page.getByRole('button',{name:'복사',exact:true}).click();
record('cas-copy',{backup:await page.getByLabel('보관본 /src/App.tsx').inputValue(),clipboard:await page.evaluate(()=>navigator.clipboard.readText())});await shot('14-cas-backup-copy');await page.reload();await page.waitForFunction(()=>studio.getSnapshot().lastCommit);record('cas-after-refresh',{backups:await page.evaluate(()=>studio.getSnapshot().backups.length)});
globalThis.editPage=page;page=mainPage;await page.bringToFront();
