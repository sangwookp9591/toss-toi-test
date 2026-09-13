import { identity, token } from './identity-fixture.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentServer } from '../src/server.ts';
import { MockDriver } from '../src/mock.ts';
import type { AgentDriver } from '../src/engine.ts';
import type { PolicyClient } from '../src/policy-client.ts';
import type { GenerationEvent } from '../../../contracts/src/generation.ts';
export async function start(driver: AgentDriver = new MockDriver(1), policy?: PolicyClient, existingDirectory?: string, studioOrigin?: string) {
  // Temporary test storage stays within this package's owned data directory.
  const { mkdirSync } = await import('node:fs'); mkdirSync('data', { recursive: true });
  const directory = existingDirectory ?? mkdtempSync(join(process.cwd(), 'data', 'test-'));
  const app = createAgentServer({ dataDir: directory, driver, policy, studioOrigin, identity: identity() });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const url = `http://127.0.0.1:${address.port}`;
  const accessToken = await token();
  const authenticatedFetch: typeof fetch = (url, init = {}) => { const headers = new Headers(init.headers); if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${accessToken}`); return fetch(url, { ...init, headers }); };
  const request = (path: string, body?: unknown, method = 'POST') => authenticatedFetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const project = await (await request('/projects', { name: 'Test', apiIds: ['customers'] })).json();
  const generate = async (requestId: string = crypto.randomUUID()) => (await (await request('/generations', { projectId: project.projectId, baseRevision: project.revision, prompt: '고객 목록', requestId })).json()).generationId as string;
  return { ...app, url, directory, project, request, generate, token: accessToken, fetch: authenticatedFetch, async cleanup(remove = true) { await app.close(); if (remove) rmSync(directory, { recursive: true, force: true }); } };
}
export function parseEvents(text: string): GenerationEvent[] {
  return text.split('\n\n').flatMap(block => {
    const line = block.split('\n').find(line => line.startsWith('data: '));
    return line ? [JSON.parse(line.slice(6)) as GenerationEvent] : [];
  });
}
export async function waitFor<T>(value: () => T | undefined | false, timeout = 3000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = value(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Condition timed out');
}
export async function question(app: Awaited<ReturnType<typeof start>>, id: string) {
  const event = await waitFor(() => app.store.generation(id).events.find(event => event.type === 'question'));
  if (event.type !== 'question') throw new Error('missing question');
  return event;
}
