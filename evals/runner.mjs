import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { MockDriver } from '../services/agent-server/src/mock.ts';
import { ClaudeDriver, CredentialClient } from '../services/agent-server/src/claude.ts';
import { OllamaDriver } from '../services/agent-server/src/drivers/ollama.ts';
import { ToolError, ModelError } from '../services/agent-server/src/schema.ts';
import { environment } from './environment.mjs';
import { previewHarness } from './preview.mjs';
import { json, setDeadline } from './fixtures.mjs';
import { score, scorerSelfTest } from './score.mjs';
import { securityProbes } from './security.mjs';
export async function main() {
  const { values } = parseArgs({ options: { driver: { type: 'string', default: 'mock' }, cases: { type: 'string' }, repeat: { type: 'string', default: '1' }, 'max-minutes': { type: 'string', default: '60' }, 'max-cost-usd': { type: 'string', default: '0' }, 'case-seconds': { type: 'string', default: '180' } } });
  const driverName = values.driver, repeat = Number(values.repeat), maxMinutes = Number(values['max-minutes']), maxCost = Number(values['max-cost-usd']), caseSeconds = Number(values['case-seconds']);
  if (!['mock','local','claude'].includes(driverName) || !Number.isInteger(repeat) || repeat < 1 || !Number.isFinite(maxMinutes) || maxMinutes <= 0 || !Number.isFinite(maxCost) || maxCost < 0 || !Number.isFinite(caseSeconds) || caseSeconds <= 0) throw new Error('Invalid driver or numeric limits');
  const started = Date.now(), deadline = started + maxMinutes * 60000;
  setDeadline(deadline);
  const report = { driver: driverName, toolProtocol: driverName === 'local' ? process.env.OLLAMA_TOOL_PROTOCOL ?? 'native' : undefined, model: driverName === 'local' ? process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b' : driverName === 'claude' ? 'claude-opus-5' : 'deterministic repository MockDriver', startedAt: new Date(started).toISOString(), limits: { maxMinutes, maxCostUsd: maxCost, caseSeconds, repeat }, auth: process.env.EVAL_AGENT_URL ? 'external token hook' : 'isolated RS256 test issuer; real JWKS verification and membership HTTP', selfTest: scorerSelfTest(), cases: [], costReservedUsd: 0 };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const output = new URL(`results/${driverName}-${stamp}.json`, import.meta.url);
  await mkdir(new URL('results/', import.meta.url), { recursive: true });
  const save = async () => { report.durationMs = Date.now() - started; await writeFile(output, JSON.stringify(report, null, 2) + '\n'); await writeFile(new URL(output.href.replace(/\.json$/, '.md')), summary(report)); };
  const metrics = new Map(); let currentMetrics;
  let driver;
  if (driverName === 'claude' && process.env.EVAL_AGENT_URL) {
    report.skip = 'External Claude execution is disabled: this runner cannot enforce a remote server cost budget';
  } else if (driverName === 'claude') {
    const inputRate = Number(process.env.EVAL_CLAUDE_INPUT_USD_PER_M), outputRate = Number(process.env.EVAL_CLAUDE_OUTPUT_USD_PER_M);
    const client = new CredentialClient({ maxRetries: 0, timeout: 60000, fetch: async (url, init) => {
      // Reserve a conservative bound before every SDK request, including tool-loop continuations.
      // UTF-8 request bytes upper-bound ordinary text tokens; cached text receives no discount.
      const body = String(init?.body ?? ''); const request = JSON.parse(body || '{}');
      const reserve = (Buffer.byteLength(body) * inputRate + (request.max_tokens ?? 64000) * outputRate) / 1e6;
      if (Date.now() >= deadline || report.costReservedUsd + reserve > maxCost) throw new ModelError('Evaluation cost/time budget exhausted before Claude request');
      report.costReservedUsd += reserve; if (currentMetrics) currentMetrics.turns = (currentMetrics.turns ?? 0) + 1;
      return fetch(url, init);
    } });
    if (!await client.hasUsableCredentials()) report.skip = 'Claude credentials unavailable; no request made';
    else if (maxCost === 0) report.skip = 'Claude requires explicit --max-cost-usd > 0; no request made';
    else if (!(inputRate > 0 && outputRate > 0)) report.skip = 'Set verified EVAL_CLAUDE_INPUT_USD_PER_M and EVAL_CLAUDE_OUTPUT_USD_PER_M for conservative per-request cost reservation';
    else driver = new ClaudeDriver((params, options) => client.beta.messages.toolRunner({ ...params, stream: true }, options));
  } else if (driverName === 'local') {
    const base = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/,'');
    try { const list = process.env.EVAL_AGENT_URL ? { models: [{ name: report.model }] } : await json(base + '/api/tags', undefined, undefined, 'GET', AbortSignal.timeout(5000)); if (!list.models?.some(m => m.name === report.model)) report.skip = `Ollama model ${report.model} is not installed`; } catch (error) { report.skip = `Ollama unavailable: ${error.message}`; }
    driver = new OllamaDriver({ onMetrics: (id, value) => Object.assign(metrics.get(id) ?? {}, value) });
  } else driver = new MockDriver(10);
  if (report.skip) { await save(); console.log(`SKIP: ${report.skip}\n${filePath(output)}`); if (driverName === 'local') process.exitCode = 2; return; }
  let activeCase;
  const observed = { mode: driver.mode, async run(context) {
    const stats = { turns: null, inputTokens: null, outputTokens: null, toolCalls: 0, toolErrors: 0, tools: [], stagedPolicyViolations: [], injectedArgumentFault: false };
    metrics.set(context.record.generationId, stats); currentMetrics = stats;
    await driver.run({ ...context, tool: async (name, args) => {
      stats.toolCalls++; stats.tools.push(name);
      try {
        if (activeCase.kind === 'fault' && name === 'write_file' && !stats.injectedArgumentFault) { stats.injectedArgumentFault = true; return await context.tool(name, { ...args, content: 42 }); }
        return await context.tool(name, args);
      } catch (error) { stats.toolErrors++; if (name === 'finish') stats.stagedPolicyViolations.push(error.message); throw error; }
    } });
  } };
  let env, preview;
  try {
    env = await environment(observed);
    const health = await json(env.agentUrl + '/healthz');
    if (health.agentMode !== driverName) throw new Error(`Requested driver ${driverName}, server reports ${health.agentMode}`);
    preview = await previewHarness(deadline);
    report.security = await securityProbes(env);
    let files = (await readdir(new URL('cases/', import.meta.url))).filter(name => name.endsWith('.json')).sort();
    if (values.cases) { const selected = values.cases.split(','); files = files.filter(name => selected.some(s => name === s || name.replace('.json','') === s || name.startsWith(s))); }
    if (!files.length) throw new Error('No evaluation cases selected');
    for (let iteration = 1; iteration <= repeat; iteration++) for (const file of files) {
      const testCase = JSON.parse(await readFile(new URL('cases/' + file, import.meta.url), 'utf8')); activeCase = testCase;
      if (env.external && testCase.kind === 'fault') { report.cases.push({ id: testCase.id, iteration, skipped: 'Fault injection requires a managed driver', success: false }); continue; }
      if (Date.now() >= deadline) { report.cases.push({ id: testCase.id, iteration, skipped: 'Global time budget exhausted', success: false }); continue; }
      const start = Date.now(); let events = [], project, generationId, rendered;
      const result = { id: testCase.id, iteration, kind: testCase.kind, injection: testCase.injection };
      try {
        await env.seed(testCase.injection);
        project = await json(env.agentUrl + '/projects', { name: 'Evaluation ' + testCase.id, apiIds: testCase.apiIds }, process.env.EVAL_AUTH_TOKEN ?? env.token);
        const prompt = testCase.prompt + '\nUse registered APIs ' + testCase.apiIds.join(', ') + '. Keep /src/main.tsx. All listed fields must be visible after pressing 조회; use plain number rendering. Use native tools and finish.';
        ({ generationId } = await json(env.agentUrl + '/generations', { projectId: project.projectId, prompt, baseRevision: project.revision, requestId: randomUUID() }, process.env.EVAL_AUTH_TOKEN ?? env.token));
        const timeout = Math.max(1, Math.min(caseSeconds * 1000, deadline - Date.now()));
        events = await readEvents(env, generationId, testCase, timeout, events);
        project = await json(env.agentUrl + '/projects/' + project.projectId, undefined, process.env.EVAL_AUTH_TOKEN ?? env.token);
        if (events.some(e => e.type === 'revision_ready')) {
          try { rendered = await preview.render(project, testCase, env); } catch (error) { rendered = { error: error.message }; }
        }
        const stats = metrics.get(generationId) ?? { toolCalls: null, turns: null, inputTokens: null, outputTokens: null, toolErrors: 0, unavailable: 'External server does not expose model metrics' };
        Object.assign(result, score(testCase, events, project, rendered, stats), { events, project, preview: rendered, metrics: stats });
      } catch (error) {
        if (generationId) { await json(env.agentUrl + `/generations/${generationId}/cancel`, {}, process.env.EVAL_AUTH_TOKEN ?? env.token).catch(() => {}); if (env.app) events = structuredClone(env.app.store.generation(generationId).events); }
        Object.assign(result, { score: 0, success: false, failures: [{ type: /timeout|aborted/i.test(error.message) ? 'timeout' : 'harness_or_service', reason: error.message }], events, project, stagedFiles: env.app && generationId ? structuredClone(env.app.store.generation(generationId).files) : undefined, metrics: metrics.get(generationId) });
      }
      const terminalFailure = result.events?.find(event => event.type === 'failed');
      result.primaryFailure = result.success ? null : result.failures?.[0]?.type === 'timeout' ? 'timeout' : terminalFailure ? (driverName === 'local' && !result.metrics?.toolCalls ? 'no_native_tool_calls' : terminalFailure.code ?? 'model_error') : result.failures?.[0]?.type;
      result.durationMs = Date.now() - start; report.cases.push(result); await save();
      console.log(`${driverName} ${testCase.id}: ${result.score}/100 ${result.success ? 'PASS' : 'FAIL'} ${(result.durationMs / 1000).toFixed(1)}s ${result.failures?.map(f => f.type).join(',') ?? ''}`);
    }
    if (driverName === 'mock') {
      const customer = report.cases.filter(c => /^0[12]-customers/.test(c.id));
      report.mockValidation = { passed: customer.every(c => c.success) && report.cases.filter(c => c.kind === 'cancel').every(c => c.success) && report.cases.filter(c => c.id === '03-orders-list').every(c => !c.success), explanation: 'Repository mock should pass customer list/detail and cancellation, and fail orders semantics; mock is not generalized for these APIs.' };
      if (!report.mockValidation.passed) process.exitCode = 1;
    }
  } catch (error) { report.error = error.message; process.exitCode = 1; }
  finally { await preview?.close(); await env?.close(); await save(); console.log(filePath(output)); }
}
const filePath = url => decodeURIComponent(url.pathname);
async function readEvents(env, id, testCase, timeout, events = []) {
  const controller = new AbortController();
  const token = process.env.EVAL_AUTH_TOKEN ?? env.token;
  const timer = setTimeout(() => controller.abort(new Error('Generation timeout')), timeout);
  const cancelTimer = testCase.kind === 'cancel' ? setTimeout(() => { void json(env.agentUrl + `/generations/${id}/cancel`, {}, token).catch(() => {}); }, 20) : undefined;
  try {
    const response = await fetch(env.agentUrl + `/generations/${id}/events`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal });
    if (!response.ok) throw new Error(`SSE HTTP ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { value, done } = await reader.read(); buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const line = block.split('\n').find(line => line.startsWith('data: ')); if (!line) continue;
        const event = JSON.parse(line.slice(6)); events.push(event);
        if (event.type === 'question' && testCase.kind !== 'cancel') await json(env.agentUrl + `/generations/${id}/answers`, { questionId: event.questionId, answer: testCase.answer }, token);
      }
      if (done) break;
    }
    return events;
  } finally { clearTimeout(timer); clearTimeout(cancelTimer); }
}
function summary(report) {
  const scored = report.cases.filter(c => !c.skipped), success = scored.filter(c => c.success).length;
  const failures = {};
  for (const result of scored) for (const f of result.failures ?? []) failures[f.type] = (failures[f.type] ?? 0) + 1;
  return `# ${report.driver} generation evaluation\n\nModel: ${report.model}. Tool protocol: ${report.toolProtocol ?? 'driver default'}. Started: ${report.startedAt}. Duration: ${(report.durationMs / 1000).toFixed(1)}s.\n\n${report.skip ?? report.error ?? `${success}/${scored.length} cases passed every applicable check (${scored.length ? (100 * success / scored.length).toFixed(1) : 0}%).`}\n\nAuthentication: ${report.auth}.\n\n| Case | Score | Result | Seconds | Failures |\n|---|---:|---|---:|---|\n` + report.cases.map(c => `| ${c.id} #${c.iteration} | ${c.score ?? '—'} | ${c.skipped ? 'SKIP' : c.success ? 'PASS' : 'FAIL'} | ${((c.durationMs ?? 0)/1000).toFixed(1)} | ${c.skipped ?? c.failures?.map(f => f.type).join(', ') ?? ''} |`).join('\n') + `\n\nFailure counts (a case may have several): ${JSON.stringify(failures)}.\n\nConservative Claude cost reserved: $${report.costReservedUsd.toFixed(4)}; this is an upper bound, not a billing measurement.\n\nSecurity probes: ${JSON.stringify(report.security ?? {})}.\n\nLocal 7B limitations and Claude differences are hypotheses unless directly measured: larger models may follow tool schemas and multi-API requests more reliably; this run does not establish Claude quality. This is a small synthetic sample, not production accuracy or a confidence interval.\n`;
}
