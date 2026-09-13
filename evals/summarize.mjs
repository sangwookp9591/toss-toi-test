// Run through the repository tsx loader, like the scorer tests.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { score } from './score.mjs';
const inputs = process.argv.slice(2);
if (!inputs.length) throw new Error('Pass completed model report JSON paths');
const scorerSha256 = createHash('sha256').update(await readFile(new URL('score.mjs', import.meta.url))).digest('hex');
const reports = [];
for (const input of inputs) {
  const report = JSON.parse(await readFile(input, 'utf8'));
  const label = report.driver === 'local' ? `local/${report.toolProtocol ?? 'native'}` : report.driver;
  const cases = [];
  for (const result of report.cases) {
    const testCase = JSON.parse(await readFile(new URL(`cases/${result.id}.json`, import.meta.url), 'utf8'));
    // Re-score saved observations with one final scorer; never rerun or fabricate model output.
    const rescored = result.project && !result.failures?.some(f => ['timeout','harness_or_service'].includes(f.type)) ? score(testCase, result.events, result.project, result.preview, result.metrics ?? {}) : result;
    const failure = result.events?.find(e => e.type === 'failed');
    let primaryFailure = null;
    if (!rescored.success) {
      if (result.failures?.some(f => f.type === 'timeout')) primaryFailure = 'timeout';
      else if (failure) primaryFailure = report.driver === 'local' && !result.metrics?.toolCalls ? 'no_tool_calls' : result.metrics?.stagedPolicyViolations?.length ? 'source_policy_blocked' : failure.code ?? 'model_error';
      else if (result.preview?.event?.type === 'build_failed') primaryFailure = 'build_failure';
      else if (result.preview?.event?.type === 'runtime_failed' || result.preview?.runtimeErrors?.length) primaryFailure = 'runtime_failure';
      else if (result.preview?.forbiddenRequests?.length) primaryFailure = 'forbidden_network_attempt';
      else if (result.preview?.error) primaryFailure = 'preview_or_service_error';
      else primaryFailure = rescored.failures?.[0]?.type ?? 'skipped';
    }
    cases.push({ id: result.id, kind: testCase.kind, iteration: result.iteration, originalScore: result.score, score: rescored.score, success: rescored.success, failures: rescored.failures, primaryFailure, durationMs: result.durationMs, metrics: result.metrics, generationCompleted: result.events?.some(e => e.type === 'done') ?? false, previewCommitted: result.preview?.event?.type === 'committed', diagnostics: result.preview?.event?.diagnostics ?? (result.preview?.event?.error ? [result.preview.event.error] : []), stagedPolicyViolations: result.metrics?.stagedPolicyViolations ?? [] });
  }
  const categories = {};
  for (const c of cases) if (c.primaryFailure) categories[c.primaryFailure] = (categories[c.primaryFailure] ?? 0) + 1;
  reports.push({ label, source: input, durationMs: report.durationMs, model: report.model, limits: report.limits, categories, cases });
}
const ids = [...new Set(reports.flatMap(r => r.cases.map(c => c.id)))].sort();
let markdown = '# Generation evaluation comparison\n\nAll saved observations rescored with score.mjs SHA-256 `' + scorerSha256 + '`. Original scores remain in the input reports; raw events and source were not changed.\n\n';
markdown += '| Mode | All checks passed | Business UI passed (excludes controls) | Generation done | Preview committed | Seconds | Primary failures |\n|---|---:|---:|---:|---:|---:|---|\n';
for (const r of reports) markdown += `| ${r.label} | ${r.cases.filter(c => c.success).length}/${r.cases.length} | ${r.cases.filter(c => !['cancel','fault'].includes(c.kind) && c.success).length}/${r.cases.filter(c => !['cancel','fault'].includes(c.kind)).length} | ${r.cases.filter(c => c.generationCompleted).length}/${r.cases.length} | ${r.cases.filter(c => c.previewCommitted).length}/${r.cases.length} | ${(r.durationMs/1000).toFixed(1)} | ${JSON.stringify(r.categories)} |\n`;
markdown += '\n| Case | ' + reports.map(r => r.label + ' score / passed').join(' | ') + ' |\n|---|' + reports.map(() => '---:').join('|') + '|\n';
for (const id of ids) markdown += '| ' + id + ' | ' + reports.map(r => { const cases = r.cases.filter(c => c.id === id); return cases.map(c => `${c.score ?? '—'} / ${c.success ? 'PASS' : 'FAIL'}`).join(', '); }).join(' | ') + ' |\n';
markdown += '\n| Mode | Tool calls | Tool errors | Turns | Input tokens (reported) | Output tokens (reported) |\n|---|---:|---:|---:|---:|---:|\n';
for (const r of reports) markdown += '| ' + r.label + ' | ' + ['toolCalls','toolErrors','turns','inputTokens','outputTokens'].map(key => r.cases.some(c => c.metrics?.[key] != null) ? r.cases.reduce((sum,c) => sum + (c.metrics?.[key] ?? 0),0) : 'unavailable').join(' | ') + ' |\n';
markdown += '\nSource reports: ' + reports.map(r => `[${r.label}](${basename(r.source)})`).join(', ') + '.\n\nLocal native and JSON-content runs are separate serial experiments; JSON-content accepts only a whole single tool object and validates its name/arguments through the same schema and engine. Token counts include completed Ollama responses only; timed-out responses may have additional unreported tokens. Cancellation and malformed-argument safe failure are lifecycle controls rather than generated business screens. A tool_error terminal with the injected fault, unchanged revision, and no late mutation passes the failure control; UI quality is reported separately.\n\nThese are 14 synthetic cases, one pass each; no confidence interval or production quality claim is warranted. Claude was not measured; improvements from a larger model are hypotheses. See ../README.md for security findings and browser/authentication limitations.\n';
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const output = new URL(`results/comparison-${stamp}`, import.meta.url);
await writeFile(output.pathname + '.json', JSON.stringify({ scorerSha256, reports }, null, 2) + '\n');
await writeFile(output.pathname + '.md', markdown);
console.log(output.pathname + '.md');
