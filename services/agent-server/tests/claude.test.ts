import { afterEach, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeDriver, ModelError, modelError, type RunnerFactory } from '../src/claude.ts';
import { start, waitFor, question } from './helpers.ts';
import type { BetaMessage, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages';
import { MockDriver } from '../src/mock.ts';
const apps: Array<Awaited<ReturnType<typeof start>>> = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.cleanup(); });

function sdkResponse(blocks: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: object }>, stopReason: string) {
  const events: unknown[] = [{ type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } }];
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 10 } }, { type: 'message_stop' });
  return new Response(events.map((event: any) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}

it('real SDK streaming toolRunner + betaZodTool converts fake model tool calls into file/revision events', async () => {
  const bodies: any[] = [];
  const client = new Anthropic({ apiKey: 'test-key', maxRetries: 0, fetch: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) return sdkResponse([{ type: 'text', text: 'SDK streamed text' }, { type: 'tool_use', id: 'tool_write', name: 'write_file', input: { path: '/src/App.tsx', content: 'export default function App(){return <h1>SDK generated</h1>}' } }], 'tool_use');
    return sdkResponse([{ type: 'tool_use', id: 'tool_finish', name: 'finish', input: { summary: 'SDK complete' } }], 'tool_use');
  } });
  const driver = new ClaudeDriver((params, options) => client.beta.messages.toolRunner({ ...params, stream: true }, options));
  const app = await start(driver); apps.push(app); const id = await app.generate();
  await waitFor(() => app.store.generation(id).state === 'done');
  expect(bodies[0]).toMatchObject({ model: 'claude-opus-5', max_tokens: 64000, thinking: { type: 'adaptive' }, fallbacks: 'default', stream: true });
  expect(bodies[0].tools.map((tool: any) => tool.name)).toContain('request_packages');
  expect(app.store.generation(id).events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', delta: 'SDK streamed text' }), expect.objectContaining({ type: 'file', path: '/src/App.tsx' }), expect.objectContaining({ type: 'revision_ready', revision: 2 })]));
  expect(app.store.project(app.project.projectId).files['/src/App.tsx']).toContain('SDK generated');
  expect(bodies[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tool_write' });
});

it('pause_turn pushes the exact assistant content before resuming the outer runner', async () => {
  const pushed: unknown[] = []; let captured: any;
  const content: BetaMessage['content'] = [{ type: 'text', text: 'Paused', citations: null }];
  const factory: RunnerFactory = params => {
    captured = params;
    return {
      pushMessages(...messages) { pushed.push(...messages); },
      async *[Symbol.asyncIterator]() {
        yield { async *[Symbol.asyncIterator]() {}, async finalMessage() { return { stop_reason: 'pause_turn', content }; } };
        const tool = params.tools.find(tool => 'name' in tool && tool.name === 'finish') as { run: (args: unknown) => Promise<string> };
        await tool.run({ summary: 'resumed' });
      },
    };
  };
  const app = await start(new ClaudeDriver(factory)); apps.push(app); const id = await app.generate();
  await waitFor(() => app.store.generation(id).state === 'done');
  expect(pushed).toEqual([{ role: 'assistant', content }]);
  expect(captured.betas).toEqual(['server-side-fallback-2026-07-01']);
});

it('refusal is a terminal model_error', async () => {
  const client = new Anthropic({ apiKey: 'test-key', fetch: async () => sdkResponse([{ type: 'text', text: 'Declined' }], 'refusal') });
  const app = await start(new ClaudeDriver((params, options) => client.beta.messages.toolRunner({ ...params, stream: true }, options))); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'failed');
  expect(app.store.generation(id).events.at(-1)).toMatchObject({ type: 'failed', code: 'model_error', message: 'Claude refused the request' });
  expect(app.store.project(app.project.projectId).revision).toBe(1);
});

it('auto mode falls back on the first authentication error and reports mock health', async () => {
  const factory: RunnerFactory = () => ({ pushMessages() {}, async *[Symbol.asyncIterator]() { throw new Anthropic.AuthenticationError(401, { error: { message: 'invalid test key' } }, 'auth', new Headers()); } });
  const driver = new ClaudeDriver(factory, true, new MockDriver(1));
  const app = await start(driver); apps.push(app); const id = await app.generate(); const pending = await question(app, id);
  expect(await (await fetch(app.url + '/healthz')).json()).toEqual({ ok: true, agentMode: 'mock' });
  await app.request(`/generations/${id}/answers`, { questionId: pending.questionId, answer: '예' });
  await waitFor(() => app.store.generation(id).state === 'done');
});

it('specific SDK error classes are classified before APIError without leaking provider details', () => {
  expect(modelError(new Anthropic.RateLimitError(429, {}, 'secret body', new Headers())).message).toBe('Claude rate limit exceeded');
  expect(modelError(new Anthropic.APIConnectionTimeoutError()).message).toBe('Claude request timed out');
  expect(modelError(new Anthropic.BadRequestError(400, {}, 'secret body', new Headers())).message).toBe('Claude API error (HTTP 400)');
  expect(modelError(new Error('secret body'))).toBeInstanceOf(ModelError);
  expect(modelError(new Error('secret body')).message).not.toContain('secret');
});

it.runIf(process.env.RUN_LIVE_CLAUDE === '1')('live Claude smoke (explicit opt in only)', async () => {
  const { createDriver } = await import('../src/claude.ts');
  const app = await start(await createDriver('claude')); apps.push(app);
  const response = await app.request('/generations', { projectId: app.project.projectId, prompt: 'Only call finish with summary live smoke; make no file changes and ask no questions.', baseRevision: 1, requestId: crypto.randomUUID() });
  const { generationId } = await response.json();
  await waitFor(() => ['done', 'failed'].includes(app.store.generation(generationId).state), 120000);
  expect(app.store.generation(generationId).state).toBe('done');
}, 150000);

it('a CAS conflict inside an SDK finish tool is terminal conflict, not a swallowed tool retry', async () => {
  let calls = 0;
  const client = new Anthropic({ apiKey: 'test-key', maxRetries: 0, fetch: async () => {
    calls++;
    return calls === 1
      ? sdkResponse([{ type: 'tool_use', id: 'tool_ask', name: 'ask_user', input: { question: 'Continue?' } }], 'tool_use')
      : sdkResponse([{ type: 'tool_use', id: 'tool_finish', name: 'finish', input: { summary: 'Complete' } }], 'tool_use');
  } });
  const app = await start(new ClaudeDriver((params, options) => client.beta.messages.toolRunner({ ...params, stream: true }, options))); apps.push(app);
  const id = await app.generate(); const pending = await question(app, id);
  await app.request(`/projects/${app.project.projectId}/source`, { baseRevision: 1, files: { '/src/App.tsx': 'editor wins SDK race' } }, 'PUT');
  await app.request(`/generations/${id}/answers`, { questionId: pending.questionId, answer: 'yes' });
  await waitFor(() => app.store.generation(id).state === 'failed');
  expect(app.store.generation(id).events.at(-1)).toMatchObject({ type: 'failed', code: 'conflict' });
  expect(app.store.project(app.project.projectId).files['/src/App.tsx']).toBe('editor wins SDK race');
});
