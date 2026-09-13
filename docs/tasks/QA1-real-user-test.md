# QA1: 새 클론에서 실제 사용자처럼 전체 테스트 (mock 에이전트)

## Target
- 작업 위치: **새 클론** `/Users/psw/Projects/toi-lite-qa` (GitHub `main`, 커밋 `da0df28`). 원본 `/Users/psw/Projects/toss-toi-test`는 건드리지 않는다.
- 기존 서비스·Docker 스택은 코디네이터가 모두 내렸다. 포트 4873·9000·5173·5174·7100·7200·7300·7400은 비어 있다.
- 기존 Docker 볼륨(`toi-lite_*`)과 섞이지 않도록 **모든 docker compose·dev-up 실행에 `COMPOSE_PROJECT_NAME=toi-qa`** 를 지정한다(compose `-p`/env가 파일의 `name:`보다 우선).
- 에이전트는 **mock 모드**(Claude API 키 없음). 실제 모델 생성 품질은 범위 밖이다.
- 참고 문서: 클론의 `README.md`「TOI-lite 실행」, `docs/ARCHITECTURE.md`, `intent/INTENT.md`, `e2e/README.md`, `bench/README.md`, `docs/FOLLOWUPS.md`

## Change
`docs/qa/QA-REPORT.md`(클론 안)에 결과를 쓴다. **소스는 수정하지 않는다.**

### 1. 문서대로 설치·기동 (처음 쓰는 개발자 관점)
- README 절차만 따라 `node scripts/dev-up.mjs`로 기동한다. 문서에 없는 조치가 필요했다면 전부 기록한다(명령, 이유, 걸린 시간).
- 콜드 스타트 전체 소요 시간과 단계별 시간, 첫 기동 시 생성되는 `.env`의 권한(600)·gitignore 여부, 로그에 비밀값 노출 여부를 확인한다.

### 2. 실제 브라우저에서 사람처럼 사용 (시스템 Chrome, 화면을 보면서)
스크립트 E2E가 아니라 사람이 하듯 클릭·입력하고 **화면 캡처를 남긴다**(`docs/qa/shots/`).
- 프로젝트 생성 → "고객 목록 화면 만들어줘" → 역질문 답변 → 코드·프리뷰 확인 → 조회 사유 입력 → 마스킹된 목록.
- "고객 상세 화면", "고객 상태 변경" 프롬프트. 쓰기 테스트 허용 토글 켜기/끄기, 2분 만료 후 동작.
- 코드 편집: 정상 수정, 문법 오류, 런타임 에러, 허용 목록 밖 import. 각 경우 사용자에게 보이는 문구가 이해 가능한지.
- 두 탭 동시 편집(CAS 충돌 안내와 복구 흐름), 생성 중 취소, 생성 중 새로고침(SSE 재연결).
- 사용성: 상태 표시·오류 문구·로딩·빈 상태가 사용자 관점에서 명확한지, 막히는 지점.

### 3. 장애 주입 (실제로 프로세스·컨테이너를 내렸다 올린다)
각 경우 사용자 화면에 무엇이 보이는지, 복구 후 정상화되는지:
- 생성 중 agent-server 재시작 / SSE 연결 중 끊김
- 조합 빌드 중 deps-builder 종료, MinIO 중지, Verdaccio 중지(새 조합 요청 시)
- policy-proxy 중지 상태에서 조회, mock-backend 중지 상태에서 조회
- 브라우저 네트워크 느리게(CDP throttling) 첫 화면·수정 반영

### 4. 보안 체감 점검 (브라우저 개발자 도구 수준)
- 프리뷰 iframe 콘솔에서 직접 `fetch`로 7200 `/dev/session`·`/capabilities`, 7400 `/generations` 호출 → 차단되는지.
- 프리뷰 콘솔에서 `__TOI_FETCH_CONFIG__` 확인: 들어 있는 세션이 viewer 전용인지, 수정 불가인지.
- 네트워크 탭에서 레지스트리 토큰·upstream 토큰·editor 세션이 프리뷰 쪽 요청/응답에 보이는지.

### 5. 종료·재기동
- `node scripts/dev-down.mjs` 후 포트·프로세스·컨테이너가 실제로 모두 정리되는지(남는 프로세스 목록).
- 다시 `dev-up` 했을 때 기존 프로젝트·조합 캐시가 유지되고 빠르게 뜨는지(warm 기동 시간).
- 스크립트 E2E `npm --prefix e2e run test:repeat`와 `npm --prefix bench run run`을 새 클론에서 1회 실행해 결과를 기록한다.

## 발견 사항 형식
각 항목: `심각도(blocker/major/minor/cosmetic)` · 제목 · 재현 절차(번호 목록) · 기대 결과 · 실제 결과 · 스크린샷/로그 경로 · 추정 원인 컴포넌트(코드로 확인했으면 파일:줄, 아니면 "추정").
마지막에 **요약 표**(영역별 통과/문제 수)와 **수정 우선순위**.

## Constraints
- 소스·설정·계약 수정 금지(클론 포함). 작성 가능: 클론의 `docs/qa/**`. git commit·push 금지.
- 모든 compose/dev-up 실행에 `COMPOSE_PROJECT_NAME=toi-qa`. 원본 저장소·기존 `toi-lite_*` 볼륨 조작 금지.
- 문서에 비밀값 원문을 쓰지 않는다. 스크린샷에 토큰이 보이면 가린다.
- 테스트가 끝나면 `dev-down`으로 정리하되, 정리 결과(남은 것)를 보고서에 적는다.

## Ownership
- 편집 가능: `/Users/psw/Projects/toi-lite-qa/docs/qa/**`

## Observable acceptance
- `docs/qa/QA-REPORT.md`에 1~5절, 발견 사항, 요약 표, 우선순위.
- `docs/qa/shots/`에 주요 화면·오류 화면 캡처.
- 종료 후 포트 8개가 비어 있음(또는 남은 이유 기록).
