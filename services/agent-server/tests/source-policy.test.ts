import { afterEach, expect, it } from 'vitest';
import { assertSourcePolicy } from '../src/source-policy.ts';
import { templateFiles, mockFiles } from '../src/templates.ts';
import { start, waitFor } from './helpers.ts';

const forbidden = [
  ...['globalThis', 'window', 'self', 'top', 'parent', 'frames'].flatMap(global => [
    ['computed ' + global, `const network = ${global}['fet' + 'ch']; network('/unregistered')`],
    ['destructure ' + global, `const { fetch: network } = ${global}; network('/unregistered')`],
  ] as const),
  ['reflect global', `Reflect.get(globalThis, 'fet' + 'ch')('/unregistered')`],
  ['descriptor global', `Object.getOwnPropertyDescriptor(window, 'fetch').value('/unregistered')`],
  ['eval alias', `const execute = (0, eval); execute('danger')`],
  ['Function constructor', `new Function('return 1')`],
  ['dynamic import', `import('/' + 'unsafe.js')`],
  ['worker', `new Worker('/unsafe.js')`],
  ['destructuring assignment', `let network; ({ fetch: network } = window)`],
  ['raw fetch', "fetch('/proxy/customers')"],
  ['raw fetch with whitespace', "globalThis.fetch /* comment */ ('/proxy/customers')"],
  ['XMLHttpRequest', 'new XMLHttpRequest()'],
  ['WebSocket', "new WebSocket('/socket')"],
  ['EventSource', "new EventSource('/events')"],
  ['navigator.sendBeacon', "navigator . sendBeacon('/telemetry', 'data')"],
  ['http URL', "const endpoint = 'http://upstream.test/customers'"],
  ['https URL', 'const endpoint = `https://upstream.test/customers`'],
  ['/dev/session', "const path = '/dev/session'"],
  ['/capabilities', "const path = '/capabilities'"],
  ['/audit', "const path = '/audit'"],
  ['host config assignment', 'globalThis.__TOI_FETCH_CONFIG__ = {}'],
  ['host config compound assignment', 'globalThis.__TOI_FETCH_CONFIG__ ||= {}'],
  ['host config bracket assignment', "globalThis['__TOI_FETCH_CONFIG__'] = {}"],
  ['host config property assignment', "globalThis.__TOI_FETCH_CONFIG__.sessionToken = 'forged'"],
] as const;
const apps: Array<Awaited<ReturnType<typeof start>>> = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.cleanup(); });

it.each(forbidden)('rejects %s at HTTP save and finish without committing a revision', async (_label, content) => {
  const app = await start({ mode: 'mock', async run(ctx) {
    await ctx.tool('write_file', { path: '/src/unsafe.ts', content });
    await ctx.tool('finish', { summary: 'must fail' });
  } }); apps.push(app);
  const response = await app.request(`/projects/${app.project.projectId}/source`, { baseRevision: 1, files: { '/src/unsafe.ts': content } }, 'PUT');
  expect(response.status).toBe(400);
  const { error } = await response.json();
  expect(error).toContain('/src/unsafe.ts:');
  expect(error).toContain('forbidden');
  const id = await app.generate();
  await waitFor(() => app.store.generation(id).state === 'failed');
  expect(app.store.generation(id).events.at(-1)).toMatchObject({ type: 'failed', code: 'tool_error', message: error });
  expect(app.store.generation(id).events.some(event => event.type === 'revision_ready')).toBe(false);
  expect(app.store.project(app.project.projectId)).toMatchObject({ revision: 1, files: app.project.files });
});

it.each(['고객 목록 화면 만들어줘', '고객 상세', '고객 상태 변경'])('allows the normal template and mock: %s', async prompt => {
  const files = { ...templateFiles(), ...mockFiles(prompt, '고객 문의 확인') };
  expect(() => assertSourcePolicy(files)).not.toThrow();
  const app = await start(); apps.push(app);
  expect((await app.request(`/projects/${app.project.projectId}/source`, { baseRevision: 1, files }, 'PUT')).status).toBe(200);
});

it('allows toiFetch and host config reads/comparisons', () => {
  expect(() => assertSourcePolicy({ '/src/api.ts': "import { toiFetch } from '@toi/fetch'; const c = globalThis.__TOI_FETCH_CONFIG__; if (c === globalThis.__TOI_FETCH_CONFIG__) void toiFetch('customers', '/customers');" })).not.toThrow();
});
