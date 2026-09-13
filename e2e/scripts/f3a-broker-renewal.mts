// Supplemental real-browser check; credentials remain only in process memory.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { login, policy } from '../helpers/auth.ts';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const account = await login(browser, 'alice');
  const context = await browser.newContext({ baseURL: 'http://localhost:5173', storageState: account.state });
  const page = await context.newPage(); let issues = 0;
  await page.route(policy + '/preview-sessions', async route => {
    const response = await route.fetch(); const value = await response.json(); issues++;
    // Force only host expiry metadata into the past; the real JWTs stay untouched.
    if (issues === 1) { value.sessionClaims.exp = 1; value.capability.exp = 1; }
    await route.fulfill({ response, json: value });
  });
  await page.goto('/'); await page.getByRole('button', { name: '프로젝트 만들기' }).click();
  await page.locator('#preview iframe[data-state="committed"]').waitFor();
  const frame = (await (await page.locator('#preview iframe').elementHandle())!.contentFrame())!;
  const statuses = await frame.evaluate(() => Promise.all(Array.from({ length: 8 }, () => new Promise<number>((resolve, reject) => {
    const bridge = (globalThis as any).__TOI_FETCH_BRIDGE__; const requestId = crypto.randomUUID();
    const receive = (event: MessageEvent) => { if (event.source === parent && event.origin === bridge.parentOrigin && event.data?.requestId === requestId) { clearTimeout(timer); removeEventListener('message', receive); resolve(event.data.status); } };
    const timer = setTimeout(() => { removeEventListener('message', receive); reject(new Error('renewal check timed out')); }, 10000);
    addEventListener('message', receive);
    parent.postMessage({ kind: 'toi_fetch', token: bridge.token, requestId, apiId: 'customers', path: '/customers', method: 'GET', reason: 'Expired broker session renewal check' }, bridge.parentOrigin);
  }))));
  assert.deepEqual(statuses, Array(8).fill(200)); assert.equal(issues, 2);
  console.log(JSON.stringify({ initialSessionIssues: 1, sharedRenewalIssues: issues - 1, successfulConcurrentRequests: statuses.length }));
  await context.close();
} finally { await browser.close(); }
