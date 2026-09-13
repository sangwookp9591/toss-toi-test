# F3-B: 감사 체인 외부 앵커와 object lock retention (R3-M1, R3-L1)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`. 서비스는 떠 있다.
- 반드시 읽을 것:
  - `docs/review/REVIEW-R3.md`의 R3-M1·R3-L1
  - `docs/review/repro/r3/p03-audit.mts`, `p03-audit-minio.mts`와 출력
  - `contracts/src/policy.ts`: P0-3 감사, R3-M1 외부 앵커, R3-L1, R3-M2 이후 CORS
  - `services/policy-proxy/src/{audit,objects,main,server,downloads}.ts`, `scripts/storage.mjs`, `services/policy-proxy/bench/P0B-REPORT.md`
- 병렬 워커 F3-A(프리뷰 브로커, `docs/tasks/F3A-preview-broker.md`)가 스튜디오·preview-runtime·@toi/fetch·e2e를 동시에 수정한다.

## Change
1. **외부 앵커**(R3-M1)
   - 계약대로 체인 head를 `audit/anchors/<seq 20자리>-<hash>`에 덮어쓰기 금지로 기록한다. 주기는 1초 또는 50건, 종료 시그널(SIGTERM·SIGINT) 때 즉시 flush한다. 종료 시 미복제 세그먼트도 flush한다.
   - `download-create`·`download-fetch`·`approval` 레코드는 앵커 기록 완료 후 응답한다.
   - 시작 시 가장 큰 앵커 seq보다 로컬 체인이 짧거나 hash가 다르면 `brokenAt`으로 fail-closed한다. `/audit/verify`에 `anchorSeq`와 `anchoredThrough`를 보고한다.
   - 앵커 기록 실패: 5초 초과 `/healthz` degraded, 30초 초과 새 요청 503 `AUDIT_ANCHOR_UNAVAILABLE`. 복구되면 자동으로 해제한다.
   - 앵커 목록 조회가 커지지 않게 한다. 예: 최근 앵커 포인터 + 역순 조회, 또는 오래된 앵커 정리는 retention 이후에만.
   - 기존 체인 데이터(앵커 없음)에서의 이전 경로를 둔다. 첫 시작 때 현재 head를 앵커로 기록한다.
2. **retention**(R3-L1)
   - 세그먼트·앵커 PUT에 `ObjectLockMode: COMPLIANCE`와 `RetainUntilDate`를 설정한다(env `TOI_AUDIT_RETENTION_DAYS`, 개발 기본 1).
   - `scripts/storage.mjs`는 버킷 lock 확인에 더해 테스트 객체의 retention 적용을 검증한다.
   - dev-down의 볼륨 삭제가 여전히 동작하는지 확인하고, 운영 권장 값을 README에 적는다.
   - env 추가가 필요하면 `scripts/service-env.mjs` allowlist 변경을 F3-A에 요청한다(scripts 소유는 F3-A).
3. **R3-M2 서버 측**: 프리뷰 origin 요청은 경로와 무관하게 403 `PREVIEW_DIRECT_FORBIDDEN`이고 CORS 헤더를 내지 않는다. F3-A 브로커 전환과 시점을 맞춘다. `PREVIEW_ORIGIN_MISMATCH` 테스트는 새 규칙으로 바꾼다.
4. **테스트**(`services/policy-proxy/test/**`)
   - R3 재현을 회귀 테스트로 넣는다: 미복제 tail을 라인 경계로 잘라낸 뒤 재시작하면 brokenAt.
   - 앵커 hash 불일치, 앵커 기록 실패 degraded→503→복구
   - retention 설정 확인(root로 삭제 시도 실패, 격리 버킷)
   - SIGTERM flush
   - 프리뷰 origin 직접 요청 403
   - R3 재현 스크립트 `docs/review/repro/r3/p03-audit.mts`·`p03-audit-minio.mts`를 다시 실행해 결과를 보고서에 적는다(스크립트는 수정하지 않는다).

## Constraints
- 수정 금지: `contracts/`, `packages/`, `apps/`, `services/policy-proxy/client/**`, `services/policy-proxy/scripts/publish-client.mjs`, `services/agent-server/**`, `services/deps-builder/**`, `e2e/**`(단 `downloads.spec.ts`는 편집 가능), `scripts/**`(단 `storage.mjs`는 편집 가능), `docs/review/**`, `evals/**`.
- 변조 실험은 격리 인스턴스·임시 버킷으로만 한다. 공유 감사 버킷에 retention 시험 객체를 남기지 않는다(COMPLIANCE는 지울 수 없으므로 반드시 임시 버킷).
- 서비스 재기동은 F3-A가 소유한다. 필요하면 F3-A에 요청한다.
- git commit 금지. 비밀값 기록 금지.

## Ownership
- 편집 가능: `services/policy-proxy/src/**`, `services/policy-proxy/test/**`, `services/policy-proxy/README.md`, `services/policy-proxy/bench/**`, `scripts/storage.mjs`, `e2e/tests/downloads.spec.ts`

## Observable acceptance
- policy-proxy typecheck·test 통과(위 회귀 테스트 포함).
- F3-A와 합친 뒤 E2E 3회 반복 전부 통과.
- `services/policy-proxy/bench/F3B-REPORT.md`:
  - R3 재현 재실행 결과(tail 잘라내기 탐지)
  - 앵커 창 크기·실패 동작 표
  - retention 검증
  - 남은 위험: 앵커 주기 안의 최근 기록, 운영 WORM·KMS
