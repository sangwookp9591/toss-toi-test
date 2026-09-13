# QA3: 새 클론 최종 확인 — QA2 잔여 3건과 전체 회귀 (mock 에이전트)

## Target
- 작업 위치: **새 클론** `/Users/psw/Projects/toi-lite-qa3` (GitHub `main`, 커밋 `f924d27`). 원본과 이전 QA 클론은 건드리지 않는다.
- 포트 8개(4873·9000·5173·5174·7100·7200·7300·7400)는 비어 있다. **모든 compose·dev-up·dev-down에 `COMPOSE_PROJECT_NAME=toi-qa3`**. 다른 볼륨 조작 금지.
- 기준: 클론의 `docs/qa/qa2/QA2-REPORT.md`(§2 QA-02·QA-04, §4 QA2-N01·N02 재현 절차), `e2e/artifacts/FX2-A-REPORT.md`, `packages/preview-runtime/README.md`

## Change
`docs/qa/qa3/QA3-REPORT.md`(클론 안). **소스 수정 금지.**

1. **기동**: 아무 준비 없이 `COMPOSE_PROJECT_NAME=toi-qa3 node scripts/dev-up.mjs` 한 줄. 추가 조치가 필요하면 실패로 판정한다. 시간을 기록한다.
2. **QA2-N01 / QA-02 확장**: 실제 Chrome에서 QA2 §4 절차를 그대로 수행한다.
   - A 탭 역질문 대기 → **새 탭** B에서 같은 프로젝트 URL 직접 입력 → 사용자 요청 원문·대화·질문 복원.
   - B에서 답변 → A의 질문이 answered로 바뀌고 revision_ready.
   - 다른 생성으로 A 대기 중 B에서 취소 → A에 종결 표시.
   - A 진행 중 B에서 새 요청 보내기 차단 문구.
   - 같은 탭 새로고침 2회 복원 회귀도 확인한다.
3. **QA2-N02**: Verdaccio를 실제로 중지(4873 연결 불가 확인) → 유효한 범위로 새 조합 요청 → "패키지 저장소에 연결하지 못했어요" 계열 안내(패키지·버전 확인 문구가 아님) → Verdaccio 시작·health 200 → **다시 시도**로 동일 입력 성공. 대조군으로 존재하지 않는 버전(예: `@toi/tds@9.9.9`)을 레지스트리 정상 상태에서 요청 → "패키지 또는 버전 확인 필요" 계열. MinIO 중지는 "구성 요소 저장소" 계열 안내인지 확인한다.
4. **QA-04 런타임 위치**: `throw new Error('QA runtime failure')`를 `/src/App.tsx`에, 하위 파일 오류를 만들 수 있으면 그 파일에도 넣어 저장 → 파일·행·열 표시가 실제 줄과 일치하는지. 문법 오류·axios import 표시 회귀도 확인한다.
5. **회귀 요약**: 생성·사유·마스킹·쓰기 토글 만료(짧게 확인해도 됨: 남은 시간 표시와 off 동작)·CAS 보관본·재시도·조회 상태 문구가 여전히 동작하는지 빠르게 스팟 체크. 보안 스팟: 프리뷰 콘솔에서 7200 `/dev/session`, 7400 `/generations`, **7400 `/projects/:id/generations/active`** 호출 차단.
6. **스크립트**: `npm --prefix e2e ci && npm --prefix e2e run test:repeat` 1회.
7. **종료**: `COMPOSE_PROJECT_NAME=toi-qa3 node scripts/dev-down.mjs` 후 포트·프로세스·컨테이너 잔존 0 확인.

## 판정 형식
표: `ID | QA3 판정(해결됨/부분/미해결) | 근거`. 대상은 QA-01~QA-08 전체 8건과 QA2-N01·N02. QA-01·03·05·06·07·08은 스팟 체크 결과로 판정한다. 신규 발견은 QA1 형식으로 적는다. 마지막 줄에 **"QA1·QA2 발견 사항 전부 해결: 예/아니오"**.

## Constraints
- 소스·설정·계약 수정 금지. 작성 가능: 클론의 `docs/qa/qa3/**`. git commit·push 금지.
- 비밀값 원문을 문서·스크린샷에 남기지 않는다. 테스트가 바꾼 추적 파일은 결과를 `docs/qa/qa3/`로 복사한 뒤 원래 내용으로 복원한다.

## Ownership
- 편집 가능: `/Users/psw/Projects/toi-lite-qa3/docs/qa/qa3/**`

## Observable acceptance
- `docs/qa/qa3/QA3-REPORT.md`에 1~7절, 10건 판정 표, 전부 해결 여부. `docs/qa/qa3/shots/`에 근거 캡처. 종료 후 포트 8개 비어 있음.
