# FX2-A: QA2 잔여 — N01(다른 탭 진행 중 생성), N02(레지스트리 장애 오분류) (agent-server, deps-builder, studio)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 수정할 곳: `services/agent-server/`, `services/deps-builder/src/`, `apps/studio/`, `e2e/tests/`
- 반드시 읽을 것: `docs/qa/qa2/QA2-REPORT.md` §2 QA-02·QA-06, §4 QA2-N01·N02, 계약 커밋 `4030814`(`contracts/src/generation.ts`의 `GET /projects/:projectId/generations/active`, `ActiveGeneration` / `contracts/src/package-set.ts`의 `PackageSetFailureCode`, 400·503 규칙)

## Change
1. **N01 (major) 다른 탭에서 진행 중 생성 발견**
   - agent-server: `GET /projects/:projectId/generations/active` 구현. 종결되지 않은 최신 generation이 있으면 `{ generationId, state, lastSeq }`, 없으면 404. F3b의 Origin 판정(스튜디오·서버 간만 허용)을 그대로 적용한다. 테스트를 추가하되 기존 87개는 유지한다.
   - studio `open()`: sessionStorage 기록이 없거나 서버 활성 generation과 다르면 이 엔드포인트로 조회한다. 있으면 `Last-Event-ID` 없이 처음부터 replay 구독해 대화·질문·진행 상태를 복원한다.
   - 두 탭이 같은 generation을 보고 있을 때 한쪽에서 답변하면 다른 쪽 질문이 answered로 바뀌어야 한다(이벤트 기반). 한쪽에서 취소하면 다른 쪽에 종결이 표시돼야 한다.
   - 다른 탭에서 진행 중인 생성이 있는 동안 새 생성 보내기를 막고 "다른 창에서 진행 중인 요청이 있어요"를 표시한다(서버가 동시 생성을 허용하더라도 UX 일관성).
2. **N02 (minor) 레지스트리 장애를 입력 오류로 안내**
   - deps-builder `installer.ts`: Yarn 설치 실패를 원인별로 분류한다. 연결 거부·타임아웃·DNS·HTTP 5xx·레지스트리 health 실패는 `registry_unavailable`. 버전이 존재하지 않음·패키지 없음(레지스트리가 정상 응답한 404)은 `input`. 분류가 애매하면 레지스트리 health(`GET <registry>/-/ping`)를 확인해 판정한다.
   - MinIO 오류는 `storage_unavailable`, 나머지는 `internal`.
   - HTTP 응답은 계약대로: `input`은 400, 외부 장애는 503. `failed` 상태에도 `code`를 기록한다. 레지스트리가 복구되면 재요청 시 재빌드되어야 한다(실패 캐시 금지).
   - 기존 테스트 12개를 유지하고, 레지스트리 중지 상태를 흉내 낸 분류 테스트(연결 거부 서버, 404 응답 서버)를 추가한다.
   - studio: `code` 기준으로 안내를 바꾼다. `registry_unavailable` → "패키지 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요." / `storage_unavailable` → "구성 요소 저장소에 연결하지 못했어요…" / `input` → 기존 "패키지 또는 버전 확인 필요". `code`가 없는 구버전 응답은 기존 동작.
3. **QA-04 표시 보완 (studio 쪽만)**: `runtime_failed.error`에 `file`/`line`/`column`이 있으면 build 진단과 같은 형식으로 위치를 표시한다(런타임 위치 계산 자체는 FX2-B 담당).
4. **E2E**: 기존 45(15×3) 유지. 새 시나리오를 추가한다.
   - L: 탭 A에서 역질문 대기 → 새 탭 B에서 같은 프로젝트 열기 → B에 질문 복원 → B에서 답변 → A에서도 answered 반영.
   - M: deps-builder에 레지스트리 장애를 재현(테스트 전용 설정으로 존재하지 않는 레지스트리 주소를 쓰는 조합이나 네트워크 차단 등 비파괴적 방법) → "패키지 저장소에 연결하지 못했어요" → 복구 후 다시 시도 성공.

## Constraints
- `contracts/`, `packages/`, `services/policy-proxy`, `services/mock-backend`, `scripts/` 수정 금지(계약이 부족하면 ask).
- FX2-B가 병렬로 `packages/preview-runtime/**`를 수정한다.
- **포트 사용 순서**: FX2-B는 브라우저 테스트에 5174 등 서비스 포트가 필요 없도록 자체 테스트 서버를 쓴다. 너는 원본 서비스(`node scripts/dev-up.mjs`, 기본 compose 프로젝트)를 기동해 E2E를 돌려도 된다. FX2-B 완료 전이면 preview-runtime 변경이 반쯤 반영된 상태일 수 있으니, 최종 E2E는 FX2-B 완료 알림 뒤 1회 더 실행한다(코디네이터가 알림).
- 전역 설치 금지, git commit 금지.

## Ownership
- 편집 가능: `services/agent-server/**`, `services/deps-builder/src/**`, `services/deps-builder/test/**`, `services/deps-builder/README.md`, `apps/studio/**`, `e2e/tests/**`, `e2e/artifacts/**`

## Observable acceptance
- agent-server·deps-builder·studio typecheck, agent-server·deps-builder 테스트 통과(추가 포함).
- `npm --prefix e2e run test:repeat`에서 기존 15 + L·M 전부 3회 통과.
- 각 README에 새 엔드포인트·실패 코드·다른 탭 동작 설명.
