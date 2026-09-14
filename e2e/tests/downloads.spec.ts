import { test, expect, api, policy, policyDataDir, studio, required, type Account } from '../helpers/auth';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Objects } from '../../services/policy-proxy/src/objects';
import { previewOriginForProject } from '../../contracts/src/runtime';
// Reuse the policy service's pinned ZIP/XLSX readers without editing shared E2E dependencies.
const serviceRequire = createRequire(new URL('../../services/policy-proxy/package.json', import.meta.url));
const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = serviceRequire('@zip.js/zip.js');
const ExcelJS = serviceRequire('exceljs');
const objectStore = () => new S3Objects('http://localhost:9400', required('TOI_POLICY_MINIO_USER'), required('TOI_POLICY_MINIO_PASSWORD'), 'toi-downloads');
async function setup(alice: Account) {
  const p = await (await api(alice, '/projects', { name: 'Encrypted download verification', apiIds: ['customers'] })).json();
  const capability = await (await api(alice, '/capabilities', { projectId: p.projectId, mode: 'read', env: 'preview', ttlSec: 120 }, 'POST', policy)).json();
  return { projectId: p.projectId as string, capability: capability.token as string };
}
async function create(alice: Account, scope: Awaited<ReturnType<typeof setup>>, format = 'csv', origin = studio) {
  return fetch(policy + '/downloads', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + await alice.token(), 'Content-Type': 'application/json', 'X-Toi-Project': scope.projectId, 'X-Toi-Capability': scope.capability }, body: JSON.stringify({ projectId: scope.projectId, apiId: 'customers', path: '/customers?size=20', format, reason: 'Customer support export verification' }) });
}
async function fetchZip(account: Account, url: string) { return fetch(new URL(url, policy), { headers: { Origin: studio, Authorization: 'Bearer ' + await account.token() } }); }
async function inspect(zip: Uint8Array, password: string, format: string) {
  const reader = new ZipReader(new Uint8ArrayReader(zip), { useWebWorkers: false });
  try {
    const [entry] = await reader.getEntries();
    expect(entry.encrypted).toBe(true); expect(entry.extraFieldAES.strength).toBe(3); expect(entry.extraFieldAES.vendorVersion).toBe(2);
    let denied = false; try { await entry.getData(new Uint8ArrayWriter(), { password: 'wrong-password' }); } catch { denied = true; } expect(denied).toBe(true);
    let passwordRequired = false; try { await entry.getData(new Uint8ArrayWriter()); } catch { passwordRequired = true; } expect(passwordRequired).toBe(true);
    const data = Buffer.from(await entry.getData(new Uint8ArrayWriter(), { password }));
    let text = data.toString();
    if (format === 'xlsx') { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data); text = JSON.stringify(workbook.worksheets[0].getSheetValues()); }
    expect(text.includes('C001')).toBe(true); expect(text.includes('홍*동')).toBe(true); expect(text.includes('010-****-5678')).toBe(true);
    expect(text.includes('홍길동')).toBe(false); expect(text.includes('010-1000-5678')).toBe(false);
  } finally { await reader.close(); }
}
test('T: Alice CSV/XLSX are AES-256 AE-2; signature, sub, single-use and 60-second expiry enforced', async ({ accounts }) => {
  test.setTimeout(150000);
  const alice = await accounts('alice'), bob = await accounts('bob'), scope = await setup(alice);
  const expiring = await (await create(alice, scope)).json();
  for (const format of ['csv', 'xlsx']) {
    const response = await create(alice, scope, format); expect(response.status).toBe(201); const ticket = await response.json();
    expect(ticket.zipPassword.length >= 24).toBe(true);
    expect((await fetchZip(bob, ticket.url)).status).toBe(404);
    const forged = new URL(ticket.url, policy); forged.searchParams.set('sig', '0'.repeat(64)); expect((await fetchZip(alice, forged.href)).status).toBe(403);
    const fetched = await fetchZip(alice, ticket.url); expect(fetched.status).toBe(200); expect(fetched.headers.get('content-type')).toBe('application/zip');
    await inspect(new Uint8Array(await fetched.arrayBuffer()), ticket.zipPassword, format);
    expect((await fetchZip(alice, ticket.url)).status).toBe(410);
  }
  expect(Date.parse(expiring.expiresAt) - Date.now()).toBeLessThanOrEqual(60000);
  await new Promise(r => setTimeout(r, Math.max(0, Date.parse(expiring.expiresAt) - Date.now()) + 100));
  expect((await fetchZip(alice, expiring.url)).status).toBe(410);
});
test('U: viewer, nonmember and preview origin cannot create downloads', async ({ accounts }) => {
  const alice = await accounts('alice'), bob = await accounts('bob'), carol = await accounts('carol'), scope = await setup(alice);
  expect((await api(alice, '/projects/' + scope.projectId + '/members/' + bob.sub, { role: 'viewer' }, 'PUT')).status).toBe(200);
  expect((await create(bob, scope)).status).toBe(403); expect((await create(carol, scope)).status).toBe(404);
  expect((await create(alice, scope, 'csv', previewOriginForProject(scope.projectId))).status).toBe(403);
});
test('V: MinIO bytes hide row values and password; successful delivery deletes ciphertext and wrapped key', async ({ accounts }) => {
  const alice = await accounts('alice'), scope = await setup(alice), response = await create(alice, scope); expect(response.status).toBe(201); const ticket = await response.json();
  const objects = objectStore(), key = `downloads/${ticket.downloadId}.bin`, ciphertext = await objects.get(key);
  for (const value of ['C001', '홍길동', '홍*동', '010-1000-5678', ticket.zipPassword]) expect(ciphertext.includes(Buffer.from(value))).toBe(false);
  const fetched = await fetchZip(alice, ticket.url); expect(fetched.status).toBe(200); await fetched.arrayBuffer();
  await expect.poll(async () => (await objects.list('downloads/')).includes(key)).toBe(false);
  await expect.poll(async () => {
    const record = JSON.parse(await readFile(join(policyDataDir ?? fileURLToPath(new URL('../../services/policy-proxy/data', import.meta.url)), 'downloads', `${ticket.downloadId}.json`), 'utf8'));
    return record.wrappedDataKey === '' && record.fetchCount === 1;
  }).toBe(true);
});
test('W: audit verification is valid, seq remains continuous and audit contains no password, keys or signature', async ({ accounts }) => {
  const alice = await accounts('alice'), root = await accounts('root'), scope = await setup(alice);
  const before = await (await api(root, '/audit/verify', undefined, 'GET', policy)).json(); expect(before.ok).toBe(true);
  const ticket = await (await create(alice, scope)).json(); const fetched = await fetchZip(alice, ticket.url); await fetched.arrayBuffer();
  const afterResponse = await api(root, '/audit/verify', undefined, 'GET', policy); expect(afterResponse.status).toBe(200); const after = await afterResponse.json(); expect(after.ok).toBe(true); expect(after.lastSeq).toBeGreaterThan(before.lastSeq);
  const audit = await (await api(root, '/audit?limit=1000', undefined, 'GET', policy)).json();
  const added = audit.filter((r: {seq:number}) => r.seq > before.lastSeq && r.seq <= after.lastSeq);
  expect(added.map((r: {seq:number}) => r.seq)).toEqual(Array.from({ length: after.lastSeq - before.lastSeq }, (_, i) => before.lastSeq + i + 1));
  const text = JSON.stringify(audit);
  for (const secret of [ticket.zipPassword, new URL(ticket.url, policy).searchParams.get('sig')!, required('TOI_DOWNLOAD_KEK'), required('TOI_DOWNLOAD_URL_SECRET')]) expect(text.includes(secret)).toBe(false);
});
test('download UI shows password once, saves using Bearer and clears it on close', async ({ page, accounts }) => {
  const alice = await accounts('alice'), scope = await setup(alice);
  try {
  await page.goto('/?project=' + scope.projectId); await page.getByText('암호화 다운로드', { exact: true }).click();
  await page.getByLabel('다운로드 사유', { exact: true }).fill('Customer support UI download');
  await page.getByRole('button', { name: '암호화 파일 만들기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '다운로드 비밀번호' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '다운로드 비밀번호' })).toContainText('macOS 기본 압축 해제 도구로 열 수 없어요.');
  await expect(page.getByRole('dialog', { name: '다운로드 비밀번호' })).toContainText('7-Zip, Keka 또는 7z x');
  const password = await page.getByLabel('ZIP 비밀번호', { exact: true }).textContent(); expect((password?.length ?? 0) >= 24).toBe(true);
  const request = page.waitForRequest(r => /\/downloads\//.test(r.url()));
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'ZIP 저장', exact: true }).click();
  expect(Boolean((await request).headers().authorization?.startsWith('Bearer '))).toBe(true); await download;
  await page.getByRole('button', { name: '비밀번호 닫기', exact: true }).click(); await expect(page.getByLabel('ZIP 비밀번호', { exact: true })).toHaveCount(0);
  const leaked = await page.evaluate(value => [location.href, ...Object.values(localStorage), ...Object.values(sessionStorage)].some(item => String(item).includes(value!)), password); expect(leaked).toBe(false);
  } finally { await page.goto('about:blank'); }
});
