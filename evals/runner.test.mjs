import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { main, reserveEvaluationCost, summary, writeReport } from './runner.mjs';

test('Gemini reservations settle to actual cost and keep the global budget across cases', () => {
  const report = { actualCostUsd: 0, reservedCostUsd: 0, peakReservedUsd: 0 };
  const deadline = Date.now() + 60_000;
  const first = reserveEvaluationCost(report, 0.5, deadline, 0.38);
  first(0.024);
  assert.equal(report.actualCostUsd, 0.024);
  assert.equal(report.reservedCostUsd, 0);
  const second = reserveEvaluationCost(report, 0.5, deadline, 0.38);
  assert.throws(() => reserveEvaluationCost(report, 0.5, deadline, 0.12), /budget exhausted/);
  second();
  assert.equal(report.actualCostUsd, 0.404);
  assert.equal(report.reservedCostUsd, 0);
  assert.equal(report.peakReservedUsd, 0.38);
});

test('SKIP and report output use an injected directory and redact the API key', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'toi-runner-'));
  const key = 'fake-gemini-key';
  try {
    await main({ argv: ['--driver', 'gemini'], outputDir: directory, runtimeEnv: { GEMINI_API_KEY: '', GEMINI_MODEL: undefined } });
    const files = await readdir(directory);
    assert.equal(files.length, 2);
    const jsonFile = files.find(file => file.endsWith('.json'));
    const markdownFile = files.find(file => file.endsWith('.md'));
    assert.ok(jsonFile && markdownFile);
    const skippedJson = await readFile(path.join(directory, jsonFile), 'utf8');
    assert.deepEqual(JSON.parse(skippedJson).selfTest, { passed: true, controls: ['unapproved/static/dynamic imports rejected', 'approved/relative imports accepted', 'raw fetch blocked'] });

    const report = { driver: 'gemini', model: 'gemini-3.8-flash', durationMs: 0, cases: [], costReservedUsd: 0, error: `provider rejected ${key}` };
    const output = new URL('redacted.json', `file://${directory}/`);
    await writeReport(report, output, key);
    const json = await readFile(path.join(directory, 'redacted.json'), 'utf8');
    const markdown = await readFile(path.join(directory, 'redacted.md'), 'utf8');
    assert.ok(!json.includes(key));
    assert.ok(!markdown.includes(key));
    assert.equal(JSON.parse(json).error, 'provider rejected [REDACTED]');
    assert.match(summary({ ...report, actualCostUsd: 0.024, peakReservedUsd: 0.38 }), /gemini-3\.8-flash actual cost/);
    assert.doesNotMatch(summary({ ...report, actualCostUsd: 0.024, peakReservedUsd: 0.38 }), /Claude cost/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
