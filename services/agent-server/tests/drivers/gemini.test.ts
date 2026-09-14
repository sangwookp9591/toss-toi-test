import { afterEach, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, GeminiDriver } from '../../src/drivers/gemini.ts';
import { start, waitFor } from '../helpers.ts';

const apps: Array<Awaited<ReturnType<typeof start>>> = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.cleanup(); });

function result(parts: unknown[], inputTokens = 5, outputTokens = 3, usage: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }], usageMetadata: { promptTokenCount: inputTokens, candidatesTokenCount: outputTokens, ...usage } }), { headers: { 'Content-Type': 'application/json' } });
}
function call(name: string, args: Record<string, unknown>) { return { functionCall: { name, args } }; }

it('runs Gemini function calls through finish and keeps the API key in the header only', async () => {
  const key = 'gemini-test-secret'; const requests: Array<{ url: string; init: RequestInit }> = [];
  const app = await start(new GeminiDriver({ apiKey: key, model: 'gemini-test', fetcher: async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    const turn = requests.length;
    if (turn === 1) return result([{ text: '파일을 준비합니다.' }, call('write_file', { path: '/src/App.tsx', content: 'export default function App(){return null}' })]);
    if (turn === 2) return result([call('ask_user', { question: '계속할까요?', options: ['예'] })]);
    return result([call('finish', { summary: '완료' })]);
  } })); apps.push(app);
  const id = await app.generate();
  await waitFor(() => app.store.generation(id).state === 'awaiting_answer');
  const question = app.store.generation(id).events.find(event => event.type === 'question');
  if (question?.type !== 'question') throw new Error('question missing');
  await app.request(`/generations/${id}/answers`, { questionId: question.questionId, answer: '예' });
  await waitFor(() => app.store.generation(id).state === 'done');

  expect(app.store.project(app.project.projectId).revision).toBe(2);
  expect(requests).toHaveLength(3);
  for (const request of requests) {
    expect(request.url).not.toContain(key);
    expect(new URL(request.url).search).toBe('');
    expect(new Headers(request.init.headers).get('x-goog-api-key')).toBe(key);
    expect(String(request.init.body)).not.toContain(key);
    const body = JSON.parse(String(request.init.body));
    for (const declaration of body.tools[0].functionDeclarations) {
      expect(declaration.parameters).toBeUndefined();
      expect(declaration.parametersJsonSchema).toBeDefined();
      expect(JSON.stringify(declaration.parametersJsonSchema)).not.toContain('$schema');
    }
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });
  }
  expect(JSON.stringify(app.store.generation(id).events)).not.toContain(key);
});

it('re-prompts after a text-only STOP response and finishes within the retry budget', async () => {
  const bodies: any[] = [];
  const app = await start(new GeminiDriver({ apiKey: 'text-retry-secret', fetcher: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1 ? result([{ text: '계속 작업 중입니다.' }]) : result([call('finish', { summary: '완료' })]);
  } })); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'done');
  expect(bodies).toHaveLength(2);
  expect(bodies[1].contents.at(-1)).toEqual({ role: 'user', parts: [{ text: '작업을 계속하고 끝나면 finish 도구를 호출하라.' }] });
});

it('keeps the existing no-finish error after the text retry budget is exhausted', async () => {
  let calls = 0;
  const app = await start(new GeminiDriver({ apiKey: 'text-retry-limit-secret', fetcher: async () => { calls++; return result([{ text: '아직 텍스트입니다.' }]); } })); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'failed');
  expect(calls).toBe(3);
  expect(app.store.generation(id).events.at(-1)).toMatchObject({ type: 'failed', message: 'Model completed without calling finish', code: 'model_error' });
});

it('uses the documented stable Flash default and records thinking/tool-use tokens', async () => {
  expect(DEFAULT_MODEL).toBe('gemini-3.8-flash');
  expect(DEFAULT_TIMEOUT_MS).toBe(120_000);
  let metrics: any;
  const app = await start(new GeminiDriver({ apiKey: 'metrics-secret', inputUsdPerMtok: 1, outputUsdPerMtok: 2, onMetrics: (_id, value) => { metrics = value; }, fetcher: async () => result([{ functionCall: { name: 'finish', args: { summary: 'ok' } } }], 10, 20, { thoughtsTokenCount: 7, toolUsePromptTokenCount: 3 }) })); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'done');
  expect(metrics).toMatchObject({ inputTokens: 13, outputTokens: 27, thoughtsTokens: 7 });
});

it('groups parallel function responses into one user Content', async () => {
  const bodies: any[] = [];
  const app = await start(new GeminiDriver({ apiKey: 'parallel-secret', fetcher: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1 ? result([call('list_files', {}), call('list_registered_apis', {})]) : result([call('finish', { summary: 'done' })]);
  } })); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'failed' || app.store.generation(id).state === 'done');
  expect(bodies).toHaveLength(2);
  const user = bodies[1].contents.filter((content: any) => content.role === 'user').at(-1);
  expect(user.parts).toHaveLength(2);
  expect(user.parts.every((part: any) => part.functionResponse)).toBe(true);
});

it('classifies timeout during JSON parsing as a timeout and bounds finish reasons', async () => {
  const app = await start(new GeminiDriver({ apiKey: 'timeout-secret', timeoutMs: 5, fetcher: async () => ({ ok: true, body: null, json: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return {}; } } as Response) })); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'failed');
  expect(app.store.generation(id).events.at(-1)).toMatchObject({ type: 'failed', message: 'Gemini request timed out' });

  const reasonApp = await start(new GeminiDriver({ apiKey: 'reason-secret', fetcher: async () => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] }, finishReason: 'x'.repeat(100) }] }), { headers: { 'Content-Type': 'application/json' } }) })); apps.push(reasonApp);
  const reasonId = await reasonApp.generate(); await waitFor(() => reasonApp.store.generation(reasonId).state === 'failed');
  expect(reasonApp.store.generation(reasonId).events.at(-1)).toMatchObject({ type: 'failed', message: 'Gemini returned unsupported finish reason' });
});

it('maps Gemini rate limits and server failures to model_error without exposing response bodies', async () => {
  for (const status of [429, 503]) {
    const secret = `secret-${status}`;
    const app = await start(new GeminiDriver({ apiKey: secret, fetcher: async () => new Response(`provider body ${secret}`, { status }) })); apps.push(app);
    const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'failed');
    expect(app.store.generation(id).events.at(-1)).toMatchObject({ type: 'failed', code: 'model_error' });
    expect(JSON.stringify(app.store.generation(id).events)).not.toContain(secret);
  }
});

it('honors cancellation and cost limit before issuing the next request', async () => {
  let signal: AbortSignal | undefined; let calls = 0;
  const app = await start(new GeminiDriver({ apiKey: 'cancel-secret', maxCostUsd: 0.00001, inputUsdPerMtok: 1, outputUsdPerMtok: 1, fetcher: async (_url, init) => {
    calls++; signal = init?.signal ?? undefined; return result([call('write_file', { path: '/src/App.tsx', content: 'export default function App(){return null}' })], 100, 100);
  } })); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'failed');
  expect(calls).toBe(0); expect(app.store.generation(id).events.at(-1)).toMatchObject({ type: 'failed', code: 'model_error', message: 'Gemini cost limit exceeded' });

  const cancelApp = await start(new GeminiDriver({ apiKey: 'cancel-secret', fetcher: async (_url, init) => new Promise((_resolve, reject) => { const requestSignal = init?.signal; signal = requestSignal ?? undefined; if (!requestSignal) return reject(new Error('missing signal')); requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true }); }) })); apps.push(cancelApp);
  const cancelId = await cancelApp.generate(); await waitFor(() => signal);
  await cancelApp.request(`/generations/${cancelId}/cancel`, {});
  expect(signal?.aborted).toBe(true); expect(cancelApp.store.generation(cancelId).state).toBe('canceled');
});

it('settles a reservation from usage metadata and confirms it when the request fails', async () => {
  const settlements: Array<number | undefined> = [];
  const app = await start(new GeminiDriver({ apiKey: 'settlement-secret', maxCostUsd: 1, inputUsdPerMtok: 1, outputUsdPerMtok: 2, onCostReservation: () => actual => settlements.push(actual), fetcher: async () => result([{ functionCall: { name: 'finish', args: { summary: 'ok' } } }], 10, 20, { thoughtsTokenCount: 7, toolUsePromptTokenCount: 3 }) })); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'done');
  expect(settlements).toEqual([0.000067]);

  const failedSettlements: Array<number | undefined> = [];
  const failedApp = await start(new GeminiDriver({ apiKey: 'failed-settlement-secret', onCostReservation: () => actual => failedSettlements.push(actual), fetcher: async () => { throw new Error('offline'); } })); apps.push(failedApp);
  const failedId = await failedApp.generate(); await waitFor(() => failedApp.store.generation(failedId).state === 'failed');
  expect(failedSettlements).toEqual([undefined]);
});
