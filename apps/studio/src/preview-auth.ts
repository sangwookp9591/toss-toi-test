import type { PreviewSession } from '../../../contracts/src/auth.ts';
import type { PreviewHostConfig } from '../../../contracts/src/runtime.ts';
// Deliberate field allowlist: never spread identity or API response objects into a frame.
export function previewHostConfig(session: PreviewSession, projectId: string, proxyBaseUrl: string): PreviewHostConfig {
  return { toiFetch: { sessionToken: session.sessionToken, capabilityToken: session.capabilityToken, projectId, proxyBaseUrl, env: 'preview' } };
}
