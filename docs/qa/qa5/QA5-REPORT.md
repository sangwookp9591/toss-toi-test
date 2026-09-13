# QA5 — 새 클론 F5 재검증

2026-09-14 KST, `/Users/psw/Projects/toi-lite-qa5`, main `0723efbfde7c5b162a392e8ed56d169530a1f913` (`dcac8e7` 이후). 시스템 Google Chrome **153.0.8010.36**, mock 에이전트. 기준은 [QA4](../qa4/QA4-REPORT.md), [F5](../../../e2e/F5-REPORT.md), [PROGRESS](../../PROGRESS.md), [루트 README](../../../README.md)다.

수동 검증은 **headed 시스템 Chrome**에서 실제 로그인·버튼 클릭·입력·역할 선택으로 수행했다. agent-browser CLI가 없어 저장소에 지정된 Playwright를 사용했다. 프레임의 설정·직접 fetch·`location.href`는 frame 실행 컨텍스트에서 검사했고, live capability 발급과 root 감사 verify만 로그인 후 메모리에 보관한 토큰으로 HTTP 검사했다. 인증 상태·토큰·비밀번호 파일은 만들지 않았으며 로그인 입력 화면을 캡처하지 않았다. 원본·이전 QA 클론은 변경하지 않았다.

## 1. 기동 — Q4-N01

준비 전 포트 **8080·4873·9000·5173·5174·7100·7200·7300·7400 모두 LISTEN 0**을 확인했다. 새 클론에 `.env`가 없는 상태에서 패키지 설치·설정 작성 없이 다음 한 줄을 실행했다.

```sh
COMPOSE_PROJECT_NAME=toi-qa5 node scripts/dev-up.mjs
```

**41.367초, exit 0**으로 전체 서비스가 준비됐다. 로그에 `Docker Compose project: toi-qa5`가 표시됐다. 새 컨테이너는 `toi-qa5-keycloak-1`, `toi-qa5-minio-1`, `toi-qa5-verdaccio-1`, `toi-qa5-verdaccio-init-1`의 4개이며 새 named volume 4개도 모두 `toi-qa5_` 접두사다. 다른 프로젝트의 컨테이너 ID·이름·라벨과 볼륨 이름·라벨은 작업 전후 동일했다. Docker 라벨 출력 순서는 비결정적이므로 key/value를 정렬하여 비교했다. 생성된 `.env`는 **0600**, agent-server 자식 프로세스의 `AGENT_MODE=mock`도 값 공개 없이 확인했다.

근거: [최초 상태](logs/before.json), [기동 로그](logs/cold-start.log), [기동 자원 비교](logs/startup.json), [관리 프로세스·mock 모드](logs/managed-start.json).

## 2. 제거된 멤버 — Q4-N02·Q4-06

alice가 UI로 고객 상세·상태 변경 화면을 생성하고 저장한 revision 3 프로젝트에 bob을 추가했다. bob이 프리뷰를 연 상태에서 alice가 UI로 bob을 제거했다.

| 검사 | 실제 결과 |
|---|---|
| 제거 후 사유 입력 → 조회, QA4 순서 재현 | 제거 클릭 시작부터 **137ms**에 proxy 404와 접근 불가 안내, iframe 0개, 쓰기 토글 잠금 |
| 사유를 미리 입력한 탭의 제거 후 조회 | **89ms**에 접근 불가 안내 |
| 조회 없이 열어 둔 별도 bob 탭 | **29.562초**에 주기 멤버십 확인으로 안내; preview proxy 요청 **0건**, membership 요청 총 2건(초기 포함) |
| 안내 | “이 프로젝트에 접근할 수 없어요. 멤버에서 제거되었거나 권한이 바뀌었을 수 있어요” |
| UI 잠금 | 두 탭 모두 iframe 0개, 생성 입력·보내기·소스 편집·저장 비활성. 별도 순서 재현에서 쓰기 토글도 비활성 확인 |
| 잘못된 빈 결과 | 두 탭 모두 “조건에 맞는 고객이 없어요” 표시 0개 |
| 처음 화면으로 | 클릭 후 프로젝트 생성 화면으로 복귀; 새로고침해도 project 쿼리가 없고 제거된 프로젝트를 복원하지 않음 |
| 대조: 멤버 alice + 존재하지 않는 고객 ID | “조건에 맞는 고객이 없어요”가 표시되고 접근 불가 안내는 없음 |

시간은 제거 버튼 클릭 직전부터 안내 관측까지의 벽시계 값이다. 주기 검사는 fake clock·응답 mocking 없이 실제 대기했고, 창 포커스를 강제로 발생시켜 통과시키지 않았다. 최초 조회 시험은 사유를 미리 입력했으므로 요구한 “제거 후 사유 입력” 순서를 [별도 보완 실행](supplement.mjs)에서 다시 확인했다.

근거: [실측 JSON](logs/manual.json), [제거 후 조회](shots/08-removed-query.png), [주기 확인](shots/09-removed-idle.png), [복귀 후 새로고침](shots/10-return-home-reload.png), [정확한 순서 재현](shots/15-removed-exact-order.png), [일반 고객 404 대조](shots/04-nonexistent-customer.png).

## 3. viewer 다운로드 — Q4-N03·Q4-21

bob viewer에서 다운로드 패널을 열고 5자 이상의 사유를 입력했다. “암호화 파일 만들기”는 비활성이었고 다음 설명이 보였다.

> 암호화 다운로드는 editor 이상만 할 수 있어요. 프로젝트 owner에게 권한을 요청하세요.

버튼의 `aria-describedby="_r_0_"`가 실제 존재하고 표시된 설명 요소 ID와 연결됨을 DOM과 접근 가능한 설명 검사로 확인했다. 상단 viewer 안내도 “생성·저장·쓰기 테스트·암호화 다운로드는 편집자 이상”을 포함했다. alice가 UI로 bob을 editor로 승격하고 bob이 새로고침한 뒤 같은 패널로 CSV ZIP을 생성·저장하면 **HTTP 200**이었다. 역할 승격이 자동 반영된 것으로 주장하지 않는다.

근거: [viewer 화면](shots/05-viewer-download.png), [editor 다운로드](shots/06-aes-notice-password-masked.png), [실측 JSON](logs/manual.json).

## 4. AES ZIP 안내 — Q4-D04

비밀번호 패널은 “AES-256 ZIP은 macOS 기본 압축 해제 도구로 열 수 없어요. 7-Zip, Keka 또는 7z x를 사용하세요”라고 안내한다. [policy-proxy README](../../../services/policy-proxy/README.md)도 같은 제약과 `7z x download.zip`을 안내한다.

`7z`, `7zz`, `keka` 실행 파일과 `/Applications/Keka.app`이 없어 **설치하지 않았다**. 실제 UI에서 받은 CSV ZIP을 Python 표준 라이브러리로 검사하여 encrypted=true, compression method=99, AES extra field vendor=AE, version=2, strength=3(**AES-256 AE-2**)를 확인했다. 비밀번호 없는 읽기는 거부됐다. 이 수동 확인은 AES 형식 검사이며 지원 도구로 실제 복호화했다고 주장하지 않는다. 기존 E2E T의 올바른 비밀번호 복호화·마스킹·잘못된 비밀번호 거부 결과는 7절에서 별도로 집계한다.

비밀번호 요소는 정확한 `output[aria-label="ZIP 비밀번호"]` 선택자로 캡처 시 가렸으며 원문 textContent를 읽거나 출력하지 않았다. “비밀번호 닫기” 후 해당 요소가 0개가 됐다.

근거: [비밀번호를 가린 도구 안내](shots/06-aes-notice-password-masked.png), [ZIP 형식 검사](logs/zip-inspection.json), [실제 암호화 ZIP](logs/download.zip).

## 5. 문서와 실제 보안 경계 — Q4-D02·D03

| 대상 | 문서 확인 및 실제 대조 |
|---|---|
| 루트 README | frame에는 `{ projectId, env, transport: "broker" }`만 전달하고 세션·capability는 Studio 메모리에 보관한다고 수정됨. CSP 표는 `connect-src 'none'`, script `data:` 없음 |
| Studio README | 첫 문단부터 프로젝트별 `p-<projectId>.preview.localhost:5174` origin을 설명; 토큰 없는 broker와 접근 철회·주기 확인 설명이 실제 동작과 일치 |
| agent-server README | frame 설정의 필드를 projectId·env·transport로 한정하고 reason을 부모 broker로 전달한다고 설명. 404 PROJECT_NOT_FOUND와 일반 고객 404 구분도 실제 UI와 일치 |
| frame 실행 컨텍스트 | `__TOI_FETCH_CONFIG__` 키는 `env, projectId, transport`만 있음. frozen=true, transport=broker, 토큰 필드 없음 |
| 직접 fetch | frame에서 `fetch('http://localhost:7200/healthz')` 1회 실행 → 예외로 차단 |
| 응답 CSP | 실제 frame 응답은 `connect-src 'none'`; script는 self·7100·nonce만 포함하고 `data:` 없음 |
| 프로젝트별 origin | 두 UI 생성 프로젝트의 frame origin이 서로 다름(아래 및 실측 JSON) |

- `http://p-f30cffcd-4e00-457b-82fc-24d4848819da.preview.localhost:5174`
- `http://p-d1eb9a66-8628-48df-a34f-8285bccfe650.preview.localhost:5174`

근거: [문서 관련 행](logs/document-check.txt), [frame 설정·CSP·origin 실측](logs/manual.json). Studio README의 별도 패키지 버전 표기 잔여 오류는 신규 발견 Q5-D01에 기록했다.

## 6. 핵심 회귀 스팟

### 표 2 — 회귀 스팟

| ID | 항목 | 통과/실패 | 근거 |
|---|---|---|---|
| Q5-01 | alice 로그인·프로젝트 생성·mock 생성·UI 저장 | 통과 | [revision 3 저장](shots/01-alice-generated-saved.png), manual.json alice |
| Q5-02 | carol 비멤버 접근 거부 | 통과 | [접근 불가·iframe 0](shots/11-carol-denied.png) |
| Q5-03 | dana live 쓰기 승인 | 통과 | [dana 승인](shots/12-dana-approved.png), alice 수동 새로고침 반영, live write capability 200 |
| Q5-04 | 브로커 조회·마스킹·사유 요구 | 통과 | [빈 사유 거부](shots/02-reason-required.png), [마스킹](shots/03-broker-masked.png) |
| Q5-05 | preview 쓰기 기본 거부·허용 후 쓰기 | 통과 | manual.json previewWrite: 기본 권한 거부 후 UI 토글 허용으로 상태 변경 성공 |
| Q5-06 | `location.href` 로컬 외부 origin 이동 안내·복구 | 통과 | [안내](shots/13-navigation-notice.png), [원래 화면 복구](shots/14-navigation-recovered.png), 로컬 수신 0건·토큰 0건 |
| Q5-07 | CSV 1회 다운로드·링크 재사용 거부 | 통과 | editor 저장 200, 재사용 410, [비밀번호를 가린 거부 안내](shots/07-download-reuse-masked.png) |
| Q5-08 | root `/audit/verify` | 통과 | manual.json audit: HTTP 200, ok=true, degraded=false, anchorSeq=lastSeq=35 |

이동 시험은 프레임 콘솔에 해당하는 실행 컨텍스트에서 `location.href`를 loopback 수신기로 설정했다. 프레임에 자격 증명을 새로 주입하지 않았다. 수신기는 요청 URL·헤더의 메모리 비교와 건수만 보관했다. 이 한 차례의 0건 결과를 모든 종류의 내비게이션·마스킹 데이터 유출에 대한 일반 보장으로 확대하지 않는다. 승인 만료·audit 장기 보존 등 전체 QA4 수동 범위는 이번 짧은 회귀 범위에 포함되지 않는다.

## 7. 지정 스크립트 1회

```sh
npm --prefix e2e ci && COMPOSE_PROJECT_NAME=toi-qa5 node scripts/dev-up.mjs --e2e && npm --prefix e2e run test:repeat
```

**41개 시나리오 × 3회 = 123개 통과, 실패·skip·flaky 0건, exit 0**이다. Playwright 실행은 **582.013초**, npm ci·E2E 기동을 포함한 전체 명령은 **605.455초**였다. 원본 JSON을 파일·행·시나리오로 집계해 각 시나리오가 정확히 3회 실행되고 모든 결과가 passed임을 확인했다. worker 0·1·2는 각각 41개 통과했다. 수동 브라우저 구동을 위해 앞서 수행한 `npm --prefix e2e ci`는 이 전체 반복 명령과 별개이며, 지정한 전체 반복 명령은 한 번만 실행했다. 원래 E2E는 시스템 Chrome channel을 사용하는 headless 검사이며, 2~6절 headed 수동 검사와 구분한다.

테스트가 바꾼 **추적 파일 8개**(results JSON·캡처 7개)는 결과를 `docs/qa/qa5/test-artifacts/`로 복사한 뒤 실행 전 바이트로 복원했다. 최종 git status는 `?? docs/qa/qa5/` 하나이며 기존 추적 파일 변경은 0건이다. 소스·설정·계약 수정이나 commit·push는 하지 않았다.

근거: [123개 최종 집계](logs/e2e-summary.json), [반복 실행 로그](logs/e2e-repeat.log), [실행·복원 기록](logs/e2e-command.json), [결과 JSON](test-artifacts/e2e/artifacts/results.json).

## 8. 종료·산출물 검증

E2E 종료 후 `COMPOSE_PROJECT_NAME=toi-qa5 node scripts/dev-down.mjs --volumes`는 **exit 0**으로 완료됐다. 종료·검사 총 **5.399초**이며, 지정 포트 9개 LISTEN **0**, 종료 전 추적한 관리 서비스·자식 PID 19개 잔존 **0**, `toi-qa5` 컨테이너·볼륨·네트워크 **각 0개**다. 프로세스 레지스트리도 삭제됐다. 다른 프로젝트 컨테이너와 볼륨 목록·정렬된 라벨은 최초 상태와 **동일**하다. 근거: [종료 로그](logs/dev-down.log), [종료 전 관리 PID](logs/managed-before-down.json), [최종 정리 검증](logs/final-cleanup.json).

비밀값 검사는 `.env`의 비어 있지 않은 **26개 전체 값**(공개 설정 포함)을 메모리에서 읽어 최종 산출물 전체 바이트 및 PNG의 로컬 Tesseract OCR 텍스트와 대조한다. 로그인 입력 캡처·인증 상태 파일·원문 비밀번호 출력은 없다. 최종 산출물에서 원문 값 일치는 **바이트 검사 0건·OCR 검사 0건**이다. 근거: [최종 비밀값 검사](logs/secret-scan.json).

수동 harness의 초기 두 번은 “보내기 ↑”에서 화살표를 빠뜨린 exact locator 때문에 중단됐다. 정확한 접근 가능한 이름으로 수정한 최종 실행 결과만 판정했다. 내비게이션 확인 이후 로컬 HTTP 수신기의 close가 Chrome의 선행 연결을 기다려 해당 QA 브라우저만 닫았으며, root 검증과 제거 후 사유 입력 순서를 별도 headed 실행에서 완료했다. 제품 소스는 수정하지 않았다.

### 표 1 — QA4 항목 재판정

| ID | QA4 판정 | QA5 판정(해결됨/부분/미해결) | 근거 |
|---|---|---|---|
| Q4-N01 | 최초 실패, 수정 후 통과 | 해결됨 | 새 클론 무준비 41.367초 기동, 새 자원 모두 toi-qa5, 다른 프로젝트 동일(1절) |
| Q4-N02 | 미해결 | 해결됨 | 제거 뒤 사유 입력·조회 137ms 접근 불가, UI 잠금, 주기 감지·복귀 유지(2절) |
| Q4-N03 | 미해결 | 해결됨 | viewer 권한 설명·버튼 비활성·aria 연결·상단 다운로드 제한·editor 성공(3절) |
| Q4-D02 | 미해결 | 해결됨 | 루트·agent README의 토큰 없는 broker와 CSP가 실제 frame 검사와 일치(5절) |
| Q4-D03 | 미해결 | 해결됨 | Studio 첫 문단 프로젝트별 origin, 실제 두 origin 구분(5절) |
| Q4-D04 | 안내 보완 필요 | 해결됨 | UI·README의 해제 도구 안내 및 실제 ZIP AES-256 AE-2 확인(4절) |
| Q4-06 | 부분 | 해결됨 | 제거 요청 거부에 더해 안내·잠금·복귀까지 확인(2절) |
| Q4-21 | 부분 | 해결됨 | 비활성 원인 설명과 접근 가능한 설명이 연결됨(3절) |

### 신규 발견

#### Q5-D01 — low, 미해결: Studio README의 broker 패키지 버전 표기가 이전 버전

- 재현: `apps/studio/README.md:39`의 broker 설명과 최신 기동 게시 로그·기본 packageSet 비교.
- 기대: 현재 사용되는 `@toi/fetch@1.1.1`을 표기하거나 버전 번호를 생략.
- 실제: 해당 문단은 `@toi/fetch@1.1.0`이라고 적지만 기동은 1.1.1을 게시하고 기본 packageSet도 1.1.1을 사용한다.
- 영향: 문서의 패키지 버전 혼동. 토큰 없는 broker·권한 오류 안내·실제 실행에는 영향이 없고 QA4 D02/D03의 보안 경계 설명 결함은 해결됐다.
- 근거: [문서 행](logs/document-check.txt), [1.1.1 게시 로그](logs/cold-start.log), `services/agent-server/src/templates.ts:7`.
- 조치: 소스·기존 문서 수정 금지에 따라 보고만 함. 수동 검증과 123개 E2E에서 신규 기능 결함은 발견하지 못했다.

**QA4 미해결 항목 전부 해결·P0 실사용 검증 통과: 예** — 대상 QA4 8항목 해결, 핵심 수동 회귀·E2E 123개 통과, 종료 자원 0 및 비밀값 일치 0; 신규 low 문서 버전 표기 1건은 실행·보안 경계에 영향이 없어 별도 후속이다.
