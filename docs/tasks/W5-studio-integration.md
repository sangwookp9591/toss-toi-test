# W5: 스튜디오 통합 + 전체 E2E + Sandpack 대비 벤치 (apps/studio, e2e, bench)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 만들 곳: `apps/studio/`, `e2e/`, `bench/`, 루트 `README.md`의 "TOI-lite 실행" 절, 루트 `scripts/dev-up.mjs`
- 반드시 읽을 것: `docs/ARCHITECTURE.md`, `contracts/src/*`, 그리고 W1~W4 산출물의 README(`packages/preview-runtime`, `services/deps-builder`, `services/policy-proxy`, `services/mock-backend`, `services/agent-server`)

## Change
1. **apps/studio (5173 + 프리뷰 origin 5174)**: React 앱.
   - 좌: 채팅(`POST /generations` → SSE 구독, text 스트리밍 표시, question에 답변 UI, cancel 버튼, 재연결 시 Last-Event-ID).
   - 중: 파일 트리 + 코드 보기(편집 시 `PUT /projects/:id/source` CAS, 409면 최신 revision 불러오기 안내).
   - 우: `packages/preview-runtime` 프리뷰. `revision_ready` → packageSet을 deps-builder에 요청(ready까지 대기, building이면 상태 표시) → `setDesiredRevision` → `build`. 이벤트(build_failed, runtime_failed, stale_discarded, committed + timings)를 상태 바에 표시.
   - capability: 프리뷰 시작 시 policy-proxy에서 read capability 발급 → `ParentToFrame.capabilityToken`으로 전달. "쓰기 테스트 허용" 토글을 켰을 때만 write capability 발급.
   - 사용자 문구는 사용자 관점으로(예: "화면을 만들고 있어요", "이전 화면을 유지했어요: 문법 오류 3건").
2. **scripts/dev-up.mjs**: infra(docker compose) → 레지스트리 준비 → 서비스 4개 → 스튜디오를 순서대로 띄우고 healthz 대기. `scripts/dev-down.mjs`.
3. **E2E (Playwright, 시스템 Chrome)** — `e2e/`
   - 시나리오 A(mock 에이전트): 프로젝트 생성 → "고객 목록 화면 만들어줘" → 역질문 답변 → revision_ready → 조합 빌드(@toi/tds 사내 패키지 포함) → 프리뷰 커밋 → 목록에 **마스킹된** 휴대폰 표시 → 조회 사유 없이 호출 시 사유 입력 요구 → 감사 로그에 기록.
   - 시나리오 B: 코드에 문법 오류 저장 → 이전 화면 유지 표시.
   - 시나리오 C: 빠르게 두 번 수정(r_n, r_n+1)하고 r_n 빌드를 인위적으로 지연 → r_n+1만 커밋.
   - 시나리오 D: 프리뷰(read capability)에서 상태 변경 버튼 → 403 안내, 토글 켜고 write capability → 성공 + 감사 기록.
   - 시나리오 E: 두 탭에서 같은 baseRevision 저장 → 한쪽 409 안내.
   - 시나리오 F: @toi/tds useToast가 앱과 같은 React 인스턴스로 동작(에러 0).
4. **bench/** — 토스의 47초 → 1.3초 비교를 이 환경에서 재현
   - (a) Sandpack(`@codesandbox/sandpack-react` 최신) 같은 앱을 공개 패키지만으로(사내 @toi/tds 제외 버전) cold 첫 화면까지.
   - (b) TOI-lite cold: 새 조합(deps-builder miss) 포함 첫 화면.
   - (c) TOI-lite warm: 조합 적중 + 브라우저 캐시 비움 첫 화면.
   - (d) TOI-lite 수정 → 커밋.
   - 각 3회 중앙값, 측정 종점(DOM에 특정 텍스트 표시 + 2 rAF), 네트워크 조건, 캐시 조건을 표로. Sandpack이 사내 패키지를 못 쓰는 조건 차이를 명시하고 과장 금지. `bench/results.json` + `bench/README.md`.
5. **루트 README "TOI-lite 실행" 절**: 요구사항(Docker, Node 22, Chrome), `node scripts/dev-up.mjs`, 스튜디오 사용법, Claude 모드 켜는 법, E2E·벤치 실행.

## Constraints
- 편집 범위 밖(W1~W4 폴더, `contracts/`, `infra/`)은 수정 금지. 버그를 발견하면 재현 절차와 함께 ask로 보고하고, 코디네이터 판단을 기다린다(우회 패치 금지).
- 전역 설치 금지, git commit 금지.

## Ownership
- 편집 가능: `apps/studio/**`, `e2e/**`, `bench/**`, `scripts/**`, 루트 `README.md`의 새 절

## Observable acceptance
- `node scripts/dev-up.mjs` 후 E2E A~F 전부 통과(3회 연속 실행 중 3회 통과), 결과 요약을 `e2e/README.md`.
- `bench/results.json` 원시 3회 + 중앙값, `bench/README.md` 조건표.
- 스크린샷: 시나리오 A 커밋 직후 스튜디오 화면 1장 `e2e/artifacts/studio.png`.
