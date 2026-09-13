await casTab.frameLocator('#preview iframe[data-state="committed"]').getByText('QA2 다른 탭 최신 내용').waitFor();
await page.getByRole('button',{name:'저장하고 반영'}).click();await page.locator('.conflict').waitFor();await shot('13-cas-conflict');await page.getByRole('button',{name:'최신 내용 불러오기'}).click();await frame().getByText('QA2 다른 탭 최신 내용').waitFor();
await page.locator('.edit-backups details').filter({has:page.locator('summary',{hasText:'/src/App.tsx'})}).locator('summary').click();await page.getByRole('button',{name:'복사',exact:true}).click();
record('cas-copy',{backup:await page.getByLabel('보관본 /src/App.tsx').inputValue(),clipboard:await page.evaluate(()=>navigator.clipboard.readText())});await shot('14-cas-backup-copy');await page.reload();await page.waitForFunction(()=>studio.getSnapshot().lastCommit);record('cas-after-refresh',{backups:await page.evaluate(()=>studio.getSnapshot().backups.length)});
globalThis.editPage=page;page=mainPage;await page.bringToFront();
