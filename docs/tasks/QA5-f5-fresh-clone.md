# QA5: 새 클론 F5 재검증 — QA4 미해결 항목과 핵심 회귀 (mock 에이전트)

## Target
- 작업 위치: **새 클론** `/Users/psw/Projects/toi-lite-qa5`(GitHub `main`의 최신 커밋, `dcac8e7` 이후). 원본과 이전 QA 클론은 건드리지 않는다.
- 포트 9개(8080·4873·9000·5173·5174·7100·7200·7300·7400)는 코디네이터가 비워 둔다. 시작 전에 비어 있는지 확인하고, 사용 중이면 ask.
- **모든 compose·dev-up·dev-down에 `COMPOSE_PROJECT_NAME=toi-qa5`**를 붙인다. 다른 compose 프로젝트(`toi-lite`, `toi-qa*`, `toi-fxb`)의 컨테이너·볼륨은 조작하지 않는다.
- 기준 문서(클론 안):
  - `docs/qa/qa4/QA4-REPORT.md`: Q4-N01·N02·N03, 문서 결함 D02~D04, 판정표
  - `e2e/F5-REPORT.md`
  - `docs/PROGRESS.md`
  - 루트 `README.md`
- 테스트 사용자 비밀번호는 클론 `.env`에서 메모리로만 읽는다. 값은 문서·스크린샷·로그·도구 출력에 남기지 않는다.
  - 로그인 입력 화면은 캡처하지 않는다.
  - 비밀번호가 보이는 요소는 선택자를 정확히 지정해 텍스트를 출력하지 않는다. QA4에서 모호한 selector 오류 때문에 ZIP 비밀번호가 도구 출력에 찍힌 사고가 있었다.

## Change
산출물은 클론의 `docs/qa/qa5/QA5-REPORT.md`와 `docs/qa/qa5/shots/`다. **소스 수정 금지.**

1. **기동(Q4-N01 재확인)**
   - 아무 준비 없이 `COMPOSE_PROJECT_NAME=toi-qa5 node scripts/dev-up.mjs` 한 줄로 띄운다. 소요 시간을 적는다.
   - 시작 로그에 `Docker Compose project: toi-qa5`가 나오는지, `docker ps -a`에 `toi-qa5-*`만 새로 생기는지 확인한다.
   - 다른 프로젝트 컨테이너·볼륨 목록은 작업 전후로 비교해 같아야 한다.
2. **Q4-N02 제거된 멤버**(실제 Chrome, 사람처럼 클릭)
   - QA4 재현 절차를 그대로 따른다: alice가 bob 추가 → bob이 프리뷰를 연 상태에서 alice가 bob 제거 → bob 프리뷰에서 사유 입력 후 조회.
   - 확인할 것:
     - 접근 불가 안내가 보이고 "조건에 맞는 고객이 없어요"는 보이지 않는다.
     - 편집·생성·저장 UI가 잠긴다.
     - "처음 화면으로"를 누르면 새로고침해도 그 프로젝트로 돌아가지 않는다.
   - 프리뷰 요청 없이 bob이 화면만 열어 둔 경우에도, 주기 확인이나 창 포커스 때 안내가 뜨는지 확인하고 걸린 시간을 적는다.
   - 대조: 멤버인 사용자가 존재하지 않는 고객 ID를 조회하면 "결과 없음" 계열 안내가 나와야 한다(접근 불가 안내와 구분).
3. **Q4-N03 viewer 다운로드**: bob을 viewer로 둔 채 다운로드 패널을 연다. 권한 안내 문구, 버튼 비활성, `aria-describedby` 연결(접근성 트리 또는 DOM), 상단 viewer 문구의 다운로드 제한을 확인한다. editor로 승격하면 다운로드가 되는지도 본다.
4. **Q4-D04 AES ZIP 안내**
   - 비밀번호 패널과 `services/policy-proxy/README.md`의 해제 도구 안내를 확인한다.
   - 설치돼 있으면 안내한 도구(`7z` 등)로 ZIP을 실제로 연다. 설치돼 있지 않으면 설치하지 말고 Python으로 AES 여부만 확인한다.
   - 전역 설치는 금지다.
5. **Q4-D02·D03 문서**: 루트 README, `apps/studio/README.md`, `services/agent-server/README.md`의 설명이 실제 동작과 맞는지 확인한다.
   - 토큰 없는 브로커
   - `connect-src 'none'`, script `data:` 없음
   - 프로젝트별 프리뷰 origin

   frame 콘솔에서 `__TOI_FETCH_CONFIG__`에 토큰이 없는지, 직접 fetch가 차단되는지 한 번씩 확인한다.
6. **핵심 회귀 스팟**(짧게)
   - alice 로그인·생성·저장
   - carol 비멤버 접근 거부
   - dana의 live 쓰기 승인
   - 브로커 조회·마스킹·사유 요구
   - `location.href` 외부 이동 → 안내·복구, 로컬 수신기에 토큰 0건
   - CSV 다운로드 1회·링크 재사용 거부
   - root `/audit/verify` ok
7. **스크립트**: `npm --prefix e2e ci && COMPOSE_PROJECT_NAME=toi-qa5 node scripts/dev-up.mjs --e2e && npm --prefix e2e run test:repeat` 1회. 결과 건수를 적는다(기대 123).
8. **종료**: `COMPOSE_PROJECT_NAME=toi-qa5 node scripts/dev-down.mjs --volumes` 후 포트 9개·서비스 프로세스·`toi-qa5` 컨테이너·볼륨이 모두 0인지 확인한다.

## 판정 형식
- 표 1(QA4 항목 재판정): `ID | QA4 판정 | QA5 판정(해결됨/부분/미해결) | 근거`. 대상은 Q4-N01·Q4-N02·Q4-N03·Q4-D02·Q4-D03·Q4-D04와 QA4 판정표에서 "부분"이었던 Q4-06·Q4-21.
- 표 2(회귀 스팟): `ID(Q5-01…) | 항목 | 통과/실패 | 근거`.
- 신규 발견은 QA4 형식으로 적는다.
- 마지막 줄: **"QA4 미해결 항목 전부 해결·P0 실사용 검증 통과: 예/아니오"**와 한 줄 근거.

## Constraints
- 소스·설정·계약 수정 금지. git commit·push 금지.
- 비밀값 원문을 도구 출력 포함 어디에도 남기지 않는다. 최종 산출물은 클론 `.env` 값과 대조해 일치 0건을 보고서에 적는다.
- 테스트가 바꾼 추적 파일은 결과를 `docs/qa/qa5/`로 복사한 뒤 원래 내용으로 복원한다.
- 외부 네트워크로 데이터를 보내지 않는다. 유출 시험은 로컬 수신기로만 한다.

## Ownership
- 편집 가능: `/Users/psw/Projects/toi-lite-qa5/docs/qa/qa5/**`

## Observable acceptance
- `docs/qa/qa5/QA5-REPORT.md`에 1~8절, 표 1·2, 신규 발견, 최종 판정이 있다.
- `docs/qa/qa5/shots/`에 근거 캡처가 있다.
- 종료 후 포트 9개가 비어 있고 `toi-qa5` 자원은 0이다.
