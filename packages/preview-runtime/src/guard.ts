import type { RevisionToken } from '../../../contracts/src/runtime.ts';
export function sameToken(a: RevisionToken | undefined, b: RevisionToken | undefined): boolean {
  return !!a && !!b && a.projectId === b.projectId && a.revision === b.revision && a.attemptId === b.attemptId && a.sourceDigest === b.sourceDigest && a.manifestDigest === b.manifestDigest;
}
export function tokenKey(token: RevisionToken): string {
  return JSON.stringify([token.projectId, token.revision, token.attemptId, token.sourceDigest, token.manifestDigest]);
}
export function commitDecision(token: RevisionToken, desired: RevisionToken | undefined, canceled: boolean, rendered: boolean): 'commit' | 'canceled' | 'manifest_mismatch' | 'superseded' | 'runtime_failed' {
  if (canceled) return 'canceled';
  if (desired && token.manifestDigest !== desired.manifestDigest) return 'manifest_mismatch';
  if (!sameToken(token, desired)) return 'superseded';
  return rendered ? 'commit' : 'runtime_failed';
}
