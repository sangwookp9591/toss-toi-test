# F3-B external audit anchors and retention

Date: 2026-09-13. Scope: policy-proxy source/tests/README/bench and storage provisioning; no commits. F3-A owns broker/client, service env allowlist and all shared service restarts.

## Delivered

- Immutable conditional anchors at `audit/anchors/<20-digit seq>-<hash>`, canonical `{seq,hash}` body, one-second/50-record cadence; download-create, download-fetch and approval await successful anchoring before response.
- Startup/admin verification checks the latest external anchor against the local chain and latches `brokenAt` on missing local tail, wrong hash or duplicate head sequence. Existing unanchored chains migrate only after external discovery succeeds. `anchorSeq` reports the latest remote sequence and `anchoredThrough` the sequence confirmed against local content.
- Bounded `StartAfter`/`MaxKeys` exponential and binary lookup: O(log seq) requests, at most one key per search response, two for duplicate-head detection. No mutable head pointer, full anchor inventory, or retention-bypassing garbage collection.
- Retry health, degraded and admission thresholds; timer work coalesces during slow storage operations. SIGTERM/SIGINT immediately flush anchors and segments, then flush again after active requests finish; failed shutdown reports a nonzero exit.
- S3 segment/anchor writes set COMPLIANCE retention (env `TOI_AUDIT_RETENTION_DAYS`, default 1 day, validated integer 1–36500). Download objects remain deletable. Provisioning verifies a short-lived retained object in an isolated probe bucket and removes it and the bucket after expiry.
- Every recognized preview-origin request, including health and preflight, returns 403 `PREVIEW_DIRECT_FORBIDDEN` without CORS. Studio broker requests retain session/capability/membership enforcement.

## Anchor window and failure behavior

| State | Normal records | download-create / download-fetch / approval | Observable state |
|---|---|---|---|
| Storage healthy | fdatasync before response; anchor every 1 second or 50 records | Response waits for its anchor | `anchorSeq == anchoredThrough` at committed head |
| First anchor failure through 5 seconds | Continue within admission window | 503 when anchor cannot be committed | `anchorAvailable=false`, failure age reported |
| Failure >5 seconds through 30 seconds | Continue | 503 | `/healthz` HTTP 200, `status=degraded` |
| Failure >30 seconds | New requests 503 `AUDIT_ANCHOR_UNAVAILABLE` | Same | Health stays reachable and degraded |
| Storage recovers | Automatic retry reopens admission | New records can succeed after anchoring | Failure state clears |
| Startup external discovery unavailable | Reject until the existing external head can be checked | Same | No blind migration over an unknown head |
| Chain/anchor disagreement | 503 `AUDIT_CHAIN_BROKEN` latched | Same | `brokenAt` and remote `anchorSeq` retained |
| SIGTERM / SIGINT | Stop admission, flush all pending segments and head | Drain requests, flush again | Clean exit only if flush succeeds |

Cadence is a target under available storage and a responsive event loop; ordinary records in the latest uncommitted interval (normally <1 second / <50 records) remain vulnerable to abrupt host loss or truncation followed by restart. External storage latency and outages extend that interval; important-record success responses have no unanchored window. Upstream writes already performed cannot be rolled back by a later audit failure.

## Verification

- `npm --prefix services/policy-proxy run typecheck`: passed.
- `npm --prefix services/policy-proxy test`: **176 passed, 8 suites, zero failed/skipped**, 8.89 seconds at 2026-09-13 13:28:55 UTC.
- New coverage: line-boundary unreplicated tail truncation after restart, anchor mismatch/duplicate sequence, initial migration and startup outage without blind migration, synchronous important-record anchoring, 50-record/one-second cadence, 5-second degradation → 30-second 503 → recovery, bounded listing, HTTP health/verification fields, root retention enforcement, expired probe cleanup, real-process SIGTERM and SIGINT flush, all segment batches drained, and segment flush attempted even if anchoring fails.
- Retention integration starts a separate MinIO container with random root credentials and a separate Docker named volume. For real segment and anchor objects, HEAD/GetObjectRetention report COMPLIANCE and a configured 7-day retain-until; root deletion of the exact version, even with governance bypass, fails with MinIO `InvalidRequest` / HTTP 400 / WORM-protected. Conditional replacement returns 412. Both signal tests persist head 7 and segment 1–7 before exit and restart cleanly.
- The isolated MinIO container and volume were removed successfully while they contained retained objects, and volume absence was checked. Existing `dev-down.mjs` preserves named volumes (it invokes compose down without --volumes); explicit development volume removal remains possible. No shared service shutdown or shared audit retention probe was performed by F3-B.
- Read-only deployed verification at 2026-09-13T13:50:55.648Z: health ok, anchorSeq=anchoredThrough=2201, latest object COMPLIANCE until 2026-09-14T13:49:46.555Z; [F3B-deployed-anchor.json](F3B-deployed-anchor.json).
- `node --check scripts/storage.mjs` and `git diff --check`: passed; scan of 40 owned source/test/bench/doc files against configured nontrivial secret values: zero matches. All disposable test MinIO containers and named volumes are absent.
- Combined F3-A/F3-B E2E three-repeat: **117 passed (39 scenarios × 3), zero failures, skipped or flaky**, 484766 ms (8.1 minutes), started 2026-09-13T13:41:44.153Z. F3-A ran the full suite after loading final source; all download/audit cases and AC–AH broker cases passed three times. Evidence: [F3B-e2e-summary.json](F3B-e2e-summary.json), repository paths `e2e/artifacts/f3a-repeat.log` and `e2e/artifacts/results.json`. Earlier integration attempts exposed AD/AF test expectation/timing issues fixed by F3-A; the final complete run above is clean. No implementation or requested verification remains.

## R3 scripts rerun without editing review artifacts

Runner: `npm --prefix services/policy-proxy exec -- tsx services/policy-proxy/bench/f3b-repro.mts`. It copies the original scripts byte-for-byte into a temporary mirror, links current service source for imports, runs against a disposable MinIO with isolated permission scopes, copies output into this bench directory, then removes its server, volume and mirror. Original scripts and their `docs/review` outputs are unchanged.

- [F3B-p03-audit.out](F3B-p03-audit.out): canonicalization and concurrency pass; byte tamper → `brokenAt=3`; malformed tail → `brokenAt=1`; append after damage fails closed. **The unchanged historical no-object-store test still reports its clean 5→3 truncation as UNDETECTED.** It constructs `new AuditChain(dir)` with no external store and closes before the timer; it cannot exercise an external-anchor fix. The production main requires object storage, and this output is not presented as a fixed no-storage guarantee.
- [F3B-p03-audit-minio.out](F3B-p03-audit-minio.out): replicated-boundary truncation is detected at 5; isolated policy user gets AccessDenied for audit deletion and succeeds for download cleanup. Its direct SDK PUT deliberately omits retention and its simple DELETE still succeeds. Its static text claiming S3Objects lacks retention is historical script text, not an observation about the changed S3Objects implementation; the dedicated retention tests above verify the actual implementation and exact version deletion.
- [F3B-anchored-tail.json](F3B-anchored-tail.json): supplemental real-MinIO regression writes 5 records, explicitly commits head 5 without any segment replication, truncates to 3 complete lines, and restarts: **`ok=false`, `brokenAt=4`, `anchorSeq=5`, `remoteSegments=0`**. This isolates and proves the new external-anchor protection.

## Remaining operational risks

Independent WORM administration, restricted storage/host privileges and an operational retention policy are required. Use an explicit production retention value such as 365 days only when it matches the organization's actual policy; the 1-day development default is not a production retention decision. Existing objects created before this change do not gain retention retroactively. No automatic anchor deletion is implemented; cleanup must respect retention and preserve trusted latest checkpoints.

Object Lock preserves **versions**, and a root-level delete marker can hide the current version without deleting protected bytes ([AWS Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)); policy-scoped credentials lack audit deletion rights, but the full object-store administrator remains outside the single-application threat boundary. Audit chain memory and full segment verification still grow with record count. One process must own each audit directory. The existing envelope-encryption KEK is still environment-backed; production KMS versioned unwrap/rewrap, durable backups and independently managed retention remain deployment work.
