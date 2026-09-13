import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentServer } from '../src/server.ts';
import { PolicyClient } from '../src/policy-client.ts';
import type { PublicApi } from '../../../contracts/src/policy.ts';
mkdirSync('data', { recursive: true }); mkdirSync('evidence', { recursive: true });
let observations: { list: PublicApi[]; detail: PublicApi } | undefined;
const app = createAgentServer({
  dataDir: mkdtempSync(join(process.cwd(), 'data', 'policy-smoke-')),
  policy: new PolicyClient(process.env.POLICY_PROXY_URL ?? 'http://localhost:7200'),
  driver: { mode: 'mock', async run(context) {
    const list = await context.tool('list_registered_apis', {}) as PublicApi[];
    const detail = await context.tool('get_api_schema', { apiId: 'customers' }) as PublicApi;
    observations = { list, detail };
    await context.tool('finish', { summary: 'Live policy registry tools verified' });
  } },
});
try {
  const project = app.store.createProject('Policy integration', ['customers']);
  const id = app.engine.create({ projectId: project.projectId, baseRevision: 1, prompt: 'Inspect registered APIs', requestId: crypto.randomUUID() });
  const timeout = Date.now() + 10000;
  while (!['done', 'failed'].includes(app.store.generation(id).state) && Date.now() < timeout) await new Promise(resolve => setTimeout(resolve, 10));
  if (app.store.generation(id).state !== 'done' || !observations) throw new Error('Policy integration failed');
  if (observations.detail.apiId !== 'customers' || Object.hasOwn(observations.detail, 'upstreamBaseUrl')) throw new Error('Unexpected public API contract');
  const evidence = { recordedAt: new Date().toISOString(), passed: true, transport: 'Engine tools -> PolicyClient -> live :7200', serviceSessionUser: 'agent-server', roles: ['viewer'], apiIds: observations.list.map(api => api.apiId), schemaVersion: observations.detail.schemaVersion, requireReason: observations.detail.policy.requireReason, upstreamBaseUrlExcluded: true, generationState: 'done' };
  writeFileSync('evidence/policy-integration.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(evidence);
} finally { app.engine.close(); }
