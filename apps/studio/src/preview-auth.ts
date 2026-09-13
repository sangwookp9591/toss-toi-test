import type { PreviewSession } from '../../../contracts/src/auth.ts';
import type { PreviewHostConfig } from '../../../contracts/src/runtime.ts';
// Deliberate field allowlist: never spread identity or API response objects into a frame.
export function previewHostConfig(session: PreviewSession, projectId: string, _proxyBaseUrl?: string): PreviewHostConfig {
  if (session.sessionClaims.projectId !== projectId || session.capability.projectId !== projectId || session.sessionClaims.aud !== 'toi-preview' || session.sessionClaims.roles.length !== 1 || session.sessionClaims.roles[0] !== 'viewer' || session.capability.env !== 'preview') throw new Error('Preview credentials do not belong to this project');
  return { toiFetch: { projectId, env: 'preview', transport: 'broker' } };
}
