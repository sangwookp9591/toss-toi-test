# W6-B0: API 등록·선택 UI 명세와 계약 (TOSS-GAP P1-3, A4/A5)

공통 제약: [`W6-common.md`](W6-common.md). 이 작업은 **설계·명세만** 한다. 서비스 코드는 수정하지 않는다.

## Target
현재 상태: API 등록은 policy-proxy 관리자 API와 seed만 있고(`services/policy-proxy/src/server.ts`, `seed.ts`), 스튜디오는 `apiIds: ['customers']`로 고정(`apps/studio/src/controller.ts:149`). INTENT 열린 질문 #5(스키마 형식·등록 경로·변경 영향 분석).

## Change
산출물 `docs/tasks/W6-B1-api-registry-impl.md`: 구현 작업자(Codex Astra)가 그대로 따라 할 수 있는 자기완결 명세. 반드시 포함:
1. 스키마 형식 결정(OpenAPI 버전 등)과 근거, 등록 권한(누가 등록·수정·승인하는지; 기존 역할 owner/editor/viewer, realm role api-owner/platform-admin과 정합).
2. 스키마 버전 모델: 등록 API의 버전 이력, 프로젝트가 고정(pin)한 버전, 새 버전이 나왔을 때 영향 분석(어떤 프로젝트가 어떤 필드를 쓰는지 판단 기준, breaking 판정 규칙).
3. 스튜디오 UX: 등록 API 목록·검색, 프로젝트 생성/편집 시 여러 API 선택, 선택한 API가 agent 컨텍스트(`list_registered_apis`/`get_api_schema`)로 전달되는 경로.
4. `contracts/` 변경안(타입 diff 수준). 이 작업자는 `contracts/` 수정을 **허용**하되 기존 필드를 깨지 않는 추가만 한다. 수정 시 모든 서비스 typecheck가 통과해야 한다.
5. 보안: 등록 시 upstream allowlist·SSRF, 마스킹 규칙과 스키마 필드 연결, 비멤버 404 유지, 감사 기록.
6. 수용 기준: 단위 테스트, 그리고 E2E 시나리오(등록 → 새 프로젝트에서 customers 외 API 선택 → mock 생성 → 프리뷰 커밋 → 마스킹 확인; 스키마 새 버전 등록 → 영향 프로젝트 표시). 두 번째 업무 API는 기존 mock-backend/eval fixture(`orders`/`refunds`/`employees`)에서 고른다.
7. 의도적 제외 목록.

## Constraints
기존 권한 경계(프록시 강제, 프리뷰 토큰 없음, 4-eyes)를 약화시키지 않는다. 명세는 한국어, 표와 짧은 문단.

## Ownership
`docs/tasks/W6-B1-api-registry-impl.md`, `contracts/src/**`(추가만).

## Observable acceptance
- 명세 파일 존재, 위 1~7 절 포함.
- contracts를 바꿨다면 `npm --prefix contracts run typecheck`와 policy-proxy·agent-server·studio typecheck 통과.
