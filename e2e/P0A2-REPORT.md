# P0A2 implementation and validation

Owned changes are confined to `apps/studio/**` and `e2e/**`. No contracts, service source, infrastructure or shared scripts were edited by this worker, and no commit was created.

## Delivered

- Public Keycloak OIDC code + PKCE login, SSO logout, memory-only user tokens, transient sessionStorage PKCE state and SSO-cookie restoration after reload/new tab. Public build settings are VITE_OIDC_ISSUER and VITE_OIDC_CLIENT_ID; oidc-client-ts is pinned at 3.3.0.
- Central Bearer injection for agent/policy HTTP and SSE, concurrent refresh coalescing, one retry per 401, and login/403/404 guidance. Identity credentials are excluded from builder requests.
- Owner membership username lookup, add/change/remove, last-owner error, viewer control hints; live approval requests/status and API-owner decisions by project ID.
- Preview host configuration accepts only downgraded preview-session/capability fields. Existing revision guards, Origin boundaries, CAS backup/recovery and capability countdown remain intact.
- Real UI-login E2E fixtures retain credentials/tokens/storageState in worker memory, with tracing/video/automatic screenshots disabled. R restores bob's enabled state and the Keycloak public client TTL in finally.

## Validation

- Studio typecheck and build: passed.
- Separate actual Keycloak UI login/logout smoke check: passed; logout returned the login prompt and removed the studio controller.
- Studio auth unit tests: 9 passed, covering anonymous/restored state, refresh failure, parallel renewal, Bearer/SSE injection, retry ceiling, destination restriction, memory storage and preview token allowlisting.
- Full repeated E2E: **69 passed (6.2 minutes), 0 failed, 0 skipped, 0 flaky** — all 23 A–S/recovery/layout cases passed three times. Raw evidence: `artifacts/results.json`.
- Credential-value scan of 23 build/artifact files found zero .env credential matches; explicit studio screenshot inspected.
- git diff --check for owned paths: passed.

The first integrated run found the old E/J/L snapshot helper assumed synchronous application startup. The helper now tolerates the OIDC initialization interval and keeps polling for the actual committed revision. Account UI login explicitly starts with empty storageState to avoid inheriting the fixture's alice cookies when authenticating another user.

## Reproduction

Run `node scripts/dev-up.mjs`, then `npm --prefix e2e run test:repeat`. This worker's integrated run uses the P0A worker's policy service with TOI_APPROVAL_TTL_SEC=8 to exercise real expiration quickly. P also supports the default 300 seconds by deriving its wait from the server's expiresAt value and using a 380-second test timeout. The short override changes no authorization decision.

No service restart was performed by this worker. P0A owns startup and any restoration of the optional short approval TTL.
