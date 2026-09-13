import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/auth';
const snapshot=(page:Page)=>page.evaluate(()=> (window as any).studio?.getSnapshot() ?? {}).catch(error=>{if (/Execution context was destroyed|Cannot find context/.test(error.message)) return {}; throw error;});
async function commit(page:Page,revision:number){await expect.poll(async()=> (await snapshot(page)).lastCommit?.token.revision).toBe(revision);}
async function create(page:Page){await page.goto('/');await page.getByRole('button',{name:'프로젝트 만들기'}).waitFor();expect(await page.evaluate(()=>crossOriginIsolated)).toBe(false);await page.getByRole('button',{name:'프로젝트 만들기'}).click();await commit(page,1);}
const frame=(page:Page)=>page.frameLocator('#preview iframe');
async function generate(page:Page,prompt='고객 목록 화면 만들어줘'){await pendingQuestion(page,prompt);await page.getByRole('button',{name:'아니요',exact:true}).click();await commit(page,2);}
async function save(page:Page,app:string){return page.evaluate(async app=>{const c=(window as any).studio;return c.saveFiles({...c.getSnapshot().project.files,'/src/App.tsx':app});},app);}
const plain=(text:string)=>`export default function App(){return <h1>${text}</h1>}`;
test('A: 생성, 역질문, 마스킹, 조회 사유와 감사 기록',async({page})=>{await create(page);await generate(page);await expect(frame(page).getByText('조회 사유', {exact:true})).toBeVisible();await frame(page).getByRole('button',{name:'조회',exact:true}).click();await expect(frame(page).getByRole('alert')).toBeVisible();await frame(page).getByLabel('조회 사유').fill('고객 문의 확인');await frame(page).getByRole('button',{name:'조회',exact:true}).click();await expect(frame(page).getByText('010-****-5678')).toBeVisible();await page.getByRole('button',{name:'활동 기록',exact:true}).click();await expect.poll(async()=>{await page.evaluate(()=> (window as any).studio.loadAudit());return (await snapshot(page)).audit.some((x:any)=>x.decision==='allowed'&&x.reason==='고객 문의 확인');}).toBe(true);await page.screenshot({path:'artifacts/studio.png',fullPage:true});});
test('B: 문법 오류는 마지막 정상 화면 유지',async({page})=>{await create(page);const original=await frame(page).locator('body').innerText();await page.getByLabel('소스 코드').fill('export default function App( {');await page.getByRole('button',{name:'저장하고 반영'}).click();await expect(page.getByRole('status')).toContainText('이전 화면을 유지했어요: 문법 오류');expect(await frame(page).locator('body').innerText()).toBe(original);expect((await snapshot(page)).lastCommit.token.revision).toBe(1);});
test('C: 이전 실행을 지연해도 최신 revision만 커밋',async({page})=>{await create(page);await save(page,`await new Promise(r=>setTimeout(r,2000));${plain('늦은 이전 화면')}`);await expect.poll(async()=> (await snapshot(page)).events.some((e:any)=>e.type==='build_started'&&e.token.revision===2)).toBe(true);await expect(page.locator('#preview iframe')).toHaveCount(2);await save(page,plain('가장 최신 화면'));await commit(page,3);await page.waitForTimeout(2400);await expect(frame(page).getByText('가장 최신 화면')).toBeVisible();const events=(await snapshot(page)).events;expect(events.filter((e:any)=>e.type==='committed'&&e.token.revision===2)).toHaveLength(0);expect(events.some((e:any)=>e.type==='stale_discarded'&&e.token.revision===2)).toBe(true);});
test('D: viewer 자체 발급 차단, 읽기 전용 차단, 제한된 쓰기 허용',async({page})=>{await create(page);await generate(page,'고객 목록 상태 변경 화면 만들어줘');
const security=await frame(page).locator('body').evaluate(async()=>{const config=(globalThis as any).__TOI_FETCH_CONFIG__;const blocked=await Promise.all(['/dev/session','/capabilities'].map(endpoint=>fetch('http://localhost:7200'+endpoint,{method:'POST',body:'{}'}).then(()=>false,()=>true)));return {blocked,keys:Object.keys(config).sort()};});
expect(security.blocked).toEqual([true,true]);expect(security.keys).toEqual(['env','projectId','transport']);await frame(page).getByLabel('조회 사유').fill('고객 문의 확인');await frame(page).getByRole('button',{name:'고객 상태를 정지로 변경'}).click();await expect(frame(page).getByRole('alert')).toContainText('쓰기 권한');const attempt=(await snapshot(page)).lastCommit.token.attemptId;await page.getByRole('checkbox',{name:'쓰기 테스트 허용'}).check();await expect.poll(async()=> (await snapshot(page)).lastCommit.token.attemptId).not.toBe(attempt);expect(await frame(page).locator('body').evaluate(()=> (globalThis as any).__TOI_FETCH_CONFIG__.transport)).toBe('broker');await frame(page).getByLabel('조회 사유').fill('고객 상태 변경 확인');await frame(page).getByRole('button',{name:'고객 상태를 정지로 변경'}).click();await expect(frame(page).getByRole('status')).toContainText('상태를 정지로 바꿨어요');await expect.poll(async()=>{await page.evaluate(()=> (window as any).studio.loadAudit());return (await snapshot(page)).audit.some((x:any)=>x.method==='PATCH'&&x.decision==='allowed');}).toBe(true);});
test('E: 두 탭 CAS 충돌과 최신 내용 다시 불러오기',async({page,context})=>{await create(page);const tab=await context.newPage();await tab.goto(page.url());await commit(tab,1);await Promise.all([page.getByLabel('소스 코드').fill(plain('첫 탭')),tab.getByLabel('소스 코드').fill(plain('둘째 탭'))]);await Promise.all([page.getByRole('button',{name:'저장하고 반영'}).click(),tab.getByRole('button',{name:'저장하고 반영'}).click()]);await expect.poll(async()=>Number((await snapshot(page)).conflict)+Number((await snapshot(tab)).conflict)).toBe(1);const loser=(await snapshot(page)).conflict?page:tab;await expect(loser.getByRole('alert')).toContainText('다른 탭에서 먼저 저장');await loser.getByRole('button',{name:'최신 내용 불러오기'}).click();await expect.poll(async()=> (await snapshot(loser)).project.revision).toBe(2);await tab.close();});
test('F: 사내 useToast와 앱 React 인스턴스 공유',async({page})=>{const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await create(page);await save(page,`import React from 'react';import {ToastProvider,useToast,reactInstance} from '@toi/tds';function Content(){const {toast}=useToast();return <><p>{React===(reactInstance.default??reactInstance)?'동일 React':'React 불일치'}</p><button onClick={()=>toast('토스트 성공')}>알림 띄우기</button></>}export default function App(){return <ToastProvider><Content/></ToastProvider>}`);await commit(page,2);await expect(frame(page).getByText('동일 React')).toBeVisible();await frame(page).getByRole('button',{name:'알림 띄우기'}).click();await expect(frame(page).getByText('토스트 성공')).toBeVisible();expect(errors).toEqual([]);expect((await snapshot(page)).events.filter((x:any)=>x.type==='runtime_failed')).toEqual([]);});

async function pendingQuestion(page: Page, prompt = '고객 목록 화면 만들어줘') {
  await page.getByLabel('만들고 싶은 화면').fill(prompt);
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.locator('.question')).toBeVisible();
}
// Mirrors generationKey() in apps/studio/src/controller.ts.
const recovery = (page: Page) => page.evaluate(() => {
  const id = (window as any).studio.getSnapshot().project.projectId;
  return JSON.parse(sessionStorage.getItem(`toi-studio-generation-v1:${id}`) ?? 'null');
});
const setRecovery = (page: Page, value: unknown) => page.evaluate(value => {
  const id = (window as any).studio.getSnapshot().project.projectId;
  sessionStorage.setItem(`toi-studio-generation-v1:${id}`, JSON.stringify(value));
}, value);
test('G: 역질문 새로고침 복구, Last-Event-ID 이후 답변과 revision_ready', async ({ page }) => {
  await create(page); await pendingQuestion(page);
  const before = await recovery(page);
  expect(before.seq).toBeGreaterThan(0);
  const stream = page.waitForRequest(request => request.url().includes(`/generations/${before.generationId}/events`));
  await page.reload();
  expect((await stream).headers()['last-event-id']).toBe(String(before.seq));
  await expect(page.locator('.question strong')).toHaveText(before.question.question);
  expect((await snapshot(page)).chats).toEqual(before.chats);
  await expect(page.getByRole('status')).toContainText('한 가지만 더 알려 주세요');
  await expect(page.getByRole('button', { name: '생성 중단' })).toBeEnabled();
  await page.getByLabel('추가 답변').fill('아니요');
  await page.getByRole('button', { name: '답변', exact: true }).click();
  await commit(page, 2);
  expect((await snapshot(page)).generationEvents.some((event: any) => event.type === 'revision_ready')).toBe(true);
  await expect.poll(() => recovery(page)).toBeNull();
});
test('G: 복구한 질문 취소와 이미 끝난 생성·404 안내', async ({ page }) => {
  await create(page); await pendingQuestion(page);
  const saved = await recovery(page); const url = page.url();
  await page.reload();
  await expect(page.locator('.question')).toBeVisible();
  await page.getByRole('button', { name: '생성 중단' }).click();
  await expect.poll(() => recovery(page)).toBeNull();
  await expect(page.locator('.generation-notice')).toContainText('진행 중이던 생성이 끝났어요: 중단');
  // Recreate the persisted checkpoint from before the terminal event arrived.
  await setRecovery(page, saved);
  await page.goto(url);
  await expect(page.locator('.generation-notice')).toContainText('진행 중이던 생성이 끝났어요: 중단');
  await expect.poll(() => recovery(page)).toBeNull();
  await setRecovery(page, { ...saved, generationId: crypto.randomUUID() });
  await page.reload();
  await expect(page.locator('.access-notice[role="alert"]')).toContainText('이 프로젝트에 접근할 수 없어요. 멤버에서 제거되었거나 권한이 바뀌었을 수 있어요');
  await expect(page.getByLabel('만들고 싶은 화면')).toBeDisabled();
  await expect(page.locator('#preview iframe')).toHaveCount(0);
  await page.getByRole('button', { name: '처음 화면으로', exact: true }).click();
  await expect(page.getByRole('button', { name: '프로젝트 만들기', exact: true })).toBeVisible();
  expect(await page.evaluate(projectId => sessionStorage.getItem(`toi-studio-generation-v1:${projectId}`), new URL(url).searchParams.get('project'))).toBeNull();
});
test('H: 쓰기 권한 만료 시 토글 off, 안내와 read capability 재반영', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__STUDIO_TEST_CONFIG__ = { writeTtlSec: 4 }; });
  await create(page);
  const original = (await snapshot(page)).lastCommit.token.attemptId;
  await page.getByRole('checkbox', { name: '쓰기 테스트 허용' }).check();
  await expect(page.locator('.preview-foot')).toContainText(/쓰기 허용 0:0[1-4] 남음/);
  await expect.poll(async () => (await snapshot(page)).lastCommit.token.attemptId).not.toBe(original);
  await expect(page.getByRole('checkbox', { name: '쓰기 테스트 허용' })).not.toBeChecked();
  await expect(page.locator('.preview-foot')).toContainText('쓰기 허용 시간이 끝났어요. 다시 켜면 2분 동안 허용돼요.');
  await expect.poll(async () => (await snapshot(page)).writeAllowed).toBe(false);
});
test('I: 문법 오류 위치, 금지 패키지 이름과 runtime 원인', async ({ page }) => {
  await create(page);
  await save(page, 'export default function App( {');
  const errors = page.getByRole('alert', { name: '편집 오류' });
  await expect(errors).toContainText('/src/App.tsx');
  await expect(errors).toContainText(/1행.*열/);
  await expect(page.getByRole('status')).toContainText('이전 화면을 유지했어요: 문법 오류');
  await save(page, "import axios from 'axios'; export default function App(){return <h1>{String(axios)}</h1>}");
  await expect(errors).toContainText('‘axios’ 패키지는 이 프로젝트에서 쓸 수 없어요');
  await expect(page.getByRole('status')).toContainText('허용되지 않은 패키지');
  await save(page, "throw new Error('QA runtime failure'); export default function App(){return <h1>실패</h1>}");
  await expect(errors).toContainText('QA runtime failure');
  await expect(errors).toContainText('/src/App.tsx');
  await expect(errors).toContainText(/1행.*열/);
  await page.screenshot({ path: 'artifacts/runtime-location.png', fullPage: true });
  expect((await snapshot(page)).lastCommit.token.revision).toBe(1);
});
test('J: CAS 최신 불러오기 전에 파일별 내 편집 보관, 복사와 새로고침 유지', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await create(page);
  const tab = await context.newPage(); await tab.goto(page.url()); await commit(tab, 1);
  const local = plain('보관해야 하는 내 편집');
  await tab.getByLabel('소스 코드').fill(local);
  await save(page, plain('다른 탭에서 저장한 최신 편집')); await commit(page, 2);
  await tab.getByRole('button', { name: '저장하고 반영' }).click();
  await expect(tab.getByRole('alert')).toContainText('내 편집은 보관본으로 남겨요');
  await tab.getByRole('button', { name: '최신 내용 불러오기' }).click(); await commit(tab, 2);
  await expect(tab.getByLabel('소스 코드')).toHaveValue(plain('다른 탭에서 저장한 최신 편집'));
  const backup = tab.locator('.edit-backups details').filter({ has: tab.locator('summary', { hasText: '/src/App.tsx' }) });
  await backup.locator('summary').click();
  await expect(tab.getByLabel('보관본 /src/App.tsx')).toHaveValue(local);
  await backup.getByRole('button', { name: '복사', exact: true }).click();
  expect(await tab.evaluate(() => navigator.clipboard.readText())).toBe(local);
  await tab.reload(); await commit(tab, 2);
  expect((await snapshot(tab)).backups[0].files['/src/App.tsx']).toBe(local);
  await tab.close();
});
test('K: 존재하지 않는 패키지 버전의 실제 조합 실패와 동일 revision 재시도', async ({ page, request }) => {
  const project = await (await request.post('http://localhost:7400/projects', { data: { name: '의존성 장애 검증', apiIds: ['customers'] } })).json();
  const changed = await request.put(`http://localhost:7400/projects/${project.projectId}/source`, { data: {
    baseRevision: project.revision, files: project.files,
    packageSet: { ...project.packageSet, dependencies: { ...project.packageSet.dependencies, '@toi/tds': '9999.0.0-qa-missing' } },
  } });
  expect(changed.ok()).toBe(true);
  let requests = 0;
  page.on('request', req => { if (req.url() === 'http://localhost:7100/package-sets' && req.method() === 'POST') requests++; });
  await page.goto(`/?project=${project.projectId}`);
  await expect(page.getByRole('status')).toContainText('화면을 처음 준비하지 못했어요: 구성 요소 준비 실패');
  await expect(page.getByRole('status')).toContainText('패키지 또는 버전 확인 필요');
  await expect(page.locator('.preview-pane').getByRole('button', { name: '다시 시도' })).toBeVisible();
  await page.locator('.preview-pane').getByRole('button', { name: '다시 시도' }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole('status')).toContainText('화면을 처음 준비하지 못했어요: 구성 요소 준비 실패');
  expect((await snapshot(page)).project.revision).toBe(2);
});
test('K: failed 응답·연결 실패·시간 초과 구분과 새로고침 없는 재빌드', async ({ page }) => {
  // Install before navigation so OIDC and app timers share one clock from startup.
  // Replacing the clock after those timers exist has undefined behavior.
  await page.clock.install();
  let failure: 'failed' | 'connection' | 'timeout' | 'registry_unavailable' | 'storage_unavailable' | 'input' | 'internal' | undefined = 'failed';
  let posts = 0; let timeoutWaits = 0;
  await page.route('http://localhost:7100/package-sets', async route => {
    posts++;
    if (failure === 'failed') await route.fulfill({ json: { status: 'failed', artifactKey: 'qa', error: 'Dependency build failed https://internal.example/private?token=do-not-display' } });
    else if (failure === 'connection') await route.abort('connectionrefused');
    else if (failure === 'timeout') await route.fulfill({ status: 202, json: { status: 'building', artifactKey: 'qa-timeout', startedAt: new Date().toISOString() } });
    else if (failure) await route.fulfill({ json: { status: 'failed', artifactKey: 'qa-code', code: failure, error: 'untrusted package install text' } });
    else await route.continue();
  });
  await page.route('http://localhost:7100/package-sets/qa-timeout/wait?timeoutMs=30000', () => { timeoutWaits++; });
  await page.goto('/'); await page.getByRole('button', { name: '프로젝트 만들기' }).click();
  await expect(page.getByRole('status')).toContainText('구성 요소 빌드 실패');
  await expect(page.locator('body')).not.toContainText('internal.example');
  await expect(page.locator('body')).not.toContainText('do-not-display');
  for (const [code, message] of [
    ['registry_unavailable', '패키지 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.'],
    ['storage_unavailable', '구성 요소 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.'],
    ['input', '패키지 또는 버전 확인 필요'], ['internal', '구성 요소 빌드 실패'],
  ] as const) {
    failure = code;
    await page.getByRole('status').getByRole('button', { name: '다시 시도' }).click();
    await expect(page.getByRole('status')).toContainText(message);
  }
  failure = 'connection';
  await page.getByRole('status').getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('status')).toContainText('구성 요소 서비스 연결 실패');
  failure = 'timeout';
  await page.getByRole('status').getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('status')).toContainText('처음 사용하는 구성 요소');
  // Observe the actual pending fetch before advancing time; rendered status alone
  // does not synchronize the browser's network interception with the fake clock.
  await expect.poll(() => timeoutWaits).toBe(1);
  await page.clock.runFor(90001);
  await expect(page.getByRole('status')).toContainText('대기 시간 초과');
  failure = undefined;
  await page.getByRole('status').getByRole('button', { name: '다시 시도' }).click();
  await commit(page, 1);
  expect(posts).toBe(8);
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0);
  failure = 'connection'; await save(page, plain('장애 뒤 재시도'));
  await expect(page.getByRole('status')).toContainText('이전 화면을 유지했어요: 구성 요소 준비 실패');
  failure = undefined;
  await page.locator('.preview-pane').getByRole('button', { name: '다시 시도' }).click(); await commit(page, 2);
  await expect(frame(page).getByText('장애 뒤 재시도')).toBeVisible();
});
for (const width of [1600, 400]) test(`레이아웃: ${width}px 답변 버튼은 한 줄`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await create(page); await pendingQuestion(page);
  const button = page.getByRole('button', { name: '답변', exact: true });
  await expect(button).toBeVisible();
  const size = await button.evaluate(el => {
    const style = getComputedStyle(el); const box = el.getBoundingClientRect();
    return { height: box.height, line: parseFloat(style.lineHeight), padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom), width: box.width, right: box.right };
  });
  expect(size.height).toBeLessThanOrEqual(size.line + size.padding + 2);
  expect(size.width).toBeGreaterThanOrEqual(48); expect(size.right).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `artifacts/question-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: '생성 중단' }).click();
});

test('L: 새 탭 활성 생성 전체 replay, 답변 동기화와 양쪽 취소 종결', async ({ page, context }) => {
  await create(page);
  // A stale checkpoint in the other tab must never supersede the server's active run.
  const tab = await context.newPage(); await tab.goto(page.url()); await commit(tab, 1);
  await pendingQuestion(page);
  const before = await recovery(page);
  await setRecovery(tab, { ...before, generationId: crypto.randomUUID(), seq: 999, chats: [{ role: 'assistant', text: 'stale chat' }] });
  const replay = tab.waitForRequest(request => request.url().includes(`/generations/${before.generationId}/events`));
  await tab.reload();
  expect((await replay).headers()['last-event-id']).toBeUndefined();
  await expect(tab.locator('.question strong')).toHaveText(before.question.question);
  expect((await snapshot(tab)).chats).toEqual(before.chats);
  await tab.screenshot({ path: 'artifacts/other-tab-restored.png', fullPage: true });
  await expect(tab.locator('.generation-notice')).toContainText('다른 창에서 진행 중인 요청이 있어요');
  await expect(tab.getByLabel('만들고 싶은 화면')).toBeDisabled();
  const other = await context.newPage(); await other.goto(page.url());
  await expect(other.locator('.question strong')).toHaveText(before.question.question);
  expect(await other.evaluate(() => (window as any).studio.getSnapshot().chats)).toEqual(before.chats);
  await tab.getByRole('button', { name: '아니요', exact: true }).click();
  await expect(page.locator('.answered-question')).toHaveAttribute('data-state', 'answered');
  await expect(page.locator('.answered-question')).toContainText('답변이 반영됐어요');
  await expect(page.locator('.question')).toHaveCount(0);
  await commit(page, 2); await commit(tab, 2); await commit(other, 2);
  await pendingQuestion(page);
  // An already-open idle tab checks the server immediately before sending.
  let newRequests = 0;
  tab.on('request', request => { if (request.url().endsWith('/generations') && request.method() === 'POST') newRequests++; });
  await tab.getByLabel('만들고 싶은 화면').fill('중복 요청');
  await tab.getByRole('button', { name: '보내기' }).click();
  await expect(tab.locator('.question')).toBeVisible();
  expect(newRequests).toBe(0);
  await expect(tab.locator('.generation-notice')).toContainText('다른 창에서 진행 중인 요청이 있어요');
  await page.getByRole('button', { name: '생성 중단' }).click();
  await expect(tab.locator('.generation-notice')).toContainText('진행 중이던 생성이 끝났어요: 중단');
  await expect(tab.getByLabel('만들고 싶은 화면')).toBeEnabled();
  await tab.close(); await other.close();
});

test('M: 실제 Yarn 레지스트리 503 안내 후 저장소 복구와 동일 revision 재시도 성공', async ({ page }) => {
  const { registryFixture } = await import('./registry-fixture');
  const fixture = await registryFixture();
  let failures = 0;
  try {
    await page.route('http://localhost:7100/package-sets**', async route => {
      const url = route.request().url().replace('http://localhost:7100', fixture.url);
      const response = await route.fetch({ url });
      if (response.status() === 503) { expect((await response.json()).code).toBe('registry_unavailable'); failures++; }
      await route.fulfill({ response });
    });
    await page.goto('/'); await page.getByRole('button', { name: '프로젝트 만들기' }).click();
    const navigation = await page.evaluate(() => performance.timeOrigin);
    await expect(page.getByRole('status')).toContainText('패키지 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.');
    await expect(page.getByRole('status')).not.toContainText('패키지 또는 버전 확인 필요');
    expect(failures).toBe(1);
    await page.screenshot({ path: 'artifacts/registry-unavailable.png', fullPage: true });
    const project = (await snapshot(page)).project;
    expect((await fixture.recover()).failedRequests).toBeGreaterThan(0);
    await page.locator('.preview-pane').getByRole('button', { name: '다시 시도' }).click();
    await commit(page, project.revision);
    expect((await snapshot(page)).project).toEqual(project);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(navigation);
    await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/registry-recovered.png', fullPage: true });
  } finally { await page.unrouteAll({ behavior: 'wait' }); await fixture.close(); }
});
