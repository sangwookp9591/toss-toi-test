import { test, expect, type Page } from './browser-fixture.ts';
import type { Demo } from '../demo/main.ts';
declare global { interface Window { demo: Demo; testJobs: Record<string, Promise<unknown>> } }
const source = (text: string) => `import { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')!).render(<h1>${text}</h1>);`;
const plain = (text: string) => `document.getElementById('root')!.textContent = ${JSON.stringify(text)};`;
async function open(page: Page) {
  await page.goto('/?manual');
  await page.evaluate(() => window.demo.ready);
}
async function run(page: Page, code: string) { return page.evaluate(code => window.demo.run(code), code); }
async function runRevision(page: Page, code: string, revision: number) {
  return page.evaluate(async ({ code, revision }) => {
    const input = await window.demo.prepare(code, revision);
    window.demo.runtime.setDesiredRevision(input.token);
    return window.demo.runtime.build(input);
  }, { code, revision });
}
const committed = (page: Page) => page.frameLocator('iframe[data-state="committed"]');

test('first commit, edit commit and no COOP/COEP', async ({ page, request }) => {
  const response = await request.get('/');
  expect(response.headers()['cross-origin-opener-policy']).toBeUndefined();
  expect(response.headers()['cross-origin-embedder-policy']).toBeUndefined();
  await open(page);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  expect((await run(page, source('First'))).type).toBe('committed');
  await expect(committed(page).locator('h1')).toHaveText('First');
  expect((await run(page, source('Edited'))).type).toBe('committed');
  await expect(committed(page).locator('h1')).toHaveText('Edited');
  expect(await page.locator('iframe').count()).toBe(1);
});

test('syntax and runtime failures retain the same last successful iframe', async ({ page }) => {
  await open(page);
  await run(page, plain('Keep me'));
  const initial = await page.locator('iframe').getAttribute('title');
  const syntax = await run(page, 'const bad = ;');
  expect(syntax.type).toBe('build_failed');
  const runtime = await run(page, 'throw new Error("intentional runtime failure")');
  expect(runtime.type).toBe('runtime_failed');
  if (runtime.type === 'runtime_failed') expect(runtime.error.message).toContain('intentional runtime failure');
  await expect(committed(page).locator('#root')).toHaveText('Keep me');
  expect(await page.locator('iframe').getAttribute('title')).toBe(initial);
});

test('React render throw retains previous screen', async ({ page }) => {
  await open(page);
  await run(page, plain('Keep React failure'));
  const result = await run(page, `import { createRoot } from 'react-dom/client'; function Bad() { throw new Error('React exploded'); } createRoot(document.getElementById('root')!).render(<Bad />);`);
  expect(result.type).toBe('runtime_failed');
  await expect(committed(page).locator('#root')).toHaveText('Keep React failure');
});

test('r10 starts, r11 starts and succeeds, late successful r10 is discarded', async ({ page }) => {
  await open(page);
  await runRevision(page, plain('r9'), 9);
  await page.evaluate(async code => {
    const input = await window.demo.prepare(`await new Promise(resolve => setTimeout(resolve, 1600)); ${code}`, 10);
    window.demo.runtime.setDesiredRevision(input.token);
    window.testJobs = { r10: window.demo.runtime.build(input) };
  }, plain('r10'));
  await expect(page.locator('iframe[data-state="candidate"]')).toHaveCount(1);
  const r11 = await page.evaluate(async code => {
    const input = await window.demo.prepare(code, 11);
    window.demo.runtime.setDesiredRevision(input.token);
    return window.demo.runtime.build(input);
  }, plain('r11'));
  expect(r11.type).toBe('committed');
  expect(await page.evaluate(() => window.testJobs.r10)).toMatchObject({ type: 'stale_discarded', reason: 'superseded' });
  await expect(committed(page).locator('#root')).toHaveText('r11');
  expect(await page.evaluate(() => window.demo.events.filter(e => e.type === 'committed').map(e => e.token.revision))).toEqual([9, 11]);
});

test('failed r11 and late successful r10 leave r9 visible', async ({ page }) => {
  await open(page);
  await runRevision(page, plain('r9'), 9);
  await page.evaluate(async code => {
    const input = await window.demo.prepare(`await new Promise(resolve => setTimeout(resolve, 900)); ${code}`, 10);
    window.demo.runtime.setDesiredRevision(input.token);
    window.testJobs = { r10: window.demo.runtime.build(input) };
  }, plain('r10'));
  await expect(page.locator('iframe[data-state="candidate"]')).toHaveCount(1);
  expect((await runRevision(page, 'throw new Error("r11 fails")', 11)).type).toBe('runtime_failed');
  expect(await page.evaluate(() => window.testJobs.r10)).toMatchObject({ type: 'stale_discarded' });
  await expect(committed(page).locator('#root')).toHaveText('r9');
});

test('cancel followed by late successful execution is discarded', async ({ page }) => {
  await open(page);
  await run(page, plain('Keep canceled'));
  await page.evaluate(async code => {
    const input = await window.demo.prepare(`await new Promise(resolve => setTimeout(resolve, 600)); ${code}`);
    window.demo.runtime.setDesiredRevision(input.token);
    window.testJobs = { canceled: window.demo.runtime.build(input) };
    window.demo.runtime.cancel(input.token);
  }, plain('Canceled screen'));
  expect(await page.evaluate(() => window.testJobs.canceled)).toMatchObject({ type: 'stale_discarded', reason: 'canceled' });
  await expect(committed(page).locator('#root')).toHaveText('Keep canceled');
});

test('only exact allowlist imports pass, including generated JSX imports', async ({ page }) => {
  await open(page);
  await run(page, plain('Keep imports'));
  for (const specifier of ['react/not-allowed', 'lodash', 'https://example.com/evil.js']) {
    const result = await run(page, `import x from '${specifier}'; console.log(x);`);
    expect(result).toMatchObject({ type: 'build_failed', diagnostics: [expect.objectContaining({ message: `package not in package set: ${specifier}` })] });
  }
  await expect(committed(page).locator('#root')).toHaveText('Keep imports');
});

test('manifest and source digest mismatches are rejected', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const input = await window.demo.prepare('');
    input.token.manifestDigest = 'bad';
    window.demo.runtime.setDesiredRevision(input.token);
    return window.demo.runtime.build(input);
  });
  expect(result).toMatchObject({ type: 'stale_discarded', reason: 'manifest_mismatch' });
  expect(await page.locator('iframe').count()).toBe(0);
  const badSource = await page.evaluate(async () => {
    const input = await window.demo.prepare('');
    input.token.sourceDigest = 'bad';
    window.demo.runtime.setDesiredRevision(input.token);
    return window.demo.runtime.build(input);
  });
  expect(badSource).toMatchObject({ type: 'build_failed', diagnostics: [{ message: 'source digest does not match merged VFS' }] });
});

test('forged messages from wrong origin or source cannot commit a candidate', async ({ page }) => {
  await open(page);
  await run(page, plain('Trusted'));
  await page.evaluate(async () => {
    const input = await window.demo.prepare('await new Promise(() => {});');
    window.demo.runtime.setDesiredRevision(input.token);
    window.testJobs = { spoof: window.demo.runtime.build(input) };
    Object.assign(window, { spoofToken: input.token });
  });
  await expect(page.locator('iframe[data-state="candidate"]')).toHaveCount(1);
  await page.evaluate(() => {
    const data = { kind: 'rendered', token: (window as any).spoofToken, bootMs: 1 };
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-state="candidate"]')!;
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame.contentWindow, data }));
    window.dispatchEvent(new MessageEvent('message', { origin: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5174', source: window, data }));
  });
  await expect(committed(page).locator('#root')).toHaveText('Trusted');
  await expect(page.locator('iframe[data-state="candidate"]')).toHaveCount(1);
  await page.evaluate(() => window.demo.runtime.dispose());
  expect(await page.evaluate(() => window.testJobs.spoof)).toMatchObject({ type: 'stale_discarded', reason: 'canceled' });
});

test('merged VFS extension/index resolution and changed external set use the retained context', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const modulePath = '/runtime.js';
    const { mergeVfs, sourceDigest, digestJson } = await import(modulePath);
    const input = await window.demo.prepare("import { message } from './nested'; document.getElementById('root')!.textContent = message;");
    input.layers.template = { '/src/nested/index.ts': "export { message } from '../message';", '/src/message.ts': "export const message = 'template';" };
    input.layers.project = { '/src/message.ts': "export const message = 'project';" };
    input.layers.user!['/src/message.ts'] = "export const message = 'user wins';";
    input.token.sourceDigest = await sourceDigest(mergeVfs(input.layers));
    window.demo.runtime.setDesiredRevision(input.token);
    const built = await window.demo.runtime.build(input);
    const changed = await window.demo.prepare("import { createRoot } from 'react-dom/client'; console.log(createRoot);");
    changed.manifest = structuredClone(changed.manifest);
    delete changed.manifest.importMap.imports['react-dom/client'];
    changed.token.manifestDigest = await digestJson(changed.manifest);
    window.demo.runtime.setDesiredRevision(changed.token);
    return { built, changed: await window.demo.runtime.build(changed) };
  });
  expect(result.built.type).toBe('committed');
  expect(result.changed).toMatchObject({ type: 'build_failed', diagnostics: [expect.objectContaining({ message: 'package not in package set: react-dom/client' })] });
  await expect(committed(page).locator('#root')).toHaveText('user wins');
});

test('frame construction preserves closing-script strings and Unicode', async ({ page }) => {
  await open(page);
  const value = '</script><script>throw new Error("injected")</script> 한글 🐳';
  expect((await run(page, plain(value))).type).toBe('committed');
  await expect(committed(page).locator('#root')).toHaveText(value);
});

test('host config is credential-free, frozen and rejects legacy token fields', async ({ page }) => {
  await open(page);
  const results = await page.evaluate(async () => {
    const input = await window.demo.prepare("document.getElementById('root')!.textContent = 'safe</script>한글';");
    input.hostConfig = { toiFetch: { transport: 'broker', projectId: input.token.projectId, env: 'preview' } };
    window.demo.runtime.setDesiredRevision(input.token);
    const good = await window.demo.runtime.build(input);
    (input.hostConfig.toiFetch as any).sessionToken = 'synthetic-legacy';
    const bad = await window.demo.runtime.build(input);
    return [good.type, bad.type];
  });
  expect(results).toEqual(['committed', 'runtime_failed']);
  await expect(committed(page).locator('#root')).toHaveText('safe</script>한글');
  expect(await committed(page).locator('#root').evaluate(() => {
    const config = (globalThis as any).__TOI_FETCH_CONFIG__;
    return { frozen: Object.isFrozen(config), keys: Object.keys(config).sort() };
  })).toEqual({ frozen: true, keys: ['env', 'projectId', 'transport'] });
});

test('no host config creates no fetch global, including after a configured build', async ({ page }) => {
  await open(page);
  const results = await page.evaluate(async () => {
    const code = "document.getElementById('root')!.textContent = typeof (globalThis as any).__TOI_FETCH_CONFIG__;";
    const input = await window.demo.prepare(code);
    window.demo.runtime.setDesiredRevision(input.token);
    const first = await window.demo.runtime.build(input);
    input.hostConfig = { toiFetch: { transport: 'broker', projectId: input.token.projectId, env: 'preview' } };
    const configured = await window.demo.runtime.build(input);
    delete input.hostConfig;
    const absent = await window.demo.runtime.build(input);
    return [first.type, configured.type, absent.type];
  });
  expect(results).toEqual(['committed', 'committed', 'committed']);
  await expect(committed(page).locator('#root')).toHaveText('undefined');
  expect(await committed(page).locator('#root').evaluate(() => Object.hasOwn(globalThis, '__TOI_FETCH_CONFIG__'))).toBe(false);
});

test('replacing only hostConfig with the same revision token commits the new config', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const input = await window.demo.prepare("document.getElementById('root')!.textContent = (globalThis as any).__TOI_FETCH_CONFIG__.env;");
    input.hostConfig = { toiFetch: { transport: 'broker', projectId: input.token.projectId, env: 'preview' } };
    const token = { ...input.token };
    window.demo.runtime.setDesiredRevision(token);
    const first = await window.demo.runtime.build(input);
    input.hostConfig.toiFetch = { ...input.hostConfig.toiFetch!, env: 'live' };
    const second = await window.demo.runtime.build(input);
    return { first, second, token, finalToken: input.token };
  });
  expect(result.first.type).toBe('committed');
  expect(result.second.type).toBe('committed');
  expect(result.finalToken).toEqual(result.token);
  expect(result.first.token).toEqual(result.second.token);
  await expect(committed(page).locator('#root')).toHaveText('live');
  expect(await page.locator('iframe').count()).toBe(1);
});

test('boot timeout retains previous iframe and dispose settles a build during input preparation', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const modulePath = '/runtime.js';
    const { createPreviewRuntime } = await import(modulePath);
    window.demo.runtime.dispose();
    const runtime = createPreviewRuntime({ container: document.querySelector('#preview'), previewOrigin: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5174', frameUrl: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5174/frame.html', esbuildWasmUrl: new URL('/esbuild.wasm', location.origin).href, entry: '/src/main.tsx', bootTimeoutMs: 1000 });
    const initial = await window.demo.prepare("document.getElementById('root')!.textContent = 'Before timeout';");
    runtime.setDesiredRevision(initial.token);
    const first = await runtime.build(initial);
    const hanging = await window.demo.prepare('await new Promise(() => {});');
    runtime.setDesiredRevision(hanging.token);
    const timeout = await runtime.build(hanging);
    return { first, timeout };
  });
  expect(result.first.type).toBe('committed');
  expect(result.timeout).toMatchObject({ type: 'runtime_failed', error: { message: 'Preview boot timed out' } });
  await expect(committed(page).locator('#root')).toHaveText('Before timeout');
  const disposed = await page.evaluate(async () => {
    const modulePath = '/runtime.js';
    const { createPreviewRuntime } = await import(modulePath);
    const runtime = createPreviewRuntime({ container: document.createElement('div'), previewOrigin: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5174', frameUrl: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5174/frame.html', esbuildWasmUrl: new URL('/esbuild.wasm', location.origin).href, entry: '/src/main.tsx' });
    const input = await window.demo.prepare('');
    runtime.setDesiredRevision(input.token);
    const pending = runtime.build(input);
    runtime.dispose();
    return pending;
  });
  expect(disposed).toMatchObject({ type: 'stale_discarded', reason: 'canceled' });
});

test('navigation removes committed documents, restores a fresh good frame and stops at three per minute', async ({ page }) => {
  await open(page); await run(page, plain('Safe revision'));
  await run(page, plain('Navigating revision'));
  const first = (await (await page.locator('iframe[data-state="committed"]').elementHandle())!.contentFrame())!;
  await first.evaluate(() => { setTimeout(() => { location.href = location.href; }, 50); });
  await expect.poll(() => first.isDetached()).toBe(true);
  await expect(committed(page).locator('#root')).toHaveText('Safe revision');
  for (let i = 0; i < 2; i++) {
    const current = (await (await page.locator('iframe[data-state="committed"]').elementHandle())!.contentFrame())!;
    await current.evaluate(() => { setTimeout(() => { location.href = location.href; }, 50); });
    await expect.poll(() => current.isDetached()).toBe(true);
    if (i === 0) await expect(committed(page).locator('#root')).toHaveText('Safe revision');
  }
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('recovery limit reached');
});

test('CSP rejects data and blob script modules while nonce inline code executes', async ({ page }) => {
  await open(page); await run(page, plain('Nonce module'));
  const blocked = await committed(page).locator('#root').evaluate(async () => {
    const blob = URL.createObjectURL(new Blob(['globalThis.injected = true'], { type: 'text/javascript' }));
    try {
      return await Promise.all(['data:text/javascript,globalThis.injected=true', blob].map(url => import(url).then(() => false, () => true)));
    } finally { URL.revokeObjectURL(blob); }
  });
  expect(blocked).toEqual([true, true]);
  expect(await committed(page).locator('#root').evaluate(() => (globalThis as any).injected)).toBeUndefined();
  await expect(committed(page).locator('#root')).toHaveText('Nonce module');
});
