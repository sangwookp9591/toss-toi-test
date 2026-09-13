# P0A identity / membership / approval / environments

Date: 2026-09-13. Ownership: P0A server/infra/scripts; P0A2 studio/E2E; P0D local driver and evals. No contracts, preview-runtime, deps-builder or driver files were edited by P0A. No commits were made.

## Delivered

- Keycloak 26.3.3 in Compose on loopback 8080, persistent data volume, toi realm with five users, groups/realm roles, PKCE S256 public studio client, confidential service accounts, toi-api audience and groups mapper, 300-second access and 1800-second session/refresh limits.
- `scripts/dev-up.mjs` creates random independent passwords/client secrets/environment credentials in ignored `.env` with mode 0600, waits for Keycloak, provisions credentials and the agent's view-users permission with the admin API, records user UUIDs, and starts the services. The realm JSON has no credentials. `--check` remains available.
- Both services verify Keycloak RS256 tokens via pinned jose 6.1.3 and HTTP JWKS. Agent only accepts studio users on public APIs and the exact policy service account on internal membership. Registry admits studio users and the exact agent service account. User impersonation through azp alone is rejected.
- Atomic persisted project memberships, owner/editor/viewer checks, nonmember 404, owner-only identity lookup/member mutation, final-owner protection and version increments. SSE ends on membership removal or identity expiration. Existing generation/CAS/source/revision checks are preserved.
- Preview sessions require studio Origin, carry toi-preview/viewer/project scope and never extend beyond the Keycloak token. Capability/proxy authorization queries service-authenticated membership without a cache. Existing sessions stop working on the next request after member removal.
- Persistent approval requests/decisions with registered API-owner + realm-role checks, requester/approver separation, owner recheck, duplicate-decision rejection and expiration enforced on both live write issuance and use.
- Environment-selected upstream and credentials, distinct preview/live memory datasets and observable dataset markers, cross-environment service-token rejection. Public registry omits environment addresses.
- Existing Origin, path encoding/allowlist, masking, public schema sanitization, durable append-before-response and secret redaction remain. Legacy /dev/session is removed; old benchmark/smoke scripts require an actual Keycloak access token rather than minting one.

## Verification

- `npm --prefix services/agent-server run typecheck` and `npm --prefix services/agent-server test`: 97 passed, one pre-existing explicit live-Claude opt-in skipped.
- `npm --prefix services/policy-proxy run typecheck` and `npm --prefix services/policy-proxy test`: 132 passed. Count changed from intermediate 139 because seven obsolete checks for the removed single upstream secret were replaced by independent preview/live checks.
- `npm --prefix services/mock-backend run typecheck` and `npm --prefix services/mock-backend test`: 5 passed.
- `node --test scripts/dev-up.test.mjs`: 5 passed; realm credentials absence, PKCE/audience/client configuration and installation inventory are checked. Policy dev-up test separately checks all 12 generated values and 0600 permissions/reuse.
- Full `node scripts/dev-up.mjs` flow completed in 13 seconds after the initial Keycloak image pull. E2E integration instance used TOI_APPROVAL_TTL_SEC=8; normal default remains 300 seconds. The final dev-up supports `--e2e` to set 8 seconds and reconfigure the managed policy process; normal dev-up restores 300, both transitions were exercised successfully.
- Actual Keycloak client credentials exchange: 200; agent service registry read: 200; `npm --prefix services/agent-server run smoke:policy` completed a generation using the live registry and wrote `services/agent-server/evidence/policy-integration.json`.
- P0A2 completed actual Keycloak UI-login A–S and all existing scenarios: 23 cases × 3 = 69 passed, 0 unexpected, 0 skipped, 0 flaky, 374570 ms (6.2 minutes), confirmed from `e2e/artifacts/results.json`. Studio typecheck/build and 9 authentication unit tests passed; details are in `e2e/P0A2-REPORT.md`. The first round exposed E/J/L test polling before asynchronous SSO initialization; P0A2 fixed the test wait and the final complete repeat passed.
- Changed P0A paths pass `git diff --check`. Services were held stable during P0A2's E2E run. After the successful repeat, policy was restarted via plain `node scripts/dev-up.mjs` (14.4 seconds, exit 0) to restore the normal approval TTL of 300 seconds. The 69-case run used TTL8; P derives its wait from expiresAt and supports default300. All 91 scanned owned files had zero configured secret matches.

## Boundaries and remaining work

Account disablement prevents refresh; existing signed access tokens may live for at most five minutes, and derived preview credentials cannot outlive them. Membership removal is checked on every proxy request. Anonymous projects from before this migration are intentionally inaccessible until re-created under a real owner; legacy registry entries without environments are not exposed and customers is re-seeded.

P0-3 fsync/hash-chain audit replication and encrypted downloads are the next wave; PolicyAuditRecord currently omits the not-yet-implemented chain fields while preserving the new action field for proxy records. Per-project preview origins and service env allowlists remain P0-2 ownership. Operational Keycloak HA/external database/TLS/enterprise IdP are outside this local development scope.

References: [Keycloak container import](https://www.keycloak.org/server/containers), [jose JWT verification](https://github.com/panva/jose/blob/main/src/jwt/verify.ts).

## Coordinator rerun

```sh
node scripts/dev-up.mjs --e2e
npm --prefix services/agent-server run typecheck
npm --prefix services/agent-server test
npm --prefix services/policy-proxy run typecheck
npm --prefix services/policy-proxy test
npm --prefix services/mock-backend run typecheck
npm --prefix services/mock-backend test
npm --prefix apps/studio run typecheck
npm --prefix apps/studio test
npm --prefix e2e run test:repeat
node scripts/dev-up.mjs
```

The final line restores default approval TTL300. Explicit TOI_APPROVAL_TTL_SEC values are still supported. An externally launched proxy must be stopped by its owner before --e2e can reconfigure it. Without --e2e, P permits 380 seconds and waits the actual approval expiresAt; the recorded 69-case run used the fast TTL8 path.
