import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { start, question, waitFor } from './helpers.ts';
const apps: Awaited<ReturnType<typeof start>>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.cleanup(); });

it('finds the newest nonterminal generation for this project and falls back after cancel', async () => {
  const app = await start(); apps.push(app);
  const active = () => fetch(`${app.url}/projects/${app.project.projectId}/generations/active`);
  expect((await active()).status).toBe(404);
  expect((await fetch(`${app.url}/projects/missing/generations/active`)).status).toBe(404);
  const first = await app.generate(); await question(app, first);
  const second = await app.generate(); await question(app, second);
  const other = app.store.createProject('Other', ['customers']);
  app.engine.create({ projectId: other.projectId, baseRevision: 1, prompt: 'Other', requestId: crypto.randomUUID() });
  expect(await (await active()).json()).toEqual({ generationId: second, state: 'awaiting_answer', lastSeq: app.store.generation(second).events.length, prompt: '고객 목록', createdAt: app.store.generation(second).createdAt });
  const persisted = JSON.parse(readFileSync(`${app.directory}/generations/${second}.json`, 'utf8'));
  expect(persisted.request.prompt).toBe('고객 목록');
  expect(persisted.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(new Date(persisted.createdAt).toISOString()).toBe(persisted.createdAt);
  await app.request(`/generations/${second}/cancel`);
  expect((await (await active()).json()).generationId).toBe(first);
  const pending = await question(app, first);
  await app.request(`/generations/${first}/answers`, { questionId: pending.questionId, answer: '아니요' });
  await waitFor(() => app.store.generation(first).state === 'done');
  expect((await active()).status).toBe(404);
});

it.each([undefined, 'http://localhost:5173'])('active lookup permits server and studio Origin %j', async origin => {
  const app = await start(); apps.push(app);
  const id = await app.generate(); await question(app, id);
  const response = await fetch(`${app.url}/projects/${app.project.projectId}/generations/active`, { headers: origin ? { Origin: origin } : {} });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin ?? null);
  expect((await response.json()).generationId).toBe(id);
});
