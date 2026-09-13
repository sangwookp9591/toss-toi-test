# QA2: 새 클론 재검증 — QA1 발견 8건 재현 여부와 회귀 (mock 에이전트)

## Target
- 작업 위치: **새 클론** `/Users/psw/Projects/toi-lite-qa2` (GitHub `main`, 커밋 `9fb2cae`). 원본 `/Users/psw/Projects/toss-toi-test`와 이전 QA 클론 `/Users/psw/Projects/toi-lite-qa`는 건드리지 않는다.
- 기존 서비스·Docker 스택은 코디네이터가 모두 내렸다. 포트 8개(4873·9000·5173·5174·7100·7200·7300·7400)는 비어 있다.
- **모든 docker compose·dev-up·dev-down 실행에 `COMPOSE_PROJECT_NAME=toi-qa2`** 를 지정한다. 기존 `toi-lite_*`, `toi-qa_*` 볼륨은 조작하지 않는다.
- mock 에이전트(Claude API 키 없음).
- 기준 문서: 클론의 `docs/qa/qa1/QA-REPORT.md`(QA1 발견 사항과 재현 절차), `docs/qa/fx/FX-B-REPORT.md`, `e2e/artifacts/fx-a-report.md`, `README.md`「TOI-lite 실행」, `apps/studio/README.md`

## Change
`docs/qa/qa2/QA2-REPORT.md`(클론 안)를 작성한다. **소스는 수정하지 않는다.**

1. **QA-01 재검증 (가장 먼저)**: 아무 준비 없이 README의 `COMPOSE_PROJECT_NAME=toi-qa2 node scripts/dev-up.mjs` 한 줄만 실행한다. 추가 조치 없이 스튜디오 준비 완료까지 가는지, 전체 시간과 단계별 시간을 기록한다. 추가 조치가 하나라도 필요했으면 **실패**로 판정한다.
2. **QA-02~08 재검증**: QA1 보고서의 각 재현 절차를 **실제 Chrome에서 사람처럼** 그대로 다시 수행하고, 항목마다 `해결됨 / 부분 해결 / 미해결`로 판정한다. 근거로 스크린샷을 `docs/qa/qa2/shots/`에 남긴다.
   - QA-02: 역질문 대기 중 새로고침 → 질문·대화 복원 → 답변 → revision_ready. 새로고침을 두 번 연속 했을 때, 다른 탭에서 같은 프로젝트를 열었을 때도 확인한다.
   - QA-03: 쓰기 허용 → 남은 시간 표시 → **실제 2분 대기** → 토글 자동 off와 안내 → 다시 켜기로 복구.
   - QA-04: 문법 오류, runtime throw, `import axios` → 파일·행과 패키지 이름 표시.
   - QA-05: 두 탭 CAS 충돌 → 불러오기 후 보관본에 내 편집이 있고 복사 가능.
   - QA-06: 새 조합 요청 중 deps-builder 종료 / MinIO 중지 / Verdaccio 중지 → 처음 준비 실패와 이전 화면 유지를 구분해 표시, **다시 시도** 버튼으로 새로고침 없이 복구.
   - QA-07: 조회 전 안내, 조회 중 버튼 비활성화, 결과 없음, policy-proxy 중지와 mock-backend 중지 시 서로 다른 문구.
   - QA-08: 1600px·400px에서 답변 버튼이 한 줄.
3. **회귀 확인**
   - QA1에서 통과했던 핵심 흐름을 빠르게 재확인한다: 생성, 사유, 마스킹, 상세, 쓰기 토글, 편집 rollback, 취소.
   - 보안 스팟 체크: 프리뷰 콘솔에서 7200 `/dev/session`·`/capabilities`, 7400 `/generations` 차단. `__TOI_FETCH_CONFIG__`는 viewer 전용.
   - 새로 생긴 UI(보관본, 진단 목록, 재시도, 남은 시간)가 비밀값이나 내부 주소를 노출하지 않는지.
   - 스크립트: `npm --prefix e2e ci && npm --prefix e2e run test:repeat`를 1회 실행해 결과를 기록한다.
4. **새 문제**가 있으면 QA1과 같은 형식(심각도·재현 절차·기대·실제·증거·추정 원인)으로 기록한다.
5. **종료**: `COMPOSE_PROJECT_NAME=toi-qa2 node scripts/dev-down.mjs` 후 포트 8개, 프로세스, 컨테이너가 남지 않았는지 확인한다.

## 판정 요약 형식
마지막에 표를 둔다: `ID | QA1 심각도 | QA2 판정 | 근거(스크린샷/로그)`. 그 아래에 신규 발견 목록과 **"QA1 발견 사항 전부 해결" 여부**를 한 줄로 쓴다.

## Constraints
- 소스·설정·계약 수정 금지. 작성 가능: 클론의 `docs/qa/qa2/**`. git commit·push 금지.
- 모든 compose 실행에 `COMPOSE_PROJECT_NAME=toi-qa2`. 원본 저장소와 다른 볼륨 조작 금지.
- 비밀값 원문을 문서·스크린샷에 남기지 않는다.
- 추적 파일(`e2e/artifacts/*` 등)이 테스트로 바뀌면 결과를 `docs/qa/qa2/`로 복사한 뒤 원래 내용으로 복원한다(최종 `git status`는 `docs/qa/qa2/`만).

## Ownership
- 편집 가능: `/Users/psw/Projects/toi-lite-qa2/docs/qa/qa2/**`

## Observable acceptance
- `docs/qa/qa2/QA2-REPORT.md`에 1~5절, 판정 요약 표, 신규 발견, 전부 해결 여부.
- `docs/qa/qa2/shots/`에 항목별 근거 캡처.
- 종료 후 포트 8개가 비어 있음.
