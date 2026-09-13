import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hashes, canonicalJson } from '../src/hash.js';
import { defaultProfile } from '../src/config.js';
import { safeLogger, validateRequest } from '../src/security.js';
test('Toss hash matches original PoC fixture and reacts to raw lock bytes', async () => {
  const lock = await readFile(new URL('../../../poc/install-bench/yarn-classic-1/yarn.lock', import.meta.url));
  const entries = ['react', 'react-dom/client', '@tanstack/react-query'], profile = defaultProfile();
  const baseline = hashes(entries, lock, profile);
  assert.equal(baseline.tossPackageSetHash, '165bdc14048005a3');
  assert.deepEqual(hashes([...entries].reverse(), lock, profile), baseline);
  assert.notEqual(hashes(entries, Buffer.concat([lock, Buffer.from('\n')]), profile).tossPackageSetHash, baseline.tossPackageSetHash);
  for (const change of [{ builderVersion: 'next' }, { configDigest: 'changed' }, { nodeEnv: 'development' as const }]) {
    const changed = hashes(entries, lock, { ...profile, ...change });
    assert.equal(changed.tossPackageSetHash, baseline.tossPackageSetHash);
    assert.notEqual(changed.artifactKey, baseline.artifactKey);
  }
  assert.equal(canonicalJson({ b: 2, a: { z: 1, b: 3 } }), canonicalJson({ a: { b: 3, z: 1 }, b: 2 }));
});
test('log sink masks literal, URI and base64 secrets and auth headers', () => {
  const token = 'sensitive/token+value', lines: string[] = [];
  const log = safeLogger([token], line => lines.push(line));
  log(new Error(`install ${token} ${encodeURIComponent(token)} ${Buffer.from(token).toString('base64')} Bearer another-token npmAuthToken=secret-value`));
  assert.equal(lines.length, 1);
  for (const secret of [token, encodeURIComponent(token), Buffer.from(token).toString('base64'), 'another-token', 'secret-value']) assert.ok(!lines[0].includes(secret));
  assert.match(lines[0], /REDACTED/);
});
test('validation rejects undeclared entries, local/URL/git dependencies and traversal', () => {
  for (const request of [{ entries: ['react'], dependencies: {} }, { entries: ['react'], dependencies: { react: 'file:/etc' } }, { entries: ['react'], dependencies: { react: 'https://user:secret@example.test/a.tgz' } }, { entries: ['react/../secret'], dependencies: { react: '19.3.0' } }]) assert.throws(() => validateRequest(request));
});
