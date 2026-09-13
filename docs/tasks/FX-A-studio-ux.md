# FX-A: QA1 스튜디오 수정 — QA-02·03·04·05·06·08 (apps/studio, e2e)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 수정할 곳: `apps/studio/`, `e2e/tests/`
- 반드시 읽을 것: `docs/qa/qa1/QA-REPORT.md`(발견 사항 QA-02~06, QA-08과 스크린샷), `contracts/src/generation.ts`(SSE `Last-Event-ID` replay), `contracts/src/runtime.ts`(`PreviewEvent`의 `diagnostics`, `runtime_failed.error`), `apps/studio/README.md`

## Change
각 항목의 수용 조건은 **QA 보고서의 재현 절차가 더 이상 재현되지 않는 것**이다.

1. **QA-02 (major) 생성 중 새로고침 복구**
   - 진행 중인 `generationId`와 마지막으로 처리한 `seq`를 `sessionStorage`(프로젝트 id별 키)에 저장한다. 종결 이벤트(done/failed/canceled)를 받으면 지운다.
   - 프로젝트를 열 때 저장된 generation이 있으면 `GET /generations/:id/events`를 `Last-Event-ID`와 함께 다시 구독한다.
     - 대화(text), 역질문(question, 아직 답하지 않은 것), 진행 상태를 복원하고 답변·취소 버튼이 다시 동작해야 한다.
     - 서버가 404를 주거나 이미 종결된 경우에는 "진행 중이던 생성이 끝났어요: <결과>"를 보여 주고 저장값을 지운다.
   - EventSource는 `Last-Event-ID` 헤더를 직접 지정할 수 없다. 서버 계약상 지원되는 방식(헤더)으로 받으려면 `fetch` 스트리밍으로 SSE를 읽는 방법을 쓴다. 선택한 방식과 근거를 README에 적는다. agent-server 코드는 수정하지 않는다(필요하면 ask).
2. **QA-03 쓰기 권한 만료 표시**
   - write capability를 발급할 때 만료 시각을 저장하고 남은 시간을 표시한다(예: "쓰기 허용 1:42 남음").
   - 만료되면 토글을 자동으로 끄고 "쓰기 허용 시간이 끝났어요. 다시 켜면 2분 동안 허용돼요."를 보여 준다.
   - 만료 시 프리뷰의 capability를 read로 되돌리는 재빌드 흐름은 기존과 같게 한다.
3. **QA-04 편집 실패 원인 표시**
   - `build_failed`는 diagnostics를 파일·행·열·메시지 목록으로 보여 준다(최대 5개 + "외 N건").
   - 허용되지 않은 패키지 진단(`package not in package set: <name>`)은 "‘<name>’ 패키지는 이 프로젝트에서 쓸 수 없어요"로 바꿔 보여 준다.
   - `runtime_failed`는 에러 메시지와 가능하면 위치를 보여 준다.
   - 상태 바 요약은 "문법 오류"와 "허용되지 않은 패키지"를 구분한다. 기존 E2E가 단언하는 `이전 화면을 유지했어요: 문법 오류` 접두 문구는 유지한다.
4. **QA-05 CAS 충돌 시 로컬 편집 보존**
   - "최신 내용 불러오기" 전에 현재 미저장 편집을 `내 편집 보관본`으로 보존한다(파일별 보기 + 복사 버튼, 세션 동안 유지).
   - 불러오기 버튼 옆에 "내 편집은 보관본으로 남겨요"를 표시한다.
   - `최신 내용 불러오기` 버튼 문구는 유지한다(E2E E).
5. **QA-06 의존성 장애 메시지와 재시도**
   - 이전에 정상 화면이 한 번도 없었으면 "화면을 처음 준비하지 못했어요: 구성 요소 준비 실패"로, 있었으면 기존처럼 "이전 화면을 유지했어요: …"로 구분한다.
   - 프리뷰 영역과 상태 바에 **다시 시도** 버튼을 둔다. 같은 revision으로 조합 요청과 빌드를 다시 수행하며, 새로고침이 필요 없어야 한다.
   - deps-builder 응답(`failed` + error, 연결 실패, 대기 시간 초과)을 구분해 짧은 원인을 표시한다(비밀·내부 주소는 노출 금지).
6. **QA-08 역질문 답변 버튼 줄바꿈**
   - 1600px과 400px 폭에서 "답변" 버튼이 한 줄로 보이도록 레이아웃을 수정한다(`white-space: nowrap`, 최소 너비, 입력칸 flex).
7. **E2E 추가** (`e2e/tests/studio.spec.ts`, 기존 A~F 유지)
   - G: 역질문 대기 중 새로고침 → 질문 복원 → 답변 → revision_ready.
   - H: 쓰기 허용 후 만료(테스트에서는 TTL을 짧게 주입할 수 있게 스튜디오에 테스트용 설정을 두되, 기본값은 120초 유지) → 토글 자동 off와 안내.
   - I: 문법 오류 → 파일·행 표시, axios import → 패키지 이름 표시.
   - J: CAS 충돌 → 불러오기 후 보관본에 내 편집 존재.
   - K: 새 조합 요청 중 deps-builder가 실패하도록 만든 상태(존재하지 않는 패키지 버전 등 비파괴적인 방법) → 처음 준비 실패 문구와 다시 시도 버튼 동작.
   - 레이아웃: 1600px·400px에서 답변 버튼 높이가 한 줄 높이인지 단언.

## Constraints
- 편집 범위 밖(`contracts/`, `packages/`, `services/`, `scripts/`) 수정 금지. 서비스 동작 변경이 필요하면 ask.
- FX-B가 병렬로 mock 템플릿 문구와 dev-up을 고친다. E2E가 템플릿 문구에 의존하게 되면 FX-B 완료 후 코디네이터가 알려 준다. 그 전에는 템플릿 문구(`쓰기 권한`, `상태를 정지로 바꿨어요`, `고객 상태를 정지로 변경`)만 단언에 쓴다.
- 전역 설치 금지, git commit 금지. 서비스는 이미 떠 있지 않을 수 있다. 필요하면 `node scripts/dev-up.mjs`로 기동한다(FX-B의 dev-up 수정 전이라도 이 개발 폴더에는 의존성이 설치돼 있다).

## Ownership
- 편집 가능: `apps/studio/**`, `e2e/tests/**`, `e2e/artifacts/**`

## Observable acceptance
- `npm --prefix apps/studio run typecheck` 통과.
- `npm --prefix e2e run test:repeat`에서 A~F + 새 시나리오 전부 3회 통과.
- README에 새 동작(복구·만료·진단·보관본·재시도)과 E2E 요약.
