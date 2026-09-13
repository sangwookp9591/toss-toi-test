# P0A2 K flake and identity cleanup follow-up

The coordinator's full rerun found 68 passes and one K timeout failure. A route counter alone reproduced it, and installing the clock before navigation alone also reproduced it. The product's dependency timeout is registered synchronously before its first fetch, so inspection did not support a product timeout-registration race.

Read-only Keycloak inspection found realm access TTL 300 seconds but a residual `toi-studio` client TTL override of 4 seconds. R's old cleanup resent an attribute map without that key; Keycloak merges client attributes and does not delete omitted keys. In addition, the studio unconditionally invalidated auth on an expiry event even when proactive renewal was already waiting for the network, briefly unmounting/recreating the workspace and restarting the pending preview.

## Changes

- K installs its clock before navigation, counts the actual intercepted dependency wait request, and polls for that request before advancing 90001ms. No Date freeze or mocked identity response is used. This follows [Playwright's clock initialization requirements](https://playwright.dev/docs/clock).
- Auth expiry joins the existing renewal promise, retaining workspace state until success or failure is known. Requests still await renewal rather than returning expired credentials. Failed renewal clears identity, and an epoch check prevents a late renewal from undoing logout.
- R is a serial test group and asserts one configured worker. Its permitted shared-client fallback is necessary because both service user validators require `azp=toi-studio`; a separate public client cannot exercise accepted user API calls without altering that boundary. Cleanup explicitly sends the original TTL value or null for an originally absent key, then verifies the live value. It restores bob and the client in finally.
- R now delays the first real refresh 4.5 seconds with actual TTL4 while a dependency request is pending. It observes two successful renewals and checks the controller reference, project ID, wait-request count and pending status are preserved before testing bob revocation.
- With coordinator authorization, the residual live TTL4 override was removed through admin API. Readback showed the client TTL attribute absent and realm TTL300. The new R cleanup also confirmed the attribute stayed absent afterward. No service was restarted.

## Validation

- Studio typecheck, build and 12 unit tests passed. The added tests cover expiry during pending renewal, failed renewal, stale expiry events and logout racing with a late response.
- `npx playwright test tests/identity.spec.ts`: 6 passed in 47.7 seconds, including actual delayed short-token renewal and restored-TTL readback. Evidence: `artifacts/identity-fix-results.json`.
- Final `npx playwright test -g "K:" --repeat-each=10`: **20 passed (2.1 minutes), 0 failed, 0 skipped, 0 flaky**, with no Date freeze. Evidence: `artifacts/k-fix-results.json`.

The shared-client fallback means independent suites must not concurrently mutate this realm during R; the in-repository suite enforces one worker. This follow-up does not claim a new full A–S three-round run; the coordinator can run that combined acceptance after integrating the fix.
