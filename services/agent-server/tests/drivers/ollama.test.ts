import { afterEach, expect, it } from 'vitest';
import { OllamaDriver } from '../../src/drivers/ollama.ts';
import { createTools } from '../../src/claude.ts';
import { start, waitFor } from '../helpers.ts';
const apps: Array<Awaited<ReturnType<typeof start>>> = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.cleanup(); });
const call = (name: string, args: unknown) => ({ function: { name, arguments: args } });
function stream(calls: unknown[], content = '') {
  const bytes = new TextEncoder().encode(JSON.stringify({ message: { content, tool_calls: calls }, done: false }) + '\n' + JSON.stringify({ done: true, prompt_eval_count: 4, eval_count: 8 }));
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }));
}
it('uses Claude schemas and native streaming tools for file, text, revision, done and health', async () => {
  const bodies: any[] = []; let metrics: any;
  const app = await start(new OllamaDriver({ onMetrics: (_id, value) => { metrics = value; }, fetcher: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1 ? stream([call('write_file', { path: '/src/App.tsx', content: 'export default function App(){return <h1>한글</h1>}' })], '준비합니다') : stream([call('finish', { summary: 'complete' })]);
  } })); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'done');
  expect(await (await fetch(app.url + '/healthz')).json()).toMatchObject({ agentMode: 'local' });
  expect(app.store.generation(id).events).toEqual(expect.arrayContaining(['file', 'text', 'revision_ready', 'done'].map(type => expect.objectContaining({ type }))));
  expect(bodies[0].tools.map((t: any) => t.function.parameters)).toEqual(createTools({} as any).map(t => 'input_schema' in t ? t.input_schema : {}));
  expect(bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_name: 'write_file' });
  expect(metrics).toMatchObject({ turns: 2, toolCalls: 2, toolErrors: 0, inputTokens: 8, outputTokens: 16 });
});
it('returns invalid arguments, unknown tools and policy failures as recoverable tool errors', async () => {
  const bodies: any[] = [];
  const app = await start(new OllamaDriver({ fetcher: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    if (bodies.length === 1) return stream([call('write_file', '{bad'), call('missing', {}), call('write_file', { path: '/src/App.tsx', content: 7 })]);
    if (bodies.length === 2) {
      expect(body.messages.slice(-3).every((m: any) => JSON.parse(m.content).is_error)).toBe(true);
      return stream([call('write_file', { path: '/src/App.tsx', content: "fetch('/dev/session')" }), call('finish', { summary: 'bad' })]);
    }
    expect(body.messages.at(-1).content).toContain('raw fetch() is forbidden');
    return stream([call('write_file', { path: '/src/App.tsx', content: 'export default function App(){return null}' }), call('finish', { summary: 'safe' })]);
  } })); apps.push(app); const id = await app.generate();
  await waitFor(() => app.store.generation(id).state === 'done');
  expect(app.store.project(app.project.projectId).revision).toBe(2);
});
it('feeds malformed NDJSON back and enforces the turn limit', async () => {
  let count = 0;
  const app = await start(new OllamaDriver({ maxTurns: 2, fetcher: async (_url, init) => {
    count++; if (count === 2) expect(String(init?.body)).toContain('Ollama emitted invalid JSON');
    return new Response('{not JSON}\n');
  } })); apps.push(app); const id = await app.generate();
  await waitFor(() => app.store.generation(id).state === 'failed');
  expect(count).toBe(2);
  expect(app.store.generation(id).events.at(-1)).toMatchObject({ type: 'failed', message: 'Ollama exceeded 2 turns' });
});
it('cancel aborts the in-flight fetch and emits no late file/revision', async () => {
  let signal: AbortSignal | undefined;
  const app = await start(new OllamaDriver({ fetcher: async (_url, init) => {
    signal = init!.signal!;
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  } })); apps.push(app); const id = await app.generate(); await waitFor(() => signal);
  await app.request(`/generations/${id}/cancel`, {});
  expect(signal!.aborted).toBe(true);
  expect(app.store.generation(id).state).toBe('canceled');
  expect(app.store.generation(id).events.some(e => e.type === 'file' || e.type === 'revision_ready')).toBe(false);
});
it('treats a truncated stream and HTTP failure as model failures', async () => {
  for (const response of [new Response('{"message":{"content":"partial"}}\n'), new Response('error', { status: 503 })]) {
    const app = await start(new OllamaDriver({ fetcher: async () => response })); apps.push(app); const id = await app.generate();
    await waitFor(() => app.store.generation(id).state === 'failed');
    expect(app.store.generation(id).events.at(-1)).toMatchObject({ type: 'failed', code: 'model_error' });
  }
});
it('json-content executes only complete JSON or a single fenced object through the same tool path', async () => {
  let requests = 0;
  const app = await start(new OllamaDriver({ toolProtocol: 'json-content', fetcher: async () => {
    requests++;
    return stream([], requests === 1 ? JSON.stringify({ name: 'write_file', arguments: { path: '/src/App.tsx', content: 'export default function App(){return <h1>JSON mode</h1>}' } }) : '```json\n' + JSON.stringify({ name: 'finish', arguments: { summary: 'complete' } }) + '\n```');
  } })); apps.push(app); const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'done');
  expect(app.store.generation(id).events.some(e => e.type === 'file')).toBe(true);
  expect(app.store.project(app.project.projectId).revision).toBe(2);
});
it('json-content rejects mixed text, multiple objects, unknown tools, and schema mismatch before recovery', async () => {
  const invalid = ['Here is a call: {"name":"list_files","arguments":{}}', '{"name":"list_files","arguments":{}} {"name":"list_files","arguments":{}}', '{"name":"not_a_tool","arguments":{}}', '{"name":"write_file","arguments":{"path":"/src/App.tsx","content":7}}'];
  let count = 0; let stats: any;
  const app = await start(new OllamaDriver({ toolProtocol: 'json-content', onMetrics: (_id, value) => { stats = value; }, fetcher: async (_url, init) => {
    if (count > 0) expect(JSON.parse(JSON.parse(String(init!.body)).messages.at(-1).content).is_error).toBe(true);
    return stream([], invalid[count++] ?? '{"name":"finish","arguments":{"summary":"safe terminal"}}');
  } })); apps.push(app); const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'done');
  expect(app.store.generation(id).events.some(e => e.type === 'file')).toBe(false);
  expect(stats.toolErrors).toBe(4);
});
it('native remains the default and never executes bare content JSON', async () => {
  const app = await start(new OllamaDriver({ toolProtocol: 'native', maxTurns: 1, fetcher: async () => stream([], '{"name":"finish","arguments":{"summary":"pretend"}}') })); apps.push(app);
  const id = await app.generate(); await waitFor(() => app.store.generation(id).state === 'failed');
  expect(app.store.project(app.project.projectId).revision).toBe(1);
});
