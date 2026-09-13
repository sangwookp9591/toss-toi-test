import { mockFiles } from '../../services/agent-server/src/templates';
import { mkdir } from 'node:fs/promises';
import { test, expect, api, admin, login, issuer, studio, agent, policy } from '../helpers/auth';
import type { Page } from '@playwright/test';
const snapshot = (page: Page) => page.evaluate(() => (window as any).studio?.getSnapshot());
async function project(account: Parameters<typeof api>[0]) {
  const response = await api(account, '/projects', { name: 'Identity boundary', apiIds: ['customers'] });
  expect(response.status).toBe(201); return response.json();
}
async function preview(account: Parameters<typeof api>[0], projectId: string) {
  const response = await api(account, '/preview-sessions', { projectId }, 'POST', policy);
  expect(response.status).toBe(200); return response.json();
}
async function proxy(session: { sessionToken: string; capabilityToken: string }, projectId: string, path = '/customers', method = 'GET') {
  return fetch(policy + '/proxy/customers' + path, { method, headers: { Origin: 'http://localhost:5173', Authorization: 'Bearer ' + session.sessionToken, 'X-Toi-Capability': session.capabilityToken, 'X-Toi-Project': projectId, 'X-Toi-Reason': 'Identity boundary verification', 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify({ status: 'active' }) }) });
}
test('N: carol nonmember receives 404 and cannot mint or use preview/capability', async ({ browser, accounts }) => {
  const alice = await accounts('alice'); const carol = await accounts('carol'); const p = await project(alice);
  expect((await api(carol, '/projects/' + p.projectId)).status).toBe(404);
  expect((await api(carol, '/preview-sessions', { projectId: p.projectId }, 'POST', policy)).status).toBe(404);
  expect((await api(carol, '/capabilities', { projectId: p.projectId, mode: 'read', env: 'preview', ttlSec: 60 }, 'POST', policy)).status).toBe(404);
  const session = await preview(alice, p.projectId);
  expect((await proxy({ ...session, sessionToken: await carol.token() }, p.projectId)).status).toBe(404);
  const context = await browser.newContext({ storageState: carol.state });
  try { const page = await context.newPage(); await page.goto(studio + '/?project=' + p.projectId); await expect(page.getByRole('status')).toContainText('이 프로젝트에 접근할 수 없어요'); await expect(page.locator('#preview iframe')).toHaveCount(0); }
  finally { await context.close(); }
});
test('O: owner member UI protects last owner; viewer read only, editor generation, removal revokes proxy within 5s', async ({ page, browser, accounts }) => {
  const alice = await accounts('alice'); const bob = await login(browser, 'bob'); const p = await project(alice);
  await page.goto('/?project=' + p.projectId);
  await page.getByText('멤버 · live 쓰기 승인', { exact: true }).click();
  await expect(page.getByLabel('alice 역할')).toBeVisible();
  await page.getByLabel('alice 역할').selectOption('viewer');
  await expect(page.locator('.access-panel').filter({has: page.getByRole('heading', {name:'프로젝트 멤버', exact:true})})).toContainText('마지막 소유자');
  await page.getByLabel('추가할 사용자 이름').fill('bob'); await page.getByRole('button', { name: '멤버 추가', exact: true }).click();
  await expect(page.getByLabel('bob 역할')).toHaveValue('viewer');
  expect((await api(bob, '/projects/' + p.projectId + '/source', { baseRevision: p.revision, files: p.files }, 'PUT')).status).toBe(403);
  expect((await api(bob, '/generations', { projectId: p.projectId, baseRevision: p.revision, prompt: '고객 목록', requestId: crypto.randomUUID() })).status).toBe(403);
  const session = await preview(bob, p.projectId); expect((await proxy(session, p.projectId)).status).toBe(200);
  const context = await browser.newContext({ storageState: bob.state });
  try { const view = await context.newPage(); await view.goto(studio + '/?project=' + p.projectId); await expect(view.getByLabel('만들고 싶은 화면')).toBeDisabled(); await expect.poll(async () => (await snapshot(view))?.lastCommit?.token.revision).toBe(1); }
  finally { await context.close(); }
  await page.getByLabel('bob 역할').selectOption('editor'); await expect(page.getByLabel('bob 역할')).toHaveValue('editor');
  const generated = await api(bob, '/generations', { projectId: p.projectId, baseRevision: p.revision, prompt: '고객 목록 화면 만들어줘', requestId: crypto.randomUUID() });
  expect(generated.status).toBe(202); const { generationId } = await generated.json();
  await api(bob, '/generations/' + generationId + '/cancel', {});
  await page.getByLabel('bob 역할').locator('..').getByRole('button', { name: '제거' }).click();
  await expect(page.getByLabel('bob 역할')).toHaveCount(0);
  await expect.poll(async () => (await proxy(session, p.projectId)).status, { timeout: 5000, intervals: [100, 200, 500] }).toBe(404);
});
test('P: live write requires another API owner approval and expires', async ({ page, browser, accounts }) => {
  test.setTimeout(380000);
  const alice = await accounts('alice'); const dana = await accounts('dana'); const p = await project(alice);
  const capability = () => api(alice, '/capabilities', { projectId: p.projectId, mode: 'write', env: 'live', apiIds: ['customers'], ttlSec: 120 }, 'POST', policy);
  expect((await capability()).status).toBe(403);
  await page.goto('/?project=' + p.projectId); await page.getByText('멤버 · live 쓰기 승인', { exact: true }).click();
  await page.getByLabel('승인 요청 사유').fill('고객 데이터 정정 승인'); await page.getByRole('button', { name: 'live 쓰기 승인 요청', exact: true }).click();
  await expect(page.locator('.approval-row')).toContainText('승인 대기');
  const approvals = await (await api(alice, '/approvals?projectId=' + p.projectId, undefined, 'GET', policy)).json();
  expect(approvals.length).toBe(1); const approval = approvals[0];
  expect((await api(alice, '/approvals/' + approval.approvalId + '/decision', { decision: 'approved' }, 'POST', policy)).status).toBe(403);
  const context = await browser.newContext({ storageState: dana.state });
  try {
    const decisionPage = await context.newPage(); await decisionPage.goto(studio); await decisionPage.getByText('멤버 · live 쓰기 승인', { exact: true }).click();
    await decisionPage.getByLabel('승인할 프로젝트 ID').fill(p.projectId); await decisionPage.getByRole('button', { name: '승인 요청 조회', exact: true }).click();
    await decisionPage.getByRole('button', { name: '승인', exact: true }).click(); await expect(decisionPage.locator('.approval-row')).toContainText('승인됨');
  } finally { await context.close(); }
  const issued = await capability(); expect(issued.status).toBe(200); const live = await issued.json();
  const approved = await (await api(alice, '/approvals?projectId=' + p.projectId, undefined, 'GET', policy)).json();
  const remaining = Date.parse(approved[0].expiresAt) - Date.now();
  expect(remaining).toBeGreaterThan(0); expect(remaining).toBeLessThanOrEqual(300000);
  await new Promise(resolve => setTimeout(resolve, remaining + 150));
  expect((await capability()).status).toBe(403);
  expect((await proxy({ sessionToken: await alice.token(), capabilityToken: live.token }, p.projectId, '/customers/1', 'PATCH')).status).toBe(403);
  await page.getByRole('button', { name: '승인 상태 새로고침', exact: true }).click(); await expect(page.locator('.approval-row')).toContainText('만료됨');
});
test('Q: preview capability never selects live upstream', async ({ accounts }) => {
  const alice = await accounts('alice'); const p = await project(alice); const session = await preview(alice, p.projectId);
  for (const path of ['/customers', '/customers?env=live', '/customers?upstream=live']) {
    const response = await proxy(session, p.projectId, path); expect(response.status).toBe(200);
    const data = await response.json(); expect(data.dataset).toBe('preview'); expect(JSON.stringify(data).includes('live-only')).toBe(false);
  }
  for (const path of ['/live/customers', '/%2e%2e/live/customers']) expect((await proxy(session, p.projectId, path)).ok).toBe(false);
});
test.describe('R isolated serial mutation', () => {
  test.describe.configure({ mode: 'serial' });
  test('R: short-token renewal preserves a pending build; disabled bob cannot refresh or use expired access', async ({ browser }, testInfo) => {
    // User API authentication binds azp to toi-studio, so a separate client cannot
    // exercise this boundary. Serialize the shared-client fallback and restore explicitly.
    expect(testInfo.config.workers).toBe(1);
    const [client] = await admin('/clients?clientId=toi-studio');
    const [bob] = await admin('/users?username=bob&exact=true');
    const ttlKey = 'access.token.lifespan'; const originalTtl = client.attributes?.[ttlKey];
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      await admin('/clients/' + client.id, { ...client, attributes: { ...client.attributes, [ttlKey]: '4' } });
      const identity = await login(browser, 'bob', 4);
      context = await browser.newContext({ storageState: identity.state });
      const page = await context.newPage();
      let delayed = false; let successfulRenewals = 0; let waits = 0;
      let latest = identity.raw;
      // Delay the first real renewal beyond the old token's expiry, then let
      // Keycloak issue a fresh token. This must not remount the pending workspace.
      await page.route(issuer + '/protocol/openid-connect/token', async route => {
        const form = new URLSearchParams(route.request().postData() ?? '');
        if (form.get('grant_type') === 'refresh_token' && !delayed) {
          delayed = true; await new Promise(resolve => setTimeout(resolve, 4500));
        }
        await route.continue();
      });
      page.on('response', async response => {
        if (response.url() !== issuer + '/protocol/openid-connect/token' || !response.ok()) return;
        const form = new URLSearchParams(response.request().postData() ?? '');
        const value = await response.json().catch(() => undefined);
        if (value) { latest = value; if (form.get('grant_type') === 'refresh_token') successfulRenewals++; }
      });
      await page.route('http://localhost:7100/package-sets', route => route.fulfill({ status: 202, json: { status: 'building', artifactKey: 'qa-refresh', startedAt: new Date().toISOString() } }));
      await page.route('http://localhost:7100/package-sets/qa-refresh/wait?timeoutMs=30000', () => { waits++; });
      await page.goto(studio); await page.getByRole('button', { name: '프로젝트 만들기' }).click();
      await expect.poll(() => waits).toBe(1);
      const controller = await page.evaluateHandle(() => (window as any).studio);
      const before = await snapshot(page);
      await expect.poll(() => successfulRenewals, { timeout: 20000 }).toBeGreaterThanOrEqual(2);
      expect(await page.evaluate(saved => saved === (window as any).studio, controller)).toBe(true);
      expect(waits).toBe(1);
      expect((await snapshot(page)).project.projectId).toBe(before.project.projectId);
      await expect(page.getByRole('status')).toContainText('처음 사용하는 구성 요소');
      await controller.dispose(); await context.close(); context = undefined;

      await admin('/users/' + bob.id, { enabled: false });
      const refreshed = await fetch(issuer + '/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'toi-studio', refresh_token: latest.refresh_token }) });
      expect(refreshed.ok).toBe(false);
      const claims = JSON.parse(Buffer.from(latest.access_token.split('.')[1], 'base64url').toString());
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(4);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, claims.exp * 1000 - Date.now()) + 1200));
      const denied = await fetch(agent + '/projects/disabled-account-check', { headers: { Origin: studio, Authorization: 'Bearer ' + latest.access_token } });
      expect(denied.status).toBe(401);
    } finally {
      try { await context?.close(); await admin('/users/' + bob.id, { enabled: bob.enabled }); const restoredBob = await admin('/users/' + bob.id); expect(restoredBob.enabled).toBe(bob.enabled); }
      finally {
        // Keycloak merges attribute maps: omission does not delete a temporary key.
        await admin('/clients/' + client.id, { ...client, attributes: { ...client.attributes, [ttlKey]: originalTtl ?? null } });
        const restored = await admin('/clients/' + client.id);
        expect(restored.attributes?.[ttlKey] ?? null).toBe(originalTtl ?? null);
      }
    }
  });
});
test('S: iframe globals/storage/messages/URLs contain no Keycloak token', async ({ page }) => {
  const identityTokens = new Set<string>();
  page.on('response', async response => {
    if (response.url() === issuer + '/protocol/openid-connect/token' && response.ok()) { const value = await response.json().catch(() => ({})); for (const key of ['access_token', 'refresh_token', 'id_token']) if (typeof value[key] === 'string') identityTokens.add(value[key]); }
  });
  await page.addInitScript(() => { const messages: unknown[] = []; Object.assign(globalThis, { __receivedMessages: messages }); addEventListener('message', event => messages.push(event.data)); });
  await page.goto('/'); await page.getByRole('button', { name: '프로젝트 만들기' }).click();
  await expect.poll(async () => (await snapshot(page))?.lastCommit?.token.revision).toBe(1);
  expect(identityTokens.size > 0).toBe(true);
  const frameMarkup = await page.locator('#preview iframe').evaluate(element => element.outerHTML);
  expect([...identityTokens].some(token => frameMarkup.includes(token))).toBe(false);
  const result = await page.frameLocator('#preview iframe').locator('body').evaluate(() => {
    const visited = new WeakSet<object>(); const strings: string[] = []; let count = 0;
    function collect(value: unknown, depth = 0) {
      if (typeof value === 'string') { strings.push(value); return; }
      if (!value || typeof value !== 'object' || depth > 5 || visited.has(value) || ++count > 30000) return;
      visited.add(value);
      try { for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if ('value' in descriptor) collect(descriptor.value, depth + 1); } catch { /* Cross-origin platform objects are inaccessible. */ }
    }
    collect(globalThis); collect({ ...localStorage }); collect({ ...sessionStorage }); strings.push(location.href);
    const config = (globalThis as any).__TOI_FETCH_CONFIG__;
    return { strings, config };
  });
  // Compare in the Node worker: the test itself never sends an identity token into a frame.
  expect(result.strings.some(value => [...identityTokens].some(token => value.includes(token)))).toBe(false);
  expect(Object.keys(result.config).sort()).toEqual(['env', 'projectId', 'transport']);
  const studioState = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage, snapshot: (window as any).studio.getSnapshot() }));
  expect([...identityTokens].some(token => studioState.includes(token))).toBe(false);
});

const revokedNotice = '이 프로젝트에 접근할 수 없어요. 멤버에서 제거되었거나 권한이 바뀌었을 수 있어요';
test('AI: removed bob sees access revoked on broker query and periodic check without preview requests', async ({ browser, accounts }, testInfo) => {
  const alice = await accounts('alice'), bob = await accounts('bob');
  const p = await project(alice);
  expect((await api(alice, `/projects/${p.projectId}/members/${bob.sub}`, { role: 'editor' }, 'PUT')).status).toBe(200);
  const updated = await api(alice, `/projects/${p.projectId}/source`, { baseRevision: p.revision, files: { ...p.files, ...mockFiles('고객 목록', '멤버 제거 확인 테스트') } }, 'PUT');
  expect(updated.status).toBe(200);
  const context = await browser.newContext({ storageState: bob.state, viewport: { width: 1600, height: 1000 } });
  try {
    const idle = await context.newPage(); let idleQueries = 0, membershipChecks = 0;
    idle.on('request', request => { if (request.url().includes('/proxy/')) idleQueries++; if (request.url().endsWith('/membership')) membershipChecks++; });
    await idle.goto(studio + '/?project=' + p.projectId);
    await expect(idle.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
    await expect.poll(async () => (await snapshot(idle))?.lastCommit?.token.revision).toBe(2);
    const query = await context.newPage(); await query.goto(studio + '/?project=' + p.projectId);
    await expect(query.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
    await expect.poll(async () => (await snapshot(query))?.lastCommit?.token.revision).toBe(2);
    await expect(query.getByLabel('만들고 싶은 화면')).toBeEnabled();
    const frame = query.frameLocator('#preview iframe');
    await frame.getByRole('button', { name: '조회', exact: true }).click();
    await expect(frame.getByRole('cell', { name: 'C001', exact: true })).toBeVisible();
    const beforeChecks = membershipChecks;
    expect((await api(alice, `/projects/${p.projectId}/members/${bob.sub}`, {}, 'DELETE')).status).toBe(200);
    const denied = query.waitForResponse(response => response.url().includes('/proxy/customers') && response.status() === 404);
    await frame.getByRole('button', { name: '조회', exact: true }).click();
    expect((await (await denied).json()).error).toBe('PROJECT_NOT_FOUND');
    for (const view of [query, idle]) {
      await expect(view.locator('.access-notice[role="alert"]')).toContainText(revokedNotice, { timeout: 40000 });
      await expect(view.locator('#preview iframe')).toHaveCount(0);
      await expect(view.getByText('조건에 맞는 고객이 없어요', { exact: true })).toHaveCount(0);
      await expect(view.getByLabel('만들고 싶은 화면')).toBeDisabled();
      await expect(view.getByLabel('소스 코드')).toBeDisabled();
      await expect(view.getByRole('button', { name: '저장하고 반영' })).toBeDisabled();
      await expect(view.getByRole('checkbox', { name: '쓰기 테스트 허용' })).toBeDisabled();
    }
    expect(idleQueries).toBe(0); expect(membershipChecks).toBeGreaterThan(beforeChecks);
    if (testInfo.repeatEachIndex === 0) { await mkdir('artifacts/f5/shots', { recursive: true }); await query.screenshot({ path: 'artifacts/f5/shots/removed-member-after.png', fullPage: true }); await idle.screenshot({ path: 'artifacts/f5/shots/removed-member-periodic-after.png', fullPage: true }); }
    await query.evaluate(projectId => {
      sessionStorage.setItem(`toi-studio-generation-v1:${projectId}`, '{}');
      sessionStorage.setItem(`toi-studio-backups-v1:${projectId}`, '[]');
    }, p.projectId);
    await query.getByRole('button', { name: '처음 화면으로', exact: true }).click();
    await expect(query.getByRole('button', { name: '프로젝트 만들기', exact: true })).toBeVisible();
    expect(await query.evaluate(projectId => [sessionStorage.getItem(`toi-studio-generation-v1:${projectId}`), sessionStorage.getItem(`toi-studio-backups-v1:${projectId}`)], p.projectId)).toEqual([null, null]);
  } finally { await context.close(); }
});
test('AJ: viewer download panel explains role restriction with aria-describedby', async ({ browser, accounts }, testInfo) => {
  const alice = await accounts('alice'), bob = await accounts('bob'), p = await project(alice);
  expect((await api(alice, `/projects/${p.projectId}/members/${bob.sub}`, { role: 'viewer' }, 'PUT')).status).toBe(200);
  const context = await browser.newContext({ storageState: bob.state, viewport: { width: 1600, height: 1000 } });
  try {
    const view = await context.newPage(); await view.goto(studio + '/?project=' + p.projectId);
    await expect(view.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
    await expect.poll(async () => (await snapshot(view))?.lastCommit?.token.revision).toBe(1);
    await view.getByText('암호화 다운로드', { exact: true }).click();
    await view.getByLabel('다운로드 사유').fill('viewer 다운로드 권한 확인');
    const button = view.getByRole('button', { name: '암호화 파일 만들기', exact: true });
    const reason = '암호화 다운로드는 editor 이상만 할 수 있어요. 프로젝트 owner에게 권한을 요청하세요.';
    await expect(button).toBeDisabled(); await expect(button).toHaveAccessibleDescription(reason);
    const id = await button.getAttribute('aria-describedby'); expect(id).toBeTruthy();
    await expect(view.locator(`[id="${id}"]`)).toBeVisible();
    await expect(view.locator('.access-notice')).toContainText('암호화 다운로드');
    if (testInfo.repeatEachIndex === 0) { await mkdir('artifacts/f5/shots', { recursive: true }); await view.screenshot({ path: 'artifacts/f5/shots/viewer-download-after.png', fullPage: true }); }
  } finally { await context.close(); }
});
