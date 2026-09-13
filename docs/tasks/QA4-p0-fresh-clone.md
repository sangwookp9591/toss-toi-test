# QA4: 새 클론 P0 실사용 검증 — 식별·격리·다운로드·감사·브로커 (mock 에이전트)

## Target
- 작업 위치: **새 클론** `/Users/psw/Projects/toi-lite-qa4`. GitHub `main`의 커밋 `7665546` 이후 최신을 쓴다. 원본과 이전 QA 클론은 건드리지 않는다.
- 포트 9개는 코디네이터가 비워 둔다: 8080·4873·9000·5173·5174·7100·7200·7300·7400. 시작 전 비어 있는지 확인하고, 비어 있지 않으면 ask.
- **모든 compose·dev-up·dev-down에 `COMPOSE_PROJECT_NAME=toi-qa4`**를 쓴다. 다른 compose 프로젝트의 컨테이너·볼륨은 조작하지 않는다.
- 기준 문서(클론 안):
  - `README.md` 실행 절, `docs/P0-DESIGN.md`
  - `services/policy-proxy/README.md`, `apps/studio/README.md`
  - `e2e/P0C-REPORT.md`, `e2e/F3A-REPORT.md`, `services/policy-proxy/bench/F3B-REPORT.md`
  - `docs/review/REVIEW-R3.md`
- 테스트 사용자 비밀번호는 dev-up이 만든 클론의 `.env`에서 읽는다. 값을 문서·스크린샷·로그에 남기지 않는다.
- 에이전트는 mock 모드다(`AGENT_MODE=mock`). 로컬 모델·Claude 키는 쓰지 않는다.

## Change
산출물은 클론의 `docs/qa/qa4/QA4-REPORT.md`와 `docs/qa/qa4/shots/`다. **소스 수정 금지.**

1. **기동**
   - 아무 준비 없이 `COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-up.mjs` 한 줄로 기동한다. 추가 조치가 필요하면 실패로 판정한다.
   - 소요 시간, 생성된 `.env` 권한(0600), README만으로 로그인 방법을 찾을 수 있는지 기록한다.
2. **식별·멤버십·승인**(실제 Chrome, 사람처럼 클릭)
   - alice 로그인 → 프로젝트 생성 → 생성·저장. 로그아웃 → 새로고침 → 로그인 화면. 무한 리다이렉트가 없어야 한다.
   - carol로 alice 프로젝트 URL 직접 입력 → 존재를 드러내지 않는 안내.
   - alice가 bob을 viewer로 추가 → bob은 프리뷰는 보지만 생성·저장 불가 문구 → editor 승격 → 생성 가능 → 제거 → 5초 안에 접근 거부.
   - alice live 쓰기 승인 요청 → alice 본인 승인 불가 → dana 로그인해 승인 → alice 화면에 반영.
3. **프리뷰 격리·브로커**
   - 두 프로젝트의 프리뷰 iframe origin이 다름(DevTools로 확인).
   - frame 콘솔에서 `__TOI_FETCH_CONFIG__`에 토큰이 없음, `fetch('http://localhost:7200/healthz')` 차단, `location.href='http://127.0.0.1:<로컬 수신기>/?x=1'` → 스튜디오 안내와 프리뷰 복구, 수신 요청에 토큰 없음.
   - 브로커 요청으로 목록 조회·마스킹 표시·사유 요구가 계속 동작한다.
   - 쓰기 토글 없이 상태 변경 → 거부 문구, 토글 후 성공, 만료 후 off.
   - 5174에 잘못된 Host로 요청 → 421. 스튜디오를 다른 origin에서 iframe으로 띄우면 차단된다.
4. **다운로드·감사**
   - alice CSV·XLSX 다운로드 → 비밀번호 1회 표시(닫으면 다시 볼 수 없음) → 받은 ZIP을 macOS 기본 도구와 `7z`(있으면) 또는 Python으로 열어 AES 암호화 확인. 비밀번호 없이는 열리지 않고, 마스킹 필드가 가려져 있어야 한다.
   - 같은 링크 재사용 → 거부. 60초 뒤 → 거부. bob(viewer) 다운로드 → 거부 문구.
   - root 로그인 → `/audit/verify` ok, anchorSeq 보고.
   - policy-proxy를 dev-down 없이 정상 종료·재기동해도 verify ok. 종료 시 앵커 flush를 확인한다.
   - MinIO 콘솔 또는 `mc`로 감사 세그먼트·앵커 객체에 retention이 걸려 있음을 확인한다. 삭제 시도는 하지 않는다. COMPLIANCE는 되돌릴 수 없으므로 볼륨은 dev-down으로만 정리한다.
5. **env 격리 스팟**: `ps eww`로 각 서비스 프로세스 env의 **키 이름만** 확인한다. mock-backend·studio에 세션·capability·KEK·Keycloak 비밀 키가 없어야 한다.
6. **기존 기능 회귀 스팟**
   - 역질문 답변, 새 탭 복원, 취소, CAS 보관본, 레지스트리 중지 안내·재시도, 런타임 오류 위치, 400px 레이아웃.
7. **스크립트**: `npm --prefix e2e ci && COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-up.mjs --e2e && npm --prefix e2e run test:repeat`를 1회 돌린다.
8. **종료**: `COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-down.mjs` 후 포트·프로세스·컨테이너 잔존 0을 확인한다. COMPLIANCE 객체가 볼륨 삭제를 막는지도 기록한다.

## 판정 형식
- 표: `ID | 영역 | 판정(통과/부분/실패) | 근거(캡처·로그 경로)`. 위 2~6절의 각 항목에 ID(Q4-01…)를 붙인다.
- 신규 발견은 이전 QA 형식으로 적는다: 심각도, 재현 절차, 기대/실제, 캡처.
- README만 보고 막힌 지점은 문서 결함으로 따로 적는다.
- 마지막 줄: **"P0 실사용 검증 통과: 예/아니오"**와 한 줄 근거.

## Constraints
- 소스·설정·계약 수정 금지. git commit·push 금지.
- 비밀값 원문을 문서·스크린샷에 남기지 않는다(비밀번호 입력 화면은 가린다).
- 테스트가 바꾼 추적 파일은 결과를 `docs/qa/qa4/`로 복사한 뒤 원래 내용으로 복원한다.
- 외부 네트워크로 데이터를 보내지 않는다. 유출 시험은 로컬 수신기만 쓴다.

## Ownership
- 편집 가능: `/Users/psw/Projects/toi-lite-qa4/docs/qa/qa4/**`

## Observable acceptance
- `docs/qa/qa4/QA4-REPORT.md`
  - 1~8절
  - 판정 표
  - 신규 발견
  - 문서 결함
  - 최종 판정
- `docs/qa/qa4/shots/`에 근거 캡처가 있다.
- 종료 후 포트 9개가 비어 있다.
