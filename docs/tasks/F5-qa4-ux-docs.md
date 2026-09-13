# F5: QA4 잔여 발견 수정 — 제거된 멤버 안내, viewer 다운로드 설명, 문서 불일치

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`. 원본 개발 환경은 내려가 있다. 기동할 때는 `COMPOSE_PROJECT_NAME=toi-f5`를 쓰고, 끝나면 `COMPOSE_PROJECT_NAME=toi-f5 node scripts/dev-down.mjs --volumes`로 정리한다. 다른 compose 프로젝트 자원은 건드리지 않는다.
- 기준: `docs/qa/qa4/QA4-REPORT.md`의 Q4-N02·Q4-N03·Q4-D02·Q4-D03·Q4-D04와 캡처 `docs/qa/qa4/shots/13-bob-removed-observed.png`·`11-viewer-download.png`
- 읽을 것:
  - `apps/studio/src/{controller,access-panel,download-panel}.tsx`
  - `packages/preview-runtime/src/index.ts`(브로커)
  - `services/policy-proxy/client/toi-fetch.ts`
  - `services/policy-proxy/src/access.ts`(비멤버 404 `PROJECT_NOT_FOUND`)
  - `services/agent-server/src/{templates,system-prompt}.ts`, 루트 `README.md`, `apps/studio/README.md`

## Change
1. **Q4-N02(medium)**: 제거된 멤버가 "조건에 맞는 고객이 없어요"를 본다.
   - 브로커가 policy-proxy의 `PROJECT_NOT_FOUND`(멤버십 거부)를 upstream 리소스 404와 구분한다. 오류 body의 code를 기준으로 판단한다.
   - 멤버십 거부를 받으면 스튜디오가 다음을 한다.
     - 프리뷰를 내리고 "이 프로젝트에 접근할 수 없어요. 멤버에서 제거되었거나 권한이 바뀌었을 수 있어요" 안내를 보인다. 프로젝트 존재 여부는 추가로 드러내지 않는다.
     - 편집·생성·저장 UI를 잠근다.
     - 프로젝트 목록으로 돌아가는 버튼을 준다.
   - agent-server 사용자 API에서 404가 오는 경우(생성·저장·멤버십 조회)도 같은 안내로 통일한다.
   - 스튜디오가 프로젝트를 열어 둔 동안 멤버십을 주기적으로(예: 30초, 창이 포커스를 얻을 때) 확인해, 프리뷰 요청이 없어도 제거를 알아차린다.
   - `@toi/fetch`에서 멤버십 거부는 `ToiAccessRevokedError`(status 404, code `PROJECT_NOT_FOUND`)로 던진다. 생성 템플릿·mock 코드·system prompt는 이 오류를 "결과 없음"으로 표시하지 않고 오류로 표시하게 바꾼다. `@toi/fetch` 버전을 올려야 하면 1.1.1로 게시하고 packageSet·fixture를 맞춘다.
2. **Q4-N03(low)**: viewer 다운로드 버튼이 비활성인데 이유가 없다.
   - 다운로드 패널에 역할별 안내를 보인다. 예: "암호화 다운로드는 editor 이상만 할 수 있어요. 프로젝트 owner에게 권한을 요청하세요."
   - 비활성 버튼에는 `aria-describedby`로 이유를 연결한다.
   - 상단 viewer 문구에도 다운로드 제한을 넣는다.
3. **Q4-D04**
   - 비밀번호 표시 패널과 `services/policy-proxy/README.md`에 AES-256 ZIP을 여는 방법을 적는다.
     - macOS 기본 압축 해제 도구로는 열리지 않는다.
     - 지원 도구 예: 7-Zip, Keka, `7z x`.
   - 안내 문구는 짧게 쓰고, 외부 링크는 넣지 않는다.
4. **문서 불일치(Q4-D02·Q4-D03)**
   - 루트 README 실행·보안 설명과 CSP 표를 현재 동작에 맞게 고친다: 토큰 없는 브로커, `connect-src 'none'`, script `data:` 없음, 프로젝트별 origin.
   - `apps/studio/README.md` 첫 문단의 공유 5174 설명을 프로젝트별 origin으로 고친다.
   - 다른 README·보고서에서 frame이 토큰을 가진다고 설명하는 곳을 찾아 고친다. 과거 보고서(`docs/qa/**`, `docs/review/**`, `*-REPORT.md`)는 당시 기록이므로 수정하지 않는다.
5. **테스트**
   - studio 단위 테스트: 멤버십 거부와 리소스 404 구분, 잠금 상태, 주기 확인, viewer 다운로드 안내.
   - `@toi/fetch` 오류 타입 테스트.
   - E2E 추가(`e2e/tests/identity.spec.ts` 또는 새 스펙):
     - AI: bob 제거 → 프리뷰 조회 시 접근 불가 안내가 보이고 "고객이 없어요"는 보이지 않음. 프리뷰 요청 없이도 주기 확인으로 안내가 뜸.
     - AJ: viewer 다운로드 패널에 권한 안내가 보이고 버튼 aria 설명이 연결됨.
   - 기존 O 시나리오가 새 안내와 충돌하지 않게 맞춘다.

## Constraints
- 보안 동작은 약화하지 않는다. 비멤버에게 존재를 드러내지 않는 404 정책, 브로커 검증, CSP, 인증 흐름을 그대로 둔다.
- 수정 금지: `contracts/`(부족하면 ask), `services/policy-proxy/src/**`(서버 코드는 바꾸지 않는다. 필요하면 ask), `docs/qa/**`, `docs/review/**`, `evals/**`.
- git commit 금지. 비밀값 출력 금지.

## Ownership
- 편집 가능:
  - `apps/studio/**`, `packages/preview-runtime/**`
  - `services/policy-proxy/client/**`, `services/policy-proxy/scripts/publish-client.mjs`, `services/policy-proxy/README.md`
  - `services/agent-server/src/{templates,system-prompt}.ts`와 관련 테스트·fixture
  - `e2e/**`, 루트 `README.md`

## Observable acceptance
- studio·preview-runtime·agent-server typecheck·test 통과.
- `COMPOSE_PROJECT_NAME=toi-f5 node scripts/dev-up.mjs --e2e` 후 `npm --prefix e2e run test:repeat`에서 기존 39개 시나리오와 AI·AJ가 3회 모두 통과한다.
- 끝나면 toi-f5 자원을 정리하고 포트 9개가 비어 있다.
- `e2e/F5-REPORT.md`: 수정 전후 캡처(제거된 멤버 안내, viewer 다운로드), 문서 변경 목록.
