import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const here = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(here, '../../..');
const reportPath = path.join(here, '../TOSS-GAP.md');
const report = await readFile(reportPath, 'utf8');
const result = JSON.parse(await readFile(path.join(here, 'results.json'), 'utf8'));
assert.equal(result.samples.length, 6);
assert.equal(result.serviceRestored, true);
for (const network of ['local', 'slow']) {
  const samples = result.samples.filter(s => s.network === network);
  assert.equal(samples.length, 3);
  for (const key of ['missMs', 'hitMs', 'editMs']) {
    const values = samples.map(s => s[key]);
    assert.ok(values.every(n => Number.isFinite(n) && n > 0));
    assert.equal(result.medians[network][key], [...values].sort((a, b) => a - b)[1]);
    for (const value of values) assert.ok(report.includes(value.toFixed(1)), `Missing table value ${value.toFixed(1)}`);
  }
  for (const sample of samples) {
    assert.equal(sample.success, true); assert.equal(sample.error, undefined);
    assert.deepEqual(sample.missPostStatuses, [202]); assert.deepEqual(sample.hitPostStatuses, [200]); assert.deepEqual(sample.editPostStatuses, [200]);
    assert.deepEqual(sample.builderMetrics, { installs: 1, builds: 1 });
    for (const kind of ['miss', 'hit']) {
      const wasm = sample[kind + 'WorkerResources'].flat().find(r => r.name === '/esbuild.wasm');
      assert.equal(wasm.encodedBodySize, 13978850);
      if (network === 'slow') assert.ok(wasm.duration > 18000);
    }
  }
}
const rows = report.split('\n').map(line => line.split('|').map(s => s.trim())).filter(c => /^[A-F][1-9]$/.test(c[1] ?? ''));
assert.equal(rows.length, 40);
const counts = {};
for (const row of rows) counts[row[3]] = (counts[row[3]] ?? 0) + 1;
assert.deepEqual(counts, { '부분': 12, '동등': 14, '없음': 9, '다름(의도적 개선)': 3, '확인 불가(토스 비공개)': 2 });
assert.equal((100 * (14 + 3 + 12 * .5) / 38).toFixed(1), '60.5');
for (let i = 1; i <= 6; i++) assert.ok(report.includes(`## ${i}.`));
assert.ok(!report.includes('작성 중'));
let linksChecked = 0;
for (const match of report.matchAll(/\[[^\]]*\]\(([^)]+)\)(?::(\d+))?/g)) {
  if (/^https?:/.test(match[1])) continue;
  const target = path.resolve(path.dirname(reportPath), match[1].split('#')[0]);
  assert.ok((await stat(target)).isFile(), `Missing link ${match[1]}`);
  if (match[2]) assert.ok(Number(match[2]) <= (await readFile(target, 'utf8')).split('\n').length, `Invalid line ${match[0]}`);
  linksChecked++;
}
const paths = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await walk(file); else paths.push(file);
  }
}
await walk(path.dirname(here));
const env = await readFile(path.join(root, '.env'), 'utf8');
const secrets = env.split('\n').map(line => /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)).filter(Boolean)
  .filter(m => /SECRET|TOKEN|PASSWORD|API_KEY/.test(m[1])).map(m => m[2].replace(/^['"]|['"]$/g, '')).filter(value => value.length >= 8);
let matches = 0;
for (const file of paths) {
  const text = await readFile(file, 'utf8');
  for (const value of secrets) if (text.includes(value)) matches++;
}
assert.equal(matches, 0, 'Secret detected (value withheld)');
const trackedDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(trackedDiff, '', 'Unexpected tracked file change');
const status = execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
assert.ok(status.every(line => line.startsWith('?? docs/compare/')), 'Out-of-scope file change');
const health = {};
for (const [port, endpoint] of [[5173, '/healthz'], [5174, '/healthz'], [7100, '/healthz'], [7200, '/healthz'], [7400, '/healthz'], [4873, '/-/ping'], [9000, '/minio/health/live']]) {
  const response = await fetch(`http://localhost:${port}${endpoint}`, { signal: AbortSignal.timeout(5000) });
  assert.ok(response.ok); health[port] = response.status;
  if (port === 7400) assert.equal((await response.json()).agentMode, 'mock');
}
const restoredBuilderPid = Number(execFileSync('lsof', ['-t', '-iTCP:7100', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim());
const summary = { checkedAt: new Date().toISOString(), passed: true, completedScenarioMeasurements: 18, featureRows: 40,
  counts, score: { numerator: 23, denominator: 38, percent: 60.5 }, linksChecked,
  secretsChecked: secrets.length, secretMatches: matches, trackedDiffEmpty: true, onlyCompareFilesChanged: true,
  health, agentMode: 'mock', restoredBuilderPid, restoredBuilderManagedByDevDown: false };
await writeFile(path.join(here, 'validation.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
