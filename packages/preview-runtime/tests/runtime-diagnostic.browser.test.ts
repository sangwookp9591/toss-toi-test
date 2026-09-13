import { test, expect, type Page } from './browser-fixture.ts';

async function open(page: Page) {
  await page.goto('/?manual');
  await page.evaluate(() => window.demo.ready);
}

async function buildFiles(page: Page, files: Record<string, string>, imports?: Record<string, string>) {
  return page.evaluate(async ({ files, imports }) => {
    const modulePath = '/runtime.js';
    const { sourceDigest, digestJson } = await import(modulePath);
    const input = await window.demo.prepare('');
    input.layers = { user: files };
    input.token.sourceDigest = await sourceDigest(files);
    if (imports) {
      input.manifest = structuredClone(input.manifest);
      Object.assign(input.manifest.importMap.imports, imports);
      input.token.manifestDigest = await digestJson(input.manifest);
    }
    window.demo.runtime.setDesiredRevision(input.token);
    return window.demo.runtime.build(input);
  }, { files, imports });
}

for (const newline of ['\n', '\r\n']) {
  test(`sync throw maps App source after comments and ${JSON.stringify(newline)}`, async ({ page }) => {
    await open(page);
    const result = await buildFiles(page, {
      '/src/main.tsx': "import './App';",
      '/src/App.tsx': ['', '// preserved line count', '/* another comment */', "throw new Error('x');"].join(newline),
    });
    expect(result).toMatchObject({ type: 'runtime_failed', error: { message: 'x', file: '/src/App.tsx', line: 4, column: 6 } });
  });
}

test('React render failure maps App instead of React internals and keeps the previous screen', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.demo.run("document.getElementById('root')!.textContent = 'Keep';"));
  const result = await buildFiles(page, {
    '/src/main.tsx': "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />);",
    '/src/App.tsx': "// comment\nexport function App() {\n  throw new Error('render x');\n}",
  });
  expect(result).toMatchObject({ type: 'runtime_failed', error: { message: 'render x', file: '/src/App.tsx', line: 3, column: 8 } });
  await expect(page.frameLocator('iframe[data-state="committed"]').locator('#root')).toHaveText('Keep');
});

test('nested Table render failure returns the child file and nearest user frame', async ({ page }) => {
  await open(page);
  const result = await buildFiles(page, {
    '/src/main.tsx': "import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<App />);",
    '/src/App.tsx': "import { Table } from './Table'; export function App() { return <Table />; }",
    '/src/Table.tsx': "\n// child comment\nexport function Table() {\n  throw new Error('table x');\n}",
  });
  expect(result).toMatchObject({ type: 'runtime_failed', error: { message: 'table x', file: '/src/Table.tsx', line: 4, column: 8 } });
});

test('unhandled async rejection maps the original throw after await', async ({ page }) => {
  await open(page);
  const result = await buildFiles(page, {
    '/src/main.tsx': "import './App';",
    '/src/App.tsx': "async function fail() {\n  await Promise.resolve();\n  throw new Error('async x');\n}\nvoid fail();\nawait new Promise(resolve => setTimeout(resolve, 50));",
  });
  expect(result).toMatchObject({ type: 'runtime_failed', error: { message: 'async x', file: '/src/App.tsx', line: 3, column: 8 } });
});

test('errors originating only in an import-map external have no VFS location', async ({ page }) => {
  await open(page);
  const result = await buildFiles(page, { '/src/main.tsx': "import 'external';" }, {
    external: 'data:text/javascript,' + encodeURIComponent("throw new Error('external x');"),
  });
  expect(result).toMatchObject({ type: 'runtime_failed', error: { message: 'external x' } });
  if (result.type === 'runtime_failed') expect(Object.keys(result.error)).toEqual(['message']);
});

test('primitive rejection has no invented position', async ({ page }) => {
  await open(page);
  const result = await buildFiles(page, {
    '/src/main.tsx': "Promise.reject('primitive x'); await new Promise(resolve => setTimeout(resolve, 50));",
  });
  expect(result).toMatchObject({ type: 'runtime_failed', error: { message: 'primitive x' } });
  if (result.type === 'runtime_failed') expect(Object.keys(result.error)).toEqual(['message']);
});

test('successive revisions use their own maps and normalize build diagnostic paths', async ({ page }) => {
  await open(page);
  for (const line of [2, 8, 3]) {
    const result = await buildFiles(page, {
      '/src/main.tsx': "import './App';",
      '/src/App.tsx': '\n'.repeat(line - 1) + "throw new Error('revision x');",
    });
    expect(result).toMatchObject({ type: 'runtime_failed', error: { file: '/src/App.tsx', line, column: 6 } });
  }
  expect(await buildFiles(page, {
    '/src/main.tsx': "import './App';", '/src/App.tsx': 'const x = ;',
  })).toMatchObject({ type: 'build_failed', diagnostics: [expect.objectContaining({ file: '/src/App.tsx', line: 1 })] });
});

test('mapping stays in studio memory and never requests a map or transmits source text', async ({ page }) => {
  const loads: any[] = [];
  const errors: any[] = [];
  const requests: { url: string; body: string | null }[] = [];
  await page.exposeBinding('captureRuntimeMessage', (_, value) => {
    if (value.kind === 'load') loads.push(value);
    if (value.kind === 'error') errors.push(value);
  });
  await page.addInitScript(() => {
    window.addEventListener('message', event => {
      if (event.data?.kind === 'load' || event.data?.kind === 'error') {
        void (window as any).captureRuntimeMessage(event.data);
      }
    });
  });
  page.on('request', request => requests.push({ url: request.url(), body: request.postData() }));
  await open(page);
  const result = await buildFiles(page, {
    '/src/main.tsx': "import './App';",
    '/src/App.tsx': "// VFS_PRIVATE_SENTINEL_041\nthrow new Error('private x');",
  });
  expect(result).toMatchObject({ type: 'runtime_failed', error: { file: '/src/App.tsx', line: 2 } });
  expect(loads).toHaveLength(1);
  expect(loads[0]).not.toHaveProperty('map');
  expect(loads[0].code).not.toContain('sourceMappingURL');
  expect(loads[0].code).not.toContain('VFS_PRIVATE_SENTINEL_041');
  expect(errors).toHaveLength(1);
  expect(errors[0].stack).toContain('http://localhost:5173/__toi_preview__/');
  expect(errors[0].stack).not.toContain('data:text/javascript');
  expect(requests.every(request => new URL(request.url).origin === 'http://localhost:5173' || new URL(request.url).origin === 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5174')).toBe(true);
  expect(JSON.stringify(requests)).not.toMatch(/VFS_PRIVATE_SENTINEL_041|__toi_preview__|\.map(?:[?"/]|$)/);
});
