# P0B encrypted downloads and tamper-evident audit

Date: 2026-09-13. Worker owns policy-proxy, the new download panel plus its single studio mount, and downloads.spec.ts. No contracts, package runtime, agent, mock, deps, shared E2E helpers, infra or dev-up files were edited by this worker; P0C owns coordinated infra/env/restarts and preview isolation.

## Delivered

- POST downloads reuses the existing proxy authorization/upstream/masking path, with Keycloak user, current editor membership, matching body/header project, read capability, exact studio Origin, mandatory reason, registered normalized GET and 10000-row limit.
- CSV formula hardening and XLSX export; pinned exceljs 4.4.0, zip.js 2.14.1 and AWS S3 SDK 3.1131.0. ZIP is WinZip AE-2 AES-256; random password is shown only in POST and retained as salted scrypt hash. ZIP is created in memory at POST before envelope encryption so GET needs no retained/recoverable password; coordinator approved this order.
- Fresh AES-256-GCM data key per file, GCM KEK wrapping with distinct nonce/AAD, ciphertext digest, MinIO encrypted object, durable metadata, signed 60-second URL bound to downloadId/requestedBy/exp, Keycloak subject hiding (404), bad signature (403), expiry/use (410), durable serialized one-use reservation, first delivery/retention cleanup and crash recovery tombstones. No plaintext content temporary files.
- Serial seq/prevHash/canonical SHA-256 audit with per-append fdatasync, immutable conditional MinIO segment writes, retries/health lag, startup/admin verification of local chain/legacy/remote segments/local replica inventory, and latched fail-closed 503 except health. All seven action categories are recorded. Legacy bytes are preserved and SHA-256 anchored in the first new chain record.
- Contract project origins replace fixed localhost:5174, with header/session/capability project matching. Existing security checks remain; test fixtures use distinct mock tokens and new project origins, while browser direct upstream fetch is now correctly asserted as CORS-blocked with unauthenticated HTTP 401 separately.
- Studio password panel keeps secrets in transient state, clears on close/project change, offers copy, and saves ZIP with Bearer fetch. E2E cleanup clears the displayed password before failure-context capture.
- README documents env names, key rotation limitations, metadata/retention, audit verification/replication/recovery, and operational KMS/WORM requirements.

## Verification

- Policy `npm run typecheck`: passed.
- Policy `npm test`: 156 passed, 6 suites, no skipped or failed tests, 3.03 seconds in the recorded final targeted run. Includes envelope/key/context/ciphertext checks, CSV formulas, AE-2/AES strength and password checks, auth/origin/signed URL/race/retention cases, concurrent audit sequence, local/remote tamper/deletion/truncation and malformed replica inventory, replication retry, legacy and isolated HTTP fail-closed tests.
- Studio `npm run typecheck` and `npm run build`: passed.
- Actual services `cd e2e && npx playwright test tests/downloads.spec.ts`: T/U/V/W plus UI, 5 passed in 1.1 minutes. T waits the real signed URL deadline and uses real Keycloak accounts; V reads actual policy-scoped MinIO bytes and observes object/wrapped-key deletion; W checks live chain continuity and secret absence.
- Health after live tests reported valid chain, replicationPending=0, replicationLagMs=0, replicationAvailable=true.
- An initial E2E invocation from repository root omitted the E2E config; it passed API T/U/W but failed UI baseURL and a deletion metadata race in V. The proper configured rerun passed all five; V now waits for both object deletion and synced metadata.
- Source/doc secret scan: 42 owned files checked against local configured secrets, zero matching files; git diff --check passed.
- Final combined `npm --prefix e2e run test:repeat`: **99 passed (33 scenarios × 3), 0 unexpected, 0 skipped, 0 flaky**, 454482 ms (7.6 minutes), start 2026-09-13 12:12:48 UTC. Latest policy implementation was running after P0C restart. Every T/U/V/W and download UI scenario passed three times alongside existing A–S and isolation X–AB. Evidence: `e2e/artifacts/results.json`, `e2e/artifacts/p0c-repeat-final.log`, `e2e/artifacts/p0c-validation.json`. P0C rechecked bob enabled and the temporary Keycloak client TTL removed after the final test.
- Initial combined-run O selected both panels by a generic CSS class, and a studio helper evaluated before SSO navigation settled; P0C repaired those test selectors/waits, targeted 27 passed, then the final 99-test repeat passed.
- P0C-requested managed-env guard was also applied to policy `scripts/publish-client.mjs`; `node --check` passed.
- No requested implementation or validation work remains. Operational limitations below are documented deployment prerequisites.

## Operational boundaries

One writer process per audit/data directory; a shared multiprocess deployment needs external sequencing/locking. Current KEK configuration has one active version: drain/delete retained files before rotation, or add KMS versioned unwrap/rewrap. Local prototype hash chains need independently administered WORM checkpoints to survive compromise of all local and object-store administration; README contains recovery guidance. ZIP data and file buffers are cleared but JavaScript/library-owned string memory cannot be physically erased on demand. Replication unavailability is reported as lag and allows requests; verified content mismatch latches fail-closed. All service/env/restart changes were coordinated through the active Orca dispatch.
