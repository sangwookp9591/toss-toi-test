import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { Engine, terminal, type AgentDriver } from './engine.ts';
import { Store } from './store.ts';
import { createProjectSchema, generationSchema, saveSchema, HttpError } from './schema.ts';
import { PolicyClient } from './policy-client.ts';
export function createAgentServer(options: { dataDir: string; driver: AgentDriver; policy?: PolicyClient }) {
  const store = new Store(options.dataDir);
  const engine = new Engine(store, options.driver, options.policy);
  async function body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) throw new HttpError(413, 'request body too large');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'invalid JSON'); }
  }
  const json = (res: ServerResponse, status: number, value?: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(value === undefined ? undefined : JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true, agentMode: options.driver.mode });
      if (pathname === '/projects' && req.method === 'POST') {
        const input = createProjectSchema.parse(await body(req));
        return json(res, 201, store.createProject(input.name, input.apiIds));
      }
      const projectRoute = /^\/projects\/([^/]+)(\/source)?$/.exec(pathname);
      if (projectRoute) {
        const id = decodeURIComponent(projectRoute[1]);
        if (!projectRoute[2] && req.method === 'GET') return json(res, 200, store.project(id));
        if (projectRoute[2] && req.method === 'PUT') {
          const input = saveSchema.parse(await body(req));
          return json(res, 200, store.save(id, input.baseRevision, input.files, input.packageSet));
        }
      }
      if (pathname === '/generations' && req.method === 'POST') {
        const generationId = engine.create(generationSchema.parse(await body(req)));
        return json(res, 202, { generationId });
      }
      const generationRoute = /^\/generations\/([^/]+)\/(events|answers|cancel)$/.exec(pathname);
      if (generationRoute) {
        const [, id, action] = generationRoute;
        const record = store.generation(id);
        if (action === 'cancel' && req.method === 'POST') { engine.cancel(id); return json(res, 204); }
        if (action === 'answers' && req.method === 'POST') {
          const input = z.object({ questionId: z.string(), answer: z.string().max(100000) }).parse(await body(req));
          engine.answer(id, input.questionId, input.answer); return json(res, 204);
        }
        if (action === 'events' && req.method === 'GET') {
          const raw = req.headers['last-event-id'] ?? '0';
          if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > record.events.length) throw new HttpError(400, 'invalid Last-Event-ID');
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.flushHeaders();
          const send = (event: typeof record.events[number]) => {
            res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            if (['done', 'failed', 'canceled'].includes(event.type)) res.end();
          };
          // Synchronous replay + subscription: no yield at which a live event can be missed.
          for (const event of record.events) if (event.seq > Number(raw)) send(event);
          if (terminal(record.state)) { res.end(); return; }
          const unsubscribe = engine.subscribe(id, send);
          const keepalive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
          keepalive.unref();
          res.on('close', () => { clearInterval(keepalive); unsubscribe(); });
          return;
        }
      }
      throw new HttpError(404, 'not found');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof HttpError) json(res, error.status, { error: error.message, ...error.details });
      else if (error instanceof z.ZodError) json(res, 400, { error: 'invalid request', issues: error.issues.map(issue => issue.message) });
      else json(res, 500, { error: 'internal error' });
    }
  });
  return { server, store, engine, async close() { engine.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
