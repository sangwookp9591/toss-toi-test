import { afterEach, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { start, question, waitFor, parseEvents } from './helpers.ts';

type App = Awaited<ReturnType<typeof start>>;
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.cleanup(); });
async function setup(studioOrigin?: string) {
  const app = await start(undefined, undefined, undefined, studioOrigin);
  apps.push(app);
  return app;
}
function snapshot(app: App) {
  return {
    projects: structuredClone([...app.store.projects]),
    generations: structuredClone([...app.store.generations]),
    requestIds: [...app.store.requestIds],
    files: ['projects', 'generations'].flatMap(kind => readdirSync(join(app.directory, kind)).sort().map(name => {
      const path = join(app.directory, kind, name);
      return { path, data: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs };
    })),
  };
}
async function targets(app: App) {
  const id = await app.generate();
  const pending = await question(app, id);
  return [
    { method: 'POST', path: '/projects', body: { name: 'unwanted', apiIds: ['customers'] } },
    { method: 'PUT', path: `/projects/${app.project.projectId}/source`, body: { baseRevision: 1, files: { '/src/App.tsx': 'unwanted' } } },
    { method: 'POST', path: '/generations', body: { projectId: app.project.projectId, baseRevision: 1, prompt: 'unwanted', requestId: 'unwanted' } },
    { method: 'POST', path: `/generations/${id}/answers`, body: { questionId: pending.questionId, answer: 'yes' } },
    { method: 'POST', path: `/generations/${id}/cancel`, body: {} },
    { method: 'GET', path: `/projects/${app.project.projectId}` },
    { method: 'GET', path: `/projects/${app.project.projectId}/generations/active` },
    { method: 'GET', path: `/generations/${id}/events` },
  ];
}

it.each(['http://localhost:5174', 'null', 'https://unknown.example', '', 'http://localhost:5173.evil.example', 'http://127.0.0.1:5173'])(
  'rejects Origin %j for every protected route without changing storage or events', async origin => {
    const app = await setup();
    const routes = await targets(app);
    const before = snapshot(app);
    for (const target of routes) {
      // Both JSON/preflighted writes and the original text/plain simple request must fail.
      for (const contentType of ['application/json', 'text/plain']) {
        const response = await app.fetch(app.url + target.path, {
          method: target.method, headers: { Origin: origin, 'Content-Type': contentType },
          ...(target.body === undefined ? {} : { body: JSON.stringify(target.body) }),
        });
        expect(response.status, target.path).toBe(403);
        expect(response.headers.has('access-control-allow-origin')).toBe(false);
        expect(await response.json()).toEqual({ error: 'origin forbidden' });
        expect(snapshot(app)).toEqual(before);
      }
    }
    // Rejection precedes URL decoding, resource lookup and JSON parsing.
    for (const path of ['/projects/%zz/source', '/generations/missing/cancel', '/unknown']) {
      expect((await app.fetch(app.url + path, { method: 'POST', headers: { Origin: origin }, body: '{' })).status).toBe(403);
    }
    expect((await app.fetch(app.url + '/generations', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } })).status).toBe(403);
    expect((await app.fetch(app.url + '/healthz', { headers: { Origin: origin } })).status).toBe(200);
    expect(snapshot(app)).toEqual(before);
  },
);

it.each([undefined, 'http://localhost:5173'])('requires JSON on every mutation for allowed Origin %j', async origin => {
  const app = await setup();
  const routes = (await targets(app)).filter(target => target.method !== 'GET');
  const before = snapshot(app);
  for (const target of routes) {
    for (const contentType of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonp']) {
      const headers = new Headers();
      if (origin !== undefined) headers.set('Origin', origin);
      if (contentType !== undefined) headers.set('Content-Type', contentType);
      // Buffer prevents fetch from implicitly adding text/plain when testing an absent header.
      const response = await app.fetch(app.url + target.path, { method: target.method, headers, body: Buffer.from(JSON.stringify(target.body)) });
      expect(response.status, `${target.method} ${target.path}: ${contentType}`).toBe(415);
      expect(snapshot(app)).toEqual(before);
    }
  }
});

it.each([undefined, 'http://localhost:5173'])('preserves projects, generation, answers, cancel and SSE for allowed Origin %j', async origin => {
  const app = await setup();
  const headers = new Headers({ 'Content-Type': 'Application/JSON; charset=utf-8' });
  if (origin !== undefined) headers.set('Origin', origin);
  const request = (path: string, method = 'GET', body?: unknown) => app.fetch(app.url + path, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const preflight = await request('/generations', 'OPTIONS');
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe(origin ?? null);
  if (origin) expect(preflight.headers.get('access-control-allow-headers')).toContain('Content-Type');
  const created = await request('/projects', 'POST', { name: 'allowed', apiIds: ['customers'] });
  expect(created.status).toBe(201);
  const project = await created.json();
  expect((await request(`/projects/${project.projectId}`)).status).toBe(200);
  expect((await request(`/projects/${project.projectId}/source`, 'PUT', { baseRevision: 1, files: project.files })).status).toBe(200);
  const generate = async () => {
    const current = app.store.project(project.projectId);
    const response = await request('/generations', 'POST', { projectId: project.projectId, baseRevision: current.revision, prompt: '고객 목록', requestId: crypto.randomUUID() });
    expect(response.status).toBe(202);
    return (await response.json()).generationId as string;
  };
  const id = await generate();
  const pending = await question(app, id);
  expect((await request(`/generations/${id}/answers`, 'POST', { questionId: pending.questionId, answer: '예' })).status).toBe(204);
  await waitFor(() => app.store.generation(id).state === 'done');
  const replay = await request(`/generations/${id}/events`);
  expect(replay.status).toBe(200);
  expect(replay.headers.get('access-control-allow-origin')).toBe(origin ?? null);
  expect(parseEvents(await replay.text()).at(-1)?.type).toBe('done');
  const canceled = await generate();
  await question(app, canceled);
  expect((await request(`/generations/${canceled}/cancel`, 'POST')).status).toBe(204);
  expect(app.store.generation(canceled).state).toBe('canceled');
});

it('uses the configured studio origin as the exact allowlist', async () => {
  const origin = 'https://studio.example';
  const app = await setup(origin);
  const path = `/projects/${app.project.projectId}`;
  const allowed = await app.fetch(app.url + path, { headers: { Origin: origin } });
  expect(allowed.status).toBe(200);
  expect(allowed.headers.get('access-control-allow-origin')).toBe(origin);
  expect((await app.fetch(app.url + path, { headers: { Origin: 'http://localhost:5173' } })).status).toBe(403);
  expect((await app.fetch(app.url + path)).status).toBe(200);
});
