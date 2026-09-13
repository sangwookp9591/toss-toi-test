# P0A2: 스튜디오 OIDC·멤버·승인 UI와 인증 E2E (P0-1 분할)

P0A(`docs/tasks/P0A-identity.md`)의 5번(studio)과 7번(E2E)을 떼어 병렬로 맡는다. 서버·Keycloak·dev-up은 P0A 워커가 같은 체크아웃에서 동시에 구현한다.

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test` (P0A와 같은 작업 트리. 남의 소유 파일은 읽기만)
- 반드시 읽을 것: `docs/tasks/P0A-identity.md` 전체, `docs/P0-DESIGN.md`, `contracts/src/auth.ts`, `contracts/src/policy.ts`, `contracts/src/generation.ts`, `apps/studio/README.md`, `e2e/` 기존 A~M

## Change
1. **studio** (`apps/studio/**`)
   - OIDC Authorization Code + PKCE 로그인·로그아웃·토큰 갱신(`oidc-client-ts`, 버전 고정). issuer `http://localhost:8080/realms/toi`, client `toi-studio`. 설정은 Vite env로 받는다.
   - 토큰은 메모리 보관을 우선한다. 새로고침 복구에 필요한 저장 방식과 근거를 README에 적는다.
   - 모든 agent-server·policy-proxy 호출에 Bearer를 붙이고, 401이면 한 번 갱신 후 재시도, 실패하면 로그인 안내.
   - 프로젝트 멤버 관리 UI(owner: 추가·역할 변경·제거, 마지막 owner 보호 오류 표시)와 승인 요청·상태 표시(`GET /approvals?projectId=`), api-owner용 승인·거절 화면.
   - 프리뷰에는 `POST /preview-sessions` 결과(sessionToken·capability)만 전달한다. Keycloak 토큰을 iframe·postMessage·URL로 넘기지 않는다. 기존 dev session 경로를 제거한다.
   - 로그인 전·비멤버(404)·권한 부족(403) 안내 문구.
2. **E2E** (`e2e/**`)
   - Keycloak 실제 로그인 헬퍼(UI 로그인 1회 + 사용자별 storageState 재사용). 비밀번호는 `.env`에서 읽고 로그·리포트에 남기지 않는다.
   - 기존 A~M을 인증 흐름으로 이전하고 N~S를 추가한다(시나리오 정의는 P0A 문서 7번).
   - R(계정 비활성화)은 Keycloak admin API를 테스트 헬퍼에서 호출한다(admin 자격은 `.env`).

## 조율
- 서버 API가 아직 없으면 계약(`contracts/src/auth.ts` HTTP 규칙)대로 먼저 구현하고, 실제 서버가 준비되면 맞춘다.
- API 모양·env 이름·dev-up 기동 방식은 P0A 워커와 `orca orchestration send`로 직접 맞춘다. 계약 변경이 필요하면 코디네이터에게 ask.
- 서비스 재기동은 P0A 워커가 소유한다. E2E 실행 전에 P0A에 기동 상태를 확인한다.

## Constraints
- 수정 금지: `contracts/`, `packages/`, `services/**`, `infra/**`, `scripts/**`, `evals/**`.
- 전역 설치 금지, git commit 금지, 비밀값을 로그·문서·스크린샷에 남기지 않는다.
- 기존 보안 강화(Origin, revision guard, CAS 백업, capability 카운트다운)를 약화시키지 않는다.

## Ownership
- 편집 가능: `apps/studio/**`, `e2e/**`

## Observable acceptance
- studio typecheck·test·build 통과(인증 상태·Bearer 주입·401 갱신·프리뷰에 Keycloak 토큰 미전달 단위 테스트 포함).
- P0A 서버와 합친 뒤 `npm --prefix e2e run test:repeat`에서 A~M + N~S 전부 3회 통과.
- `apps/studio/README.md`: 로그인 방법, 토큰 보관 방식과 근거, 멤버·승인 화면.
