# R1: 독립 리뷰 (TOI-lite 전체)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test` (main, 커밋 `3796c13` 기준)
- 리뷰 대상: `contracts/`, `packages/preview-runtime/`, `packages/fake-tds/`, `services/deps-builder/`, `services/policy-proxy/`, `services/mock-backend/`, `services/agent-server/`, `apps/studio/`, `scripts/`, `e2e/`, `bench/`, `infra/`
- 기준 문서: `intent/INTENT.md`(Constraints), `docs/ARCHITECTURE.md`, `contracts/src/*`, `docs/tasks/W1~W5, W1b`
- 너는 구현에 참여하지 않았다. 구현자의 README와 테스트 통과 보고를 근거로 받아들이지 말고 코드로 확인하라.

## Change
`docs/review/REVIEW.md`를 작성한다. 코드는 수정하지 않는다.

1. **보안 경계** (가장 우선)
   - 브라우저·프리뷰로 새는 비밀: 레지스트리 토큰, upstream 서비스 토큰, editor 세션, session/capability 서명 시크릿.
   - 정책 프록시 판정 순서와 우회: capability 위조·재사용·project 교차, 쓰기 메서드 판정, requireReason, 마스킹 누락(배열·중첩·대소문자·content-type 변형), 경로 조작(`/proxy/:apiId/../`), upstream allowlist, 감사 기록 누락.
   - 프리뷰 iframe: postMessage origin/source 검증, `document.write` 구성의 주입 가능성, hostConfig 이스케이프, frame.html의 허용 origin 목록.
   - 에이전트 도구: `write_file` 경로 탈출, 패키지 카탈로그 우회, 프롬프트 인젝션으로 정책 우회 가능성(등록 API 설명·응답 데이터 경유).
   - 운영 기본값: 개발용 시크릿 기본값으로 운영 모드에서 기동되는지, dev 세션 발급 API가 운영에서 꺼지는지.
2. **정합성**
   - revision guard·CAS·SSE replay·cancel의 경합(동시성, 재연결, 서버 재시작)과 계약과의 불일치.
   - deps-builder: single-flight, manifest-last, sha256 검증, artifactKey 입력 누락, 실패 후 재시도, MinIO 부분 업로드.
   - 계약(`contracts/src`)과 실제 HTTP 요청/응답 형태의 불일치.
3. **테스트의 실효성**: E2E·단위 테스트가 주장하는 것을 실제로 검증하는지(항상 통과하는 단언, mock으로 가려진 경로, sleep 의존 flaky 요소).
4. **INTENT Constraints 충족 표**: 8개 제약 각각 충족/부분/미충족 + 근거(파일:줄).
5. **벤치 해석 점검**: `bench/README.md`의 비교 조건이 공정하게 서술됐는지, 과장·누락.

## 발견 사항 형식
각 항목: `심각도(critical/high/medium/low)` · 제목 · `파일:줄` · 실패 시나리오(구체 입력 → 잘못된 결과) · 근거(코드 인용은 짧게) · 권고 수정 · **검증 여부**(직접 재현함/코드로만 판단).
- 가능하면 재현한다: 서비스는 이미 떠 있다(4873, 9000, 7100, 7200, 7300, 7400, 5173, 5174). curl·짧은 node 스크립트·기존 테스트 실행은 허용. 재현 스크립트는 `docs/review/repro/`에 남긴다.
- 추측성 지적은 "코드로만 판단"으로 표시하고 심각도를 한 단계 낮춘다.
- 마지막에 **수정 우선순위 목록**(critical/high 먼저)과 각 항목을 맡을 컴포넌트.

## Constraints
- 소스 코드·설정·계약 수정 금지. 작성 가능한 곳은 `docs/review/**`뿐. git commit 금지.
- 서비스 데이터를 망가뜨리는 파괴적 재현(대량 삭제, 볼륨 제거) 금지. 필요한 경우 새 프로젝트/새 API로 격리해서 재현.
- 비밀값을 리뷰 문서에 원문으로 쓰지 않는다.

## Ownership
- 편집 가능: `docs/review/**`

## Observable acceptance
- `docs/review/REVIEW.md`에 1~5 절, 심각도순 발견 목록, 수정 우선순위.
- critical/high 항목은 가능한 한 `docs/review/repro/`의 재현 스크립트와 실제 출력 포함.
