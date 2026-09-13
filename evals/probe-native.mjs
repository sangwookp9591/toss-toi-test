// Independent Ollama probe: no agent engine, SDK, policy fixture, or content adapter.
import { writeFile, mkdir } from 'node:fs/promises';
const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const model = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b';
const request = { model, stream: true, options: { temperature: 0, num_ctx: 16384, num_predict: 256 }, messages: [{ role: 'user', content: 'Call list_registered_apis now using a native tool call.' }], tools: [{ type: 'function', function: { name: 'list_registered_apis', description: 'List registered APIs', parameters: { type: 'object', properties: {} } } }] };
const response = await fetch(base.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
const raw = await response.text();
const chunks = raw.trim().split('\n').map(line => JSON.parse(line));
const calls = chunks.flatMap(chunk => chunk.message?.tool_calls ?? []);
const result = { recordedAt: new Date().toISOString(), model, request, chunks, nativeToolCalls: calls.length, content: chunks.map(chunk => chunk.message?.content ?? '').join('') };
await mkdir(new URL('results/', import.meta.url), { recursive: true });
const file = new URL('results/native-protocol-probe-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json', import.meta.url);
await writeFile(file, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ file: file.pathname, nativeToolCalls: calls.length }));
