import { identity } from './identity-fixture.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { start, parseEvents, waitFor, question } from './helpers.ts';
import { sourceDigest } from '../src/digest.ts';
import { sourceDigest as previewDigest } from '../../../packages/preview-runtime/src/vfs.ts';
import { PolicyClient } from '../src/policy-client.ts';
import { MockDriver } from '../src/mock.ts';
import type { AgentContext, AgentDriver } from '../src/engine.ts';
const apps: Array<Awaited<ReturnType<typeof start>>> = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.cleanup(); });
const setup = async (driver?: AgentDriver, policy?: PolicyClient) => { const app = await start(driver, policy); apps.push(app); return app; };

it('same baseRevision concurrent writes have exactly one CAS winner', async () => {
  const app = await setup();
  const results = await Promise.all(['a', 'b'].map(content => app.request(`/projects/${app.project.projectId}/source`, { baseRevision: 1, files: { '/src/App.tsx': content } }, 'PUT')));
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  expect(await results.find(result => result.status === 409)!.json()).toEqual({ error: 'conflict', currentRevision: 2 });
  expect(app.store.project(app.project.projectId).revision).toBe(2);
});

it('requestId is idempotent and cannot be reused with different input', async () => {
  const app = await setup();
  const ids = await Promise.all([app.generate('same'), app.generate('same')]);
  expect(ids[0]).toBe(ids[1]);
  const different = await app.request('/generations', { projectId: app.project.projectId, baseRevision: 1, prompt: 'different', requestId: 'same' });
  expect(different.status).toBe(409);
});

it('mock question/answer + SSE reconnect replays without gaps or duplicates', async () => {
  const app = await setup(); const id = await app.generate();
  const abort = new AbortController();
  const response = await app.fetch(`${app.url}/generations/${id}/events`, { signal: abort.signal });
  const reader = response.body!.getReader(); const decoder = new TextDecoder(); let received = '';
  while (!parseEvents(received).some(event => event.type === 'question')) {
    const { value, done } = await reader.read(); if (done) throw new Error('closed before question'); received += decoder.decode(value, { stream: true });
  }
  const before = parseEvents(received); const last = before.at(-1)!.seq;
  abort.abort();
  const pending = await question(app, id);
  expect((await app.request(`/generations/${id}/answers`, { questionId: pending.questionId, answer: '예' })).status).toBe(204);
  const replay = await app.fetch(`${app.url}/generations/${id}/events`, { headers: { 'Last-Event-ID': String(last) } });
  const after = parseEvents(await replay.text());
  expect([...before, ...after].map(event => event.seq)).toEqual(app.store.generation(id).events.map(event => event.seq));
  expect(after.at(-1)?.type).toBe('done');
  expect(after.find(event => event.type === 'revision_ready')).toMatchObject({ revision: 2 });
  const saved = app.store.project(app.project.projectId);
  expect(saved.files['/src/App.tsx']).toContain('고객 문의 확인');
  expect(saved.revision).toBe(2);
  expect(parseEvents(await (await app.fetch(`${app.url}/generations/${id}/events`, { headers: { 'Last-Event-ID': String(app.store.generation(id).events.length) } })).text())).toEqual([]);
});

it('finish conflicts after concurrent editor save, without overwriting the editor', async () => {
  const app = await setup(); const id = await app.generate(); const pending = await question(app, id);
  await app.request(`/projects/${app.project.projectId}/source`, { baseRevision: 1, files: { '/src/App.tsx': 'editor wins' } }, 'PUT');
  await app.request(`/generations/${id}/answers`, { questionId: pending.questionId, answer: '예' });
  const events = parseEvents(await (await app.fetch(`${app.url}/generations/${id}/events`)).text());
  expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'conflict' });
  expect(events.some(event => event.type === 'revision_ready')).toBe(false);
  expect(app.store.project(app.project.projectId).files['/src/App.tsx']).toBe('editor wins');
});

it('cancel aborts a waiting question immediately, is idempotent and rejects late answers', async () => {
  const app = await setup(); const id = await app.generate(); const pending = await question(app, id);
  await app.request(`/generations/${id}/cancel`); await app.request(`/generations/${id}/cancel`);
  expect((await app.request(`/generations/${id}/answers`, { questionId: pending.questionId, answer: 'late' })).status).toBe(409);
  const events = parseEvents(await (await app.fetch(`${app.url}/generations/${id}/events`)).text());
  expect(events.at(-1)?.type).toBe('canceled'); expect(events.filter(event => event.type === 'canceled')).toHaveLength(1);
  expect(app.store.project(app.project.projectId).revision).toBe(1);
});

it('a late registry tool result and malicious late write/finish cannot save or emit after cancel', async () => {
  let release!: () => void; let started = false; let context!: AgentContext; let finished = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher: typeof fetch = async () => { started = true; await gate; return Response.json([]); };
  const driver: AgentDriver = { mode: 'claude', async run(ctx) { context = ctx; try { await ctx.tool('list_registered_apis', {}); } finally { finished = true; } } };
  const app = await setup(driver, new PolicyClient('http://fake', fetcher, 'test-session'));
  const id = await app.generate(); await waitFor(() => started);
  await app.request(`/generations/${id}/cancel`);
  const boundary = structuredClone(app.store.generation(id).events); release(); await waitFor(() => finished);
  await expect(context.tool('write_file', { path: '/src/late.ts', content: 'late' })).rejects.toThrow();
  await expect(context.tool('finish', { summary: 'late' })).rejects.toThrow();
  expect(context.signal.aborted).toBe(true);
  expect(app.store.generation(id).events).toEqual(boundary);
  expect(app.store.project(app.project.projectId).revision).toBe(1);
});

it('mock files use only allowed exact imports and match the browser source digest', async () => {
  const app = await setup(); const id = await app.generate(); const pending = await question(app, id);
  await app.request(`/generations/${id}/answers`, { questionId: pending.questionId, answer: '아니요' });
  await waitFor(() => app.store.generation(id).state === 'done');
  const project = app.store.project(app.project.projectId);
  for (const [path, source] of Object.entries(project.files)) {
    const result = await build({ stdin: { contents: source, sourcefile: path, loader: 'tsx' }, bundle: false, jsx: 'automatic', format: 'esm', write: false, metafile: true });
    for (const output of Object.values(result.metafile!.outputs)) {
      for (const item of output.imports) if (!item.path.startsWith('.')) expect(project.packageSet.entries).toContain(item.path);
    }
  }
  expect(sourceDigest(project.files)).toBe(await previewDigest(project.files));
  expect(sourceDigest({ '/b.ts': '한글', '/src/../a.ts': 'a' })).toBe(await previewDigest({ '/a.ts': 'a', '/b.ts': '한글' }));
  expect(app.store.generation(id).events.find(event => event.type === 'revision_ready')).toMatchObject({ sourceDigest: sourceDigest(project.files) });
});

it('rejects traversal and packages outside the approved catalog', async () => {
  let errors: string[] = [];
  const driver: AgentDriver = { mode: 'claude', async run(ctx) {
    for (const [name, args] of [['write_file', { path: '/src/../../secret', content: 'bad' }], ['request_packages', { packageSet: { entries: ['evil'], dependencies: { evil: '1' } } }]] as const) {
      try { await ctx.tool(name, args); } catch (error) { errors.push(String(error)); }
    }
    await ctx.tool('finish', { summary: 'validation checked' });
  } };
  const app = await setup(driver); const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'done');
  expect(errors).toHaveLength(2);
  expect(app.store.generation(id).events.some(event => event.type === 'packages_requested' || event.type === 'file')).toBe(false);
  expect((await app.request(`/projects/${app.project.projectId}/source`, { baseRevision: 2, files: { '/bad.ts': '' } }, 'PUT')).status).toBe(400);
});

it('persists source, idempotency and replay events across a restart; incomplete runs terminate', async () => {
  const first = await start(); const id = await first.generate('persisted'); await question(first, id);
  // Simulate a process disappearing without Engine.close canceling the generation.
  await new Promise<void>(resolve => first.server.close(() => resolve()));
  const second = await start(new MockDriver(1), undefined, first.directory); apps.push(second);
  const replay = parseEvents(await (await second.fetch(`${second.url}/generations/${id}/events`)).text());
  expect(replay.at(-1)).toMatchObject({ type: 'failed', code: 'internal' });
  expect(second.store.project(first.project.projectId).revision).toBe(1);
  expect(second.store.requestIds.get('persisted')).toBe(id);
  expect(JSON.parse(readFileSync(`${first.directory}/generations/${id}.json`, 'utf8')).events).toEqual(replay);
});

it('policy client obtains a service identity and retries once on 401', async () => {
  let sessions = 0; let firstRegistry = true; const seen: string[] = [];
  const fake = createServer(async (req, res) => {
    if (req.url === '/dev/session') { sessions++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ token: `session-${sessions}` })); return; }
    seen.push(req.headers.authorization ?? '');
    if (firstRegistry) { firstRegistry = false; res.writeHead(401).end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url === '/apis' ? [{ apiId: 'customers' }] : { apiId: 'customers' }));
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  try {
    const address = fake.address() as { port: number };
    const client = new PolicyClient(`http://127.0.0.1:${address.port}`, fetch, undefined, identity());
    expect(await client.get('/apis', new AbortController().signal)).toEqual([{ apiId: 'customers' }]);
    expect(await client.get('/apis/customers', new AbortController().signal)).toEqual({ apiId: 'customers' });
    expect(sessions).toBe(0); expect(seen).toHaveLength(3); for (const header of seen) expect((await identity().verify(header)).azp).toBe('toi-agent-server');
  } finally { await new Promise<void>(resolve => fake.close(() => resolve())); }
});

it('completed generations keep their exact replay and requestId after a clean restart', async () => {
  const first = await start(); const id = await first.generate('completed-persisted'); const pending = await question(first, id);
  await first.request(`/generations/${id}/answers`, { questionId: pending.questionId, answer: '예' });
  await waitFor(() => first.store.generation(id).state === 'done');
  const original = structuredClone(first.store.generation(id));
  await first.cleanup(false);
  const second = await start(new MockDriver(1), undefined, first.directory); apps.push(second);
  expect((await (await second.request('/generations', original.request)).json()).generationId).toBe(id);
  const replay = parseEvents(await (await second.fetch(`${second.url}/generations/${id}/events`, { headers: { 'Last-Event-ID': '4' } })).text());
  expect(replay).toEqual(original.events.filter(event => event.seq > 4));
  expect(second.store.project(first.project.projectId).revision).toBe(2);
});
