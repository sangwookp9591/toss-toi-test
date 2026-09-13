# R2: 수정 검증 리뷰 (R1 발견 사항 재확인)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test` (main, 커밋 `d8b8bb0` 기준)
- 이전 리뷰: `docs/review/REVIEW.md`(R1), 재현: `docs/review/repro/`
- 수정 커밋: `4f9b42c`(F2: M2·M3·벤치), `d8b8bb0`(F1: C1·H1·H2·M1)
- 수정자 증거: `docs/review/repro/after/`, `services/policy-proxy/README.md`, `services/deps-builder/README.md`, `services/agent-server/README.md`

## Change
`docs/review/REVIEW-R2.md` 작성. 코드는 수정하지 않는다.

1. R1의 C1·H1·H2·M1·M2·M3·벤치 각각에 대해 **수정됨 / 부분 / 미수정 / 회귀** 판정과 근거(파일:줄, 실행 출력).
   - 가능하면 원래 repro를 실행 중 서비스(4873, 9000, 7100, 7200, 7300, 7400, 5173, 5174)에 **다시 실행**하고, 수정이 공격을 막는지 직접 확인한다.
   - "수정자 테스트가 통과했다"는 판정 근거로 쓰지 않는다.
2. **수정의 우회 시도**(가장 중요): 수정이 증상만 막았는지 확인한다. 예시 —
   - C1: Origin 헤더 누락·`null` origin(sandbox iframe, `data:`/`blob:` 문서)·대소문자·포트 변형, `Referer`만 있는 요청, 프리뷰에서 스튜디오 origin 창을 열어 요청(`window.open`/`opener`), 서버 간 호출 허용 규칙을 브라우저가 흉내내는 방법, `/audit` subject 필터 우회.
   - H1: dev-up이 만든 `.env`가 커밋되거나 로그·프로세스 목록에 노출되는지, ephemeral 시크릿 재시작 시 기존 세션 처리.
   - H2: 삼중 인코딩, 유니코드 전각 점(`．`), 오버롱 UTF-8, `;`·`?`·`#` 삽입, 세그먼트 끝 `.`, 다른 등록 API 템플릿으로의 교차.
   - M1: 키 이름 유니코드 변형, 숫자로 저장된 전화번호, 구분자 없는 번호, 대용량 응답 성능(재귀 스캔의 DoS 가능성), 비JSON content-type 위장.
   - M2: 금지 패턴 우회(동적 문자열 조합)가 **실제 정책 우회로 이어지는지** — 이어지지 않으면 low로.
   - M3: 새 병합 로직의 교착·영구 building 상태·예약 누수(빌드 실패 시).
3. **회귀**: E2E A~F를 직접 1회 이상 실행(`npm --prefix e2e run test`), 스튜디오 정상 흐름(생성→프리뷰→마스킹 목록→쓰기 허용 토글) 동작 여부.
4. 새로 발견한 문제는 R1과 같은 형식(심각도·파일:줄·실패 시나리오·근거·권고·검증 여부)으로.
5. 마지막에 **머지 판단**: 남은 critical/high가 없으면 "TOI-lite 1차 범위 종료 가능", 있으면 목록.

## Constraints
- 소스·설정·계약 수정 금지. 작성 가능: `docs/review/**`(새 재현은 `docs/review/repro/r2/`). git commit 금지.
- 파괴적 재현 금지. 비밀값 원문을 문서에 쓰지 않는다.

## Ownership
- 편집 가능: `docs/review/**`

## Observable acceptance
- `docs/review/REVIEW-R2.md`에 1~5절, 각 판정에 실행 근거, 우회 시도 결과표, 머지 판단.
