import { describe, it, expect } from 'vitest';
import { mergeVfs, sourceDigest, isAllowedExternal, resolveVfsPath } from '../src/vfs.ts';
import { commitDecision, sameToken } from '../src/guard.ts';
import type { RevisionToken } from '../../../contracts/src/runtime.ts';

const token: RevisionToken = { projectId: 'p', revision: 11, attemptId: 'a', sourceDigest: 's', manifestDigest: 'm' };
describe('VFS', () => {
  it('merges all four layers with user > project > template > runtime', () => {
    expect(mergeVfs({ runtime: { '/a.ts': 'r', '/b.ts': 'r', '/c.ts': 'r', '/d.ts': 'r' }, template: { '/a.ts': 't', '/b.ts': 't', '/c.ts': 't' }, project: { '/a.ts': 'p', '/b.ts': 'p' }, user: { '/a.ts': 'u' } })).toEqual({ '/a.ts': 'u', '/b.ts': 'p', '/c.ts': 't', '/d.ts': 'r' });
  });
  it('normalizes paths and hashes merged content independent of key insertion order', async () => {
    expect(await sourceDigest({ '/b.ts': 'b', '/src/../a.ts': 'a' })).toBe(await sourceDigest({ '/a.ts': 'a', '/b.ts': 'b' }));
    expect(await sourceDigest({ '/a.ts': 'a' })).not.toBe(await sourceDigest({ '/a.ts': 'edit' }));
  });
  it.each(['tsx', 'ts', 'jsx', 'js'])('resolves relative extension and index.%s', ext => {
    const files = { [`/src/App.${ext}`]: '', [`/src/lib/index.${ext}`]: '' };
    expect(resolveVfsPath('./App', '/src/main.tsx', files)).toBe(`/src/App.${ext}`);
    expect(resolveVfsPath('../lib', '/src/nested/main.tsx', files)).toBe(`/src/lib/index.${ext}`);
  });
});
describe('exact externals', () => {
  const imports = { react: 'url', 'react-dom/client': 'url2' };
  it.each(['react/jsx-runtime', 'react/subpath', 'react-dom', 'react-dom/client/deeper', 'toString', 'https://evil.invalid/x.js'])('rejects %s', specifier => expect(isAllowedExternal(specifier, imports)).toBe(false));
  it('accepts only explicit own keys', () => { expect(isAllowedExternal('react', imports)).toBe(true); expect(isAllowedExternal('react-dom/client', imports)).toBe(true); });
});
describe('revision guard acceptance table', () => {
  it('r11 success followed by late r10 only commits r11', () => {
    expect(commitDecision(token, token, false, true)).toBe('commit');
    expect(commitDecision({ ...token, revision: 10 }, token, false, true)).toBe('superseded');
  });
  it('r11 failure followed by r10 success preserves r9', () => {
    expect(commitDecision(token, token, false, false)).toBe('runtime_failed');
    expect(commitDecision({ ...token, revision: 10 }, token, false, true)).toBe('superseded');
  });
  it('same revision old manifest or attempt cannot commit', () => {
    expect(commitDecision(token, { ...token, manifestDigest: 'new' }, false, true)).toBe('manifest_mismatch');
    expect(commitDecision(token, { ...token, attemptId: 'new' }, false, true)).toBe('superseded');
  });
  it('cancellation rejects late completion', () => expect(commitDecision(token, token, true, true)).toBe('canceled'));
  it.each(['projectId', 'revision', 'attemptId', 'sourceDigest', 'manifestDigest'] as const)('compares %s', key => {
    expect(sameToken(token, { ...token, [key]: key === 'revision' ? 12 : 'different' })).toBe(false);
  });
});
