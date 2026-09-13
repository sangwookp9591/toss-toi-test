import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentServer } from '../src/server.ts';
import { MockDriver } from '../src/mock.ts';
import type { GenerationEvent } from '../../../contracts/src/generation.ts';
mkdirSync('data', { recursive: true }); mkdirSync('evidence', { recursive: true });
const app = createAgentServer({ dataDir: mkdtempSync(join(process.cwd(), 'data', 'smoke-')), driver: new MockDriver(20) });
await new Promise<void>((resolve, reject) => { app.server.once('error', reject); app.server.listen(7400, '127.0.0.1', resolve); });
const base = 'http://127.0.0.1:7400';
const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let curl: ReturnType<typeof spawn> | undefined;
try {
  const project = await (await post('/projects', { name: 'curl SSE smoke', apiIds: ['customers'] })).json();
  const { generationId } = await (await post('/generations', { projectId: project.projectId, baseRevision: project.revision, requestId: crypto.randomUUID(), prompt: '고객 목록' })).json();
  curl = spawn('curl', ['--silent', '--show-error', '--no-buffer', '--max-time', '20', `${base}/generations/${generationId}/events`]);
  let raw = ''; let buffered = ''; const events: GenerationEvent[] = []; let answer: Promise<number> | undefined;
  curl.stdout!.on('data', chunk => {
    const text = chunk.toString(); raw += text; buffered += text;
    let index;
    while ((index = buffered.indexOf('\n\n')) >= 0) {
      const block = buffered.slice(0, index); buffered = buffered.slice(index + 2);
      const line = block.split('\n').find(line => line.startsWith('data: '));
      if (!line) continue;
      const event: GenerationEvent = JSON.parse(line.slice(6)); events.push(event);
      console.log(`${event.seq} ${event.type}${event.type === 'state' ? ':' + event.state : ''}`);
      if (event.type === 'question') {
        answer = post(`/generations/${generationId}/answers`, { questionId: event.questionId, answer: '예' }).then(response => { console.log(`POST answers -> ${response.status}`); return response.status; });
      }
    }
  });
  const code = await new Promise<number | null>((resolve, reject) => { curl!.once('exit', resolve); curl!.once('error', reject); });
  if (code !== 0 || !answer || await answer !== 204 || events.at(-1)?.type !== 'done') throw new Error('curl smoke failed');
  const persisted = app.store.project(project.projectId);
  if (persisted.revision !== 2) throw new Error('source was not committed');
  writeFileSync('evidence/mock-sse.log', '# curl --no-buffer http://127.0.0.1:7400/generations/' + generationId + '/events\n' + raw);
  writeFileSync('evidence/mock-smoke.json', JSON.stringify({ recordedAt: new Date().toISOString(), agentMode: 'mock', curlExit: code, answerStatus: 204, revision: persisted.revision, events: events.map(event => ({ seq: event.seq, type: event.type, ...(event.type === 'state' ? { state: event.state } : {}) })) }, null, 2) + '\n');
} finally { curl?.kill(); await app.close(); }
