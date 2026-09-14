import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Identity, isService, isUser } from './identity.ts';
import { z } from 'zod';
import { Engine, terminal, type AgentDriver } from './engine.ts';
import { Store, type GenerationRecord } from './store.ts';
import type { ActiveGeneration } from '../../../contracts/src/generation.ts';
import { createProjectSchema, generationSchema, saveSchema, HttpError } from './schema.ts';
import { PolicyClient } from './policy-client.ts';
import { assertSourcePolicy } from './source-policy.ts';
import { ToolError } from './schema.ts';
export function createAgentServer(options: { dataDir: string; driver: AgentDriver; policy?: PolicyClient; studioOrigin?: string; identity?: Identity }) {
  const identity = options.identity ?? new Identity({ clientId: 'toi-agent-server', clientSecret: process.env.TOI_AGENT_CLIENT_SECRET });
  const studioOrigin = options.studioOrigin ?? 'http://localhost:5273';
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
    try {
      const origin = req.headers.origin;
      const healthCheck = req.method === 'GET' && req.url?.split('?')[0] === '/healthz';
      // CORS alone does not stop simple requests: reject before routing or reading a body.
      if (!healthCheck && origin !== undefined && origin !== studioOrigin) throw new HttpError(403, 'origin forbidden');
      if (origin === studioOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      // Include bodyless mutations such as cancel so browser writes require preflight.
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '') &&
          req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new HttpError(415, 'Content-Type must be application/json');
      }
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true, agentMode: options.driver.mode });
      let actor;
      try { actor = await identity.verify(req.headers.authorization); } catch { throw new HttpError(401, 'authentication required'); }
      const internal = /^\/internal\/projects\/([^/]+)\/membership$/.exec(pathname);
      if (internal && req.method === 'GET') {
        if (!isService(actor, 'toi-policy-proxy') || origin !== undefined) throw new HttpError(403, 'service identity required');
        return json(res, 200, store.membership(decodeURIComponent(internal[1])));
      }
      if (!isUser(actor)) throw new HttpError(403, 'user identity required');
      const memberRoute = /^\/projects\/([^/]+)\/(membership|members\/([^/]+)|users)$/.exec(pathname);
      if (memberRoute) {
        const projectId = decodeURIComponent(memberRoute[1]);
        store.requireMember(projectId, actor.sub, memberRoute[2] === 'membership' ? 'viewer' : 'owner');
        if (memberRoute[2] === 'membership' && req.method === 'GET') return json(res, 200, store.membership(projectId));
        if (memberRoute[2] === 'users' && req.method === 'GET') {
          const username = new URL(req.url!, 'http://localhost').searchParams.get('username') ?? '';
          if (!/^[a-zA-Z0-9_.@-]{1,100}$/.test(username)) throw new HttpError(400, 'invalid username');
          const response = await fetch(identity.issuer.replace('/realms/', '/admin/realms/') + '/users?exact=true&username=' + encodeURIComponent(username), { headers: { Authorization: `Bearer ${await identity.serviceToken()}` }, signal: AbortSignal.timeout(3000), redirect: 'error' });
          if (!response.ok) throw new HttpError(502, 'identity directory unavailable');
          const users = await response.json() as {id:string;username:string;enabled:boolean}[];
          return json(res, 200, users.filter(u => u.enabled && !u.username.startsWith('service-account-')).map(u => ({ sub: u.id, username: u.username })));
        }
        if (memberRoute[3] && ['PUT','DELETE'].includes(req.method!)) {
          const sub = decodeURIComponent(memberRoute[3]);
          if (!/^[a-zA-Z0-9_-]{1,100}$/.test(sub)) throw new HttpError(400, 'invalid subject');
          if (req.method === 'DELETE') return json(res, 200, store.updateMember(projectId, actor.sub, sub, ''));
          const { role } = z.object({ role: z.enum(['owner','editor','viewer']) }).parse(await body(req));
          const response = await fetch(identity.issuer.replace('/realms/', '/admin/realms/') + '/users/' + encodeURIComponent(sub), { headers: { Authorization: `Bearer ${await identity.serviceToken()}` }, signal: AbortSignal.timeout(3000), redirect: 'error' });
          if (!response.ok) throw new HttpError(response.status === 404 ? 400 : 502, 'identity lookup failed');
          const user = await response.json() as { username: string; enabled: boolean };
          if (!user.enabled || user.username.startsWith('service-account-')) throw new HttpError(400, 'invalid member');
          return json(res, 200, store.updateMember(projectId, actor.sub, sub, user.username, role));
        }
      }
      const scopedProject = /^\/projects\/([^/]+)/.exec(pathname);
      if (scopedProject) store.requireMember(decodeURIComponent(scopedProject[1]), actor.sub, req.method === 'GET' ? 'viewer' : 'editor');
      if (pathname === '/projects' && req.method === 'POST') {
        if (!actor.realm_access.roles.includes('builder') || !actor.groups.length) throw new HttpError(403, 'builder and team required');
        const input = createProjectSchema.parse(await body(req));
        return json(res, 201, store.createProject(input.name, input.apiIds, actor));
      }
      const activeRoute = /^\/projects\/([^/]+)\/generations\/active$/.exec(pathname);
      if (activeRoute && req.method === 'GET') {
        const projectId = decodeURIComponent(activeRoute[1]);
        store.project(projectId);
        // Map insertion order is creation order, so the last match is the newest; restarted runs are already terminal.
        let active: GenerationRecord | undefined;
        for (const record of store.generations.values()) if (record.request.projectId === projectId && !terminal(record.state)) active = record;
        if (!active) throw new HttpError(404, 'no active generation');
        return json(res, 200, { generationId: active.generationId, state: active.state, lastSeq: active.events.length, prompt: active.request.prompt, createdAt: active.createdAt } satisfies ActiveGeneration);
      }
      const projectRoute = /^\/projects\/([^/]+)(\/source)?$/.exec(pathname);
      if (projectRoute) {
        const id = decodeURIComponent(projectRoute[1]);
        if (!projectRoute[2] && req.method === 'GET') return json(res, 200, store.project(id));
        if (projectRoute[2] && req.method === 'PUT') {
          const input = saveSchema.parse(await body(req));
          assertSourcePolicy(input.files);
          return json(res, 200, store.save(id, input.baseRevision, input.files, input.packageSet));
        }
      }
      if (pathname === '/generations' && req.method === 'POST') {
        const input = generationSchema.parse(await body(req));
        store.requireMember(input.projectId, actor.sub, 'editor');
        const generationId = engine.create(input);
        return json(res, 202, { generationId });
      }
      const generationRoute = /^\/generations\/([^/]+)\/(events|answers|cancel)$/.exec(pathname);
      if (generationRoute) {
        const [, id, action] = generationRoute;
        const record = store.generation(id);
        store.requireMember(record.request.projectId, actor.sub, req.method === 'GET' ? 'viewer' : 'editor');
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
          const keepalive = setInterval(() => {
            try { if (actor.exp <= Date.now() / 1000) throw new Error(); store.requireMember(record.request.projectId, actor.sub); res.write(': keep-alive\n\n'); } catch { res.end(); }
          }, 1000);
          keepalive.unref();
          res.on('close', () => { clearInterval(keepalive); unsubscribe(); });
          return;
        }
      }
      throw new HttpError(404, 'not found');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof HttpError) json(res, error.status, { error: error.message, ...error.details });
      else if (error instanceof ToolError) json(res, 400, { error: error.message });
      else if (error instanceof z.ZodError) json(res, 400, { error: 'invalid request', issues: error.issues.map(issue => issue.message) });
      else json(res, 500, { error: 'internal error' });
    }
  });
  return { server, store, engine, async close() { engine.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
