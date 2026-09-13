# TOI-lite 새 클론 QA 보고서

검증일: 2026-09-13. 대상: `/Users/psw/Projects/toi-lite-qa`, main `da0df28b5464a2dfaf57212c150cfe84d512ae0c`. Node 22.14.0, macOS Apple Silicon, 시스템 Google Chrome headed 모드. Claude 키 없는 mock 에이전트이며 모델 품질은 평가하지 않았다. 모든 Compose 및 dev-up/down은 `COMPOSE_PROJECT_NAME=toi-qa`를 지정했다. 원본 저장소와 `toi-lite_*` 볼륨은 조작하지 않았다.

수동 탐색은 시스템 Chrome을 실제 표시하고 Playwright의 클릭·입력 및 화면 캡처를 한 단계씩 사용했다. 자동 시나리오 E2E 결과와 구분한다. `agent-browser` CLI가 설치되지 않아 기존 e2e 의존성의 Playwright를 사용했다. 장애·보안의 개발자 도구 작업은 같은 Chrome의 CDP/evaluate로 수행했다. 저장소 소스·설정·계약은 수정하지 않았으며, 앱 UI가 저장한 프로젝트 데이터와 설치/실행 산출물은 정상 테스트 동작이다.

## 1. 문서대로 설치·기동

README의 `COMPOSE_PROJECT_NAME=toi-qa node scripts/dev-up.mjs` 첫 실행은 **11.737초에 실패**했다. `packages/fake-tds`의 `tsc`가 설치되지 않았다. 사용자에게는 원인을 숨긴 `Registry setup failed (Error); inspect registry health and configuration`만 보였다. 직접 `npm --prefix packages/fake-tds run build`로 확인하니 `sh: tsc: command not found`였다.

문서에 없는 복구 명령 `npm --prefix packages/fake-tds ci`는 **0.552초**, 이어 같은 dev-up 재실행은 **17.964초**, 복구 묶음은 **18.516초**였다. 실패 실행+복구 실행의 순수 명령 시간은 **30.253초**이며 진단·도구 조작 대기 시간은 포함하지 않는다. 첫 명령 시작부터 실제 준비 완료까지 벽시계는 **69.746초**(16:39:21~16:40:31 KST, 로그 생성/완료 시각 기준)였다. 진단·실행 사이 시간 약 39.493초를 포함한다. Docker 이미지는 호스트에 이미 있었고 `toi-qa` 볼륨은 새로 생성했다. npm/OS/상위 레지스트리 캐시는 비우지 않았으므로 완전히 새 머신의 시간은 아니다.

| 단계 | 첫 실행 경과 시간 / 복구 묶음 경과 시간 |
|---|---|
| 새 네트워크·볼륨 및 컨테이너 생성 | 첫 실행 0.143초부터 |
| 서비스별 npm ci | 첫 실행 약 1~10초, 로그 참조 |
| 레지스트리 익명 차단·개발 토큰 생성 | 10.621 / 10.867초 |
| fake-tds build 실패 | 11.726초 |
| 누락 패키지 npm ci | 복구 0.552초 완료 |
| tds 1.0.0 / 1.1.0 publish | 복구 10.114 / 10.819초 |
| fetch publish | 복구 12.874초 |
| backend / proxy / builder | 복구 13.955 / 14.967 / 16.480초 |
| agent / studio ready | 복구 17.997 / 18.509초 |

`.env` 권한은 **600**, `git check-ignore .env`는 `.env`를 반환했다. 실제 환경 비밀값을 메모리에서 읽어 시작 로그와 서비스 로그에 존재하는지 비교했고 원문 일치 **0건**이었다. 원문은 보고서에 저장하지 않았다. npm ci는 일부 기존 의존성의 취약성 경고를 출력했으며 보안 영향 분석이나 패키지 수정은 이 QA 범위 밖이다.

증거: [첫 기동](logs/cold-start.log), [직접 빌드 오류](logs/fake-tds-build-failure.log), [복구](logs/cold-start-recovery.log).

## 2. 실제 브라우저 사용자 흐름

| 시나리오 | 관찰 | 증거 |
|---|---|---|
| 빈 화면 → 프로젝트 생성 → 목록 요청 → 역질문 | 생성·질문·답변 정상 | [빈 화면](shots/01-empty.png), [질문](shots/02-question.png) |
| 사유 없이 조회 / 사유 입력 후 조회 | 5자 이상 안내, 이후 20명 이름·휴대폰 마스킹 | [입력 요구](shots/04-reason-required.png), [목록](shots/05-masked-list.png) |
| 고객 상세 | C001 한 명 조회 정상 | [상세](shots/06-detail.png) |
| 고객 상태 변경 | 기본 차단, 토글 on 후 suspended 성공, off 후 차단 | [차단](shots/07-write-blocked.png), [허용](shots/08-write-enabled.png), [off](shots/14-write-off.png) |
| 2분 만료 | 성공 직후 기준 124.164초 뒤 재시도 차단, 토글·설명은 계속 on | [만료](shots/13-write-expired-toggle-still-on.png) |
| 정상 코드 수정 | 제목 변경 반영 | [정상 수정](shots/09-normal-edit.png) |
| 문법 오류 / runtime throw / axios import | 저장 버전은 증가하지만 마지막 정상 프리뷰 유지, 진단 세부 정보 없음 | [문법](shots/10-syntax-error.png), [실행](shots/11-runtime-error.png), [import](shots/12-disallowed-import.png) |
| 두 탭 편집 CAS | 먼저 저장한 탭만 유지, 뒤 저장 탭에 충돌과 최신 불러오기 버튼 표시; 불러오기 후 최신 소스 복구 | [충돌](shots/15-cas-conflict.png), [복구 중](shots/16-cas-recovered.png) |
| 생성 중 취소 | 역질문 대기 중 취소, 이전 버전 유지·입력 가능 | [취소](shots/17-generation-canceled.png) |
| 생성 중 새로고침 | 질문·대화·진행 상태 소실, SSE 재구독 없음 | [전](shots/18-before-generation-refresh.png), [후](shots/19-generation-refresh-lost.png), [요청 기록](logs/refresh-sse.json) |

첫 화면 안내와 마스킹 결과는 이해하기 쉽다. 반면 빈 테이블은 열 제목만 있고 “조회 전”/“결과 없음” 상태가 없으며, 조회 진행 중 표시와 중복 클릭 차단도 없다. 역질문의 “답변” 버튼은 1600px에서도 좁아 세로로 줄바꿈된다. 코드 오류는 건수만 있고 위치·수정 방법이 없다. CAS 최신 불러오기는 로컬 미저장 변경을 덮어쓰므로 사용자가 먼저 복사해야 한다.

## 3. 실제 장애 주입

프로세스 그룹과 `toi-qa` 컨테이너만 대상으로 했다. 기록은 [faults.log](logs/faults.log)에 남겼다. 중단 서비스의 재기동은 모두 `COMPOSE_PROJECT_NAME=toi-qa node scripts/dev-up.mjs`, 컨테이너 단독 복구는 같은 환경을 지정한 `docker compose -f infra/docker-compose.yml start <service>`로 수행했다. 각 장애는 복구 후 다음 장애를 주입했다.

| 주입 | 사용자 화면 | 복구 확인 | 증거 |
|---|---|---|---|
| 질문 대기 중 agent-server SIGTERM | “생성을 중단했어요. 이전 화면은 그대로예요.” 정상 종료가 canceled를 전송 | 재기동 후 새 생성 질문까지 정상 | [화면](shots/22-agent-graceful-restart-canceled.png), [기동](logs/recover-agent.log) |
| 질문 대기/SSE 중 agent-server SIGKILL | “연결이 끊겨 다시 연결하고 있어요”와 질문 유지 | 재기동 후 failed 이벤트 수신, 이전 화면 유지, 보내기 다시 활성화 | [연결 끊김](shots/23-agent-killed-reconnecting.png), [복구](shots/24-agent-restart-failed-recovered.png), [SSE](logs/sse-reconnect.json) |
| CDP offline → online | 이미 열린 SSE는 관찰 구간에 끊기지 않았고 질문 유지 | online 후 답변·revision 10 정상 | [offline](shots/20-sse-offline.png), [복구](shots/21-sse-network-recovered.png); 실제 SSE 단절은 SIGKILL 행에서 입증 |
| 새 조합 POST HTTP 202 즉시 deps-builder SIGKILL | “이전 화면을 유지했어요: 구성 요소를 준비하지 못했어요”; 새로 연 탭이라 실제 이전 화면은 없음 | 재기동 후 새로고침, revision 11 프리뷰 및 조회 성공 | [실패](shots/28-builder-killed-during-build.png), [복구](shots/29-builder-backend-recovered.png) |
| MinIO stop 후 편집 및 새 조합 요청 | 구성 요소 준비 실패, 이미 있는 revision 11 화면 유지 | MinIO start 후 새로고침, revision 13 반영 | [새 조합 실패](shots/31-minio-down-new-combination.png), [복구](shots/32-minio-recovered.png), [컨테이너 상태](logs/minio-stopped-containers.json) |
| Verdaccio stop 후 tds 1.1.0 새 조합 요청 | 구성 요소 준비 중 → 22.544초 시점에는 구성 요소 준비 실패 | Verdaccio start 후 새로고침, revision 14 반영 | [대기](shots/33-verdaccio-down-pending.png), [실패](shots/34-verdaccio-down-failed.png), [복구](shots/35-verdaccio-recovered.png), [상태](logs/verdaccio-stopped-containers.json) |
| policy-proxy SIGTERM 상태에서 조회 | “조회 권한과 연결 상태를 확인하세요.” | 재기동 후 동일 iframe의 조회 재시도 성공 | [실패](shots/25-policy-proxy-down.png), [복구](shots/26-policy-recovered.png) |
| mock-backend SIGTERM 상태에서 조회 | 동일한 조회 오류, 이전 데이터는 남음 | 재기동 후 조회 성공(빌더 복구 화면에도 마스킹 목록 확인) | [실패](shots/27-backend-down.png), [복구](shots/29-builder-backend-recovered.png) |
| CDP 느린 네트워크 | “프로젝트를 준비”, “구성 요소를 준비”, “화면을 준비”를 거쳐 정상 반영 | 첫 commit 26,427.1ms, 수정 commit 1,811.1ms | [로딩](shots/37-slow-loading.png), [반영](shots/38-slow-ready.png), [수정](shots/39-slow-edit-ready.png), [측정](logs/slow-network.json) |

새 조합 선택 UI는 없으므로 장애 설정에 한해 스튜디오 개발자 도구에서 기존 `/projects/:id/source` API의 `packageSet`을 변경했다. 빌더 종료는 entries에 `react-dom`, MinIO는 `react/jsx-dev-runtime`을 추가했고 Verdaccio는 `@toi/tds`를 1.0.0→1.1.0으로 변경했다. repo 파일을 변경하거나 응답을 mock하지 않았다. builder의 202 응답은 building 상태이며 해당 응답 수신 즉시 실제 관리 프로세스 그룹을 SIGKILL했다. MinIO/레지스트리 중단은 새 조합 요청 전 주입으로, 업로드의 특정 바이트 구간을 조준한 실험은 아니다.

느린 연결은 CDP latency 400ms, download 750,000B/s, upload 250,000B/s, HTTP 캐시 clear, 동일 프로젝트의 서버 조합 cache hit 조건이다. 첫 화면은 navigation time origin부터 첫 committed 상태를 10ms 간격으로 관찰한 시점, 수정은 저장 버튼 클릭 직전부터 다음 committed까지다. 예비 관찰 후 캐시를 다시 비운 측정 1회를 기록했다. worker의 WASM 다운로드를 포함하므로 벤치의 범위와 다르다. 시스템 Chrome 창 자체의 [OS 캡처](shots/40-system-chrome-window.png)도 남겼다.

## 4. 브라우저 개발자 도구 보안 점검

프리뷰 iframe 실행 컨텍스트에서 JSON POST fetch를 직접 실행했다. `7200 /dev/session`, `7200 /capabilities`, `7400 /generations` 모두 `TypeError: Failed to fetch`로 브라우저에서 차단됐다. 코드에서도 Origin 검사 후 라우팅하도록 확인했다 (`services/policy-proxy/src/server.ts:97`, `services/agent-server/src/server.ts:31`). 같은 Origin을 지정해 별도로 확인한 OPTIONS·POST 응답 **6/6이 HTTP 403**, Allow-Origin 없음이었다. [서버 응답 검증](logs/origin-server-check.json).

`__TOI_FETCH_CONFIG__`에는 세션·capability·projectId·proxyBaseUrl·env가 있다. 세션 JWT의 roles는 **viewer만**이고, 객체는 `Object.freeze`되어 필드 수정이 실패했다. 전역 속성 자체는 writable이므로 객체 바인딩 재할당은 가능하다; 이것만으로 서명된 권한을 올릴 수 있다는 의미는 아니다. [토큰 없이 저장한 결과](logs/security.json).

프리뷰 iframe의 자산 응답과 고객 조회 요청/응답 10개를 수집해 실제 `.env`의 비밀값과 비교했다. 레지스트리 토큰·upstream 토큰 일치가 없고 업무 조회 Authorization의 roles는 viewer였다. 수집 내용 안의 JWT를 디코딩해 확인한 session roles도 viewer뿐이며 editor는 없었다. [프리뷰 네트워크 메타데이터](logs/preview-network.json), [credential 검사](logs/network-credential-scan.json). 토큰 원문을 기록하지 않았다. 최종 보고서·로그 및 서비스 로그 43개 비밀값 재검사에서도 원문 일치 0건이었다([검사 결과](logs/secret-scan.json)).

## 5. 종료·재기동 및 스크립트 검증

첫 `COMPOSE_PROJECT_NAME=toi-qa node scripts/dev-down.mjs`는 **4.029초**, exit 0이었다. 지정 포트 **8/8 리스너 없음**, QA 관리 서비스 프로세스 없음, QA 컨테이너·네트워크 제거를 확인했다. `ps` 결과 파일에 남은 두 행은 관찰에 사용한 shell/rg 자신이며 서비스 잔존이 아니다. Docker 볼륨은 보존했다. [종료](logs/first-down.log), [포트](logs/first-down-ports.log), [프로세스](logs/first-down-processes.log).

warm dev-up은 **6.895초**, exit 0으로 cold 명령 실행 30.253초보다 짧았다. 기존 프로젝트 이름·revision **16**·편집한 제목이 유지됐고 package-set POST는 **HTTP 200 cache hit**였다. [warm 기동](logs/warm-start.log), [보존 검증](logs/warm-project.json), [화면](shots/41-warm-project-preserved.png). 프로젝트 목록 UI는 없어 동일 `?project=` URL로 다시 열었다.

`npm --prefix e2e ci` 후 **`npm --prefix e2e run test:repeat` 1회** 실행: **18 passed (44.2s), 실패·skip·flaky 0**, 명령 전체 45.440초, exit 0. [콘솔 로그](logs/e2e-repeat.log), [원시 JSON](logs/e2e-results.json), [실행 화면](shots/42-e2e-studio.png). A~F 각 3회이며 조회·CAS·stale commit·viewer 경계·singleton을 포함한다.

`npm --prefix bench ci` 후 **`npm --prefix bench run run` 1회** 실행: 내부 3회 모두 완료, 전체 **15.074초**, exit 0. Chrome 153.0.8010.36 / Apple M4 / arm64. [로그](logs/bench-run.log), [원시 JSON](logs/bench-results.json).

| 항목(ms) | 1회 | 2회 | 3회 | 중앙값 |
|---|---:|---:|---:|---:|
| Sandpack cold | 1,046.8 | 936.0 | 876.7 | **936.0** |
| TOI cold, 조합 miss | 2,374.6 | 1,996.0 | 2,032.4 | **2,032.4** |
| TOI warm, 조합 hit | 395.9 | 383.3 | 395.9 | **395.9** |
| TOI 수정 반영 | 114.6 | 132.6 | 114.8 | **114.8** |

cold POST는 3회 모두 202, warm은 3회 모두 200이었다. README의 측정 경계·패키지 차이·원격 캐시 한계가 그대로 적용된다. 위 수치는 수동 사용자 전체 탐색이나 실제 모델 생성 시간을 포함하지 않는다. E2E와 bench는 동시에 실행하지 않았다.

테스트 명령이 원래 쓰는 추적된 산출물(`e2e/artifacts/*`, `bench/results.json`)은 실행 전 원본 바이트를 메모리에 보관하고 이번 결과를 `docs/qa/`로 복사한 뒤 원본을 복원했다. 최종 `git status --short`는 **`?? docs/qa/`만** 출력하며 추적된 파일 변경은 0이다. commit/push 하지 않았다.

마지막 `COMPOSE_PROJECT_NAME=toi-qa node scripts/dev-down.mjs`는 **4.038초**, exit 0. 종료 후 검증을 포함하면 4.342초였다. **8개 포트 모두 비어 있음, 관리 PID 잔존 0, toi-qa 컨테이너 잔존 0, clone 경로 서비스 프로세스 잔존 0**. QA에서 띄운 Chrome과 제어 REPL도 종료했다. 워커 터미널과 Docker Desktop 자체는 그대로 두었으며, 보존된 QA 볼륨 3개(`toi-qa_minio-data`, `toi-qa_verdaccio-auth`, `toi-qa_verdaccio-storage`)는 문서상 정상 보존이다. 원본 `toi-lite_*` 볼륨은 조작하지 않았다. [최종 종료](logs/final-down.log), [최종 포트](logs/final-down-ports.log), [정리 결과](logs/final-cleanup.json), [프로세스 검사](logs/final-process-scan.json).

## 발견 사항

### QA-01 · blocker · README 단일 기동이 새 클론에서 실패

1. 이 커밋을 새로 clone하고 의존성이 없는 상태에서 README의 dev-up을 실행한다.
2. 레지스트리 등록 단계가 실패한다.
3. `npm --prefix packages/fake-tds run build`로 확인한다.

기대: 필요한 모든 패키지 설치 후 스튜디오가 열린다. 실제: 11.737초 후 실패하며 직접 빌드 시 `sh: tsc: command not found`; 최상위 메시지는 레지스트리 설정 문제처럼 보인다. 증거: [cold log](logs/cold-start.log), [compiler log](logs/fake-tds-build-failure.log). 원인: `scripts/dev-up.mjs:33` 설치 대상에 fake-tds 누락, `services/deps-builder/scripts/setup-registry.mjs:31`에서 설치 없이 build 실행. 복구: 문서에 없는 `npm --prefix packages/fake-tds ci` 후 dev-up.

### QA-02 · major · 생성 중 새로고침하면 역질문과 SSE 연결을 복구할 수 없음

1. 목록/상세 생성 요청 후 역질문이 나타날 때까지 기다린다.
2. Chrome 새로고침을 누른다.
3. 같은 프로젝트가 열려도 질문·대화·생성 중 상태가 없고 새 생성만 가능하다.

기대: 진행 중 generationId/seq를 복구하고 질문 또는 명시적인 중단 결과를 보여 준다. 실제: 생성 전 저장 소스만 열고 SSE 구독 요청이 발생하지 않는다. 증거: [전](shots/18-before-generation-refresh.png), [후](shots/19-generation-refresh-lost.png), [SSE 요청 1회](logs/refresh-sse.json). 원인: `apps/studio/src/controller.ts:19` generationId가 메모리에만 존재하고 `:50` open은 프로젝트만 조회, `apps/studio/src/main.tsx:12` mount는 open만 호출.

### QA-03 · minor · 쓰기 권한 만료 후 토글·안내가 실제 권한과 불일치

1. 고객 상태 변경 화면을 생성하고 쓰기 테스트 허용을 켠다.
2. 쓰기가 성공하는지 확인한 뒤 2분 넘게 아무 편집 없이 기다린다.
3. 다시 상태 변경을 누른다.

기대: 만료 표시 또는 토글 off, 다시 허용하는 방법 안내. 실제: 서버는 안전하게 차단하지만 토글은 on이고 “2분 동안 쓰기를 허용해요” 설명이 남는다; 오류는 이미 켜진 토글을 켜라고 한다. 증거: [124.164초 뒤 차단](shots/13-write-expired-toggle-still-on.png). 원인: `apps/studio/src/controller.ts:108`은 boolean만 저장하며 `:111` TTL 120초와 UI 타이머가 연결되지 않음; `services/agent-server/src/templates.ts:51`의 일반 권한 오류.

### QA-04 · minor · 편집 실패의 원인·위치가 사용자에게 숨겨짐

1. 정상 App 제목을 바꿔 저장한 뒤 정상 반영을 확인한다.
2. `export default function App( { return <h1>oops</h1> }`를 저장한다.
3. runtime `throw new Error('QA runtime failure')`, 이후 `import axios from 'axios'`를 각각 저장한다.

기대: 파일·행·구문 또는 허용되지 않은 패키지 이름 및 수정 안내. 실제: 문법/axios 모두 “문법 오류 1건”, runtime은 “실행 중 오류”만 표시한다. 정상 프리뷰 유지 자체는 통과다. 증거: [문법](shots/10-syntax-error.png), [runtime](shots/11-runtime-error.png), [import](shots/12-disallowed-import.png). 원인: `apps/studio/src/controller.ts:31` diagnostics를 건수로만 표시, `:32` runtime 원인 미표시.

### QA-05 · minor · CAS 복구 버튼이 미저장 편집을 안내 없이 덮어씀

1. 같은 프로젝트를 두 탭에서 연다.
2. B 탭을 저장하고 A 탭에 다른 내용을 입력해 저장한다.
3. 충돌 안내의 “최신 내용 불러오기”를 누른다.

기대: 충돌 방지에 더해 로컬 편집 보관/복사 또는 덮어씀 안내. 실제: CAS는 정상 차단하지만 불러오기에서 A의 미저장 편집이 사라지고 되돌리기·병합 UI가 없다. 증거: [충돌](shots/15-cas-conflict.png), [불러오기](shots/16-cas-recovered.png). 원인: `apps/studio/src/controller.ts:73` → `:56`에서 files 전체 교체와 dirty false.

### QA-06 · minor · 의존성 장애 오류에 재시도 방법이 없고 없는 이전 화면을 유지했다고 표시

1. 새 조합을 요청해 building(HTTP 202)이 되자마자 builder 프로세스 그룹을 종료한다.
2. 처음 열린 탭의 빈 프리뷰와 상태 메시지를 확인한다.
3. 서비스를 올린 뒤 UI에서 복구 수단을 찾는다.

기대: 처음 표시 실패와 기존 화면 유지 실패를 구분하고 재시도 버튼/새로고침 안내 제공. 실제: 빈 프리뷰에 “이전 화면을 유지했어요: 구성 요소를 준비하지 못했어요”, 직접 새로고침해야 복구한다. MinIO/Verdaccio 장애에도 동일한 포괄 메시지만 제공한다. 증거: [빌더](shots/28-builder-killed-during-build.png), [MinIO](shots/31-minio-down-new-combination.png), [Verdaccio](shots/34-verdaccio-down-failed.png). 원인: `apps/studio/src/controller.ts:128` 고정 메시지, `apps/studio/src/main.tsx:24` 빈 상태에 재시도 동작 없음.

### QA-07 · minor · 조회 전/진행 중/결과 없음 구분이 없어 피드백 부족

1. 고객 목록을 생성하되 조회하지 않는다.
2. 사유 입력 후 조회한다(느린 연결 또는 서비스 장애도 비교).
3. 테이블과 조회 버튼, 오류 문구를 관찰한다.

기대: 조회 전 안내, 조회 중 진행/중복 클릭 방지, 완료·오류 상태 구분. 실제: 초기 테이블은 헤더만 존재하며 조회 버튼은 진행 중에도 그대로다; proxy와 backend 장애도 동일한 “조회 권한과 연결 상태” 메시지다. 증거: [조회 전](shots/04-reason-required.png), [backend 장애](shots/27-backend-down.png), [빈 표](shots/40-system-chrome-window.png). 원인: `services/agent-server/src/templates.ts:45` rows만 관리하고 `:53` load에 loading 상태가 없음, `:55` 일반 catch. mock 템플릿의 UX 문제이며 실제 모델 품질 평가는 아니다.

### QA-08 · cosmetic · 역질문 자유 답변 버튼의 글자가 세로로 줄바꿈

1. 1600×1000 스튜디오에서 생성 요청 후 역질문을 연다.
2. 직접 답변 입력칸 오른쪽 버튼을 본다.

기대: “답변”을 한 줄로 읽고 누를 수 있다. 실제: “답”과 “변”이 두 줄로 표시된다. 증거: [역질문](shots/02-question.png). 원인 컴포넌트: `apps/studio/src/main.tsx:21` free-answer 레이아웃 및 style.css 너비 배분(추정).

## 요약 표와 수정 우선순위

통과 수는 기능·안전·복구의 검증 묶음 수이며, 문제 수는 중복 없이 영역에 배정한 발견사항 수다. 같은 시나리오가 기능을 통과하면서 UX 문제를 가질 수 있으므로 두 열은 상호 배타적인 성공률 분모가 아니다.

| 영역 | 통과 수 | 문제 수 | 설명 |
|---|---:|---:|---|
| 설치·환경 | 5 | 1 | 전제 환경·프로젝트 격리·env 권한·ignore·비밀값 로그 검사 통과; QA-01 |
| 브라우저 사용자 흐름 | 9 | 6 | 생성·사유·마스킹·상세·쓰기 토글·서버 만료·편집 rollback·CAS·취소; QA-02/03/04/05/07/08 |
| 장애·느린 연결 | 8 | 1 | agent 정상/강제 종료, builder, MinIO, Verdaccio, proxy, backend, slow 연결 복구; QA-06 |
| 프리뷰 보안 | 4 | 0 | 발급 endpoint 차단, viewer 세션, frozen 필드, 비밀/editor 미노출 |
| 종료·warm 재기동 | 5 | 0 | 첫 정리, warm 기동, 프로젝트 보존, cache hit, 최종 정리 |
| E2E | 18 | 0 | A~F × 3 |
| bench | 3 | 0 | 3 trial 모두 유효 측정 |

**발견 8개: blocker 1, major 1, minor 5, cosmetic 1.** 주요 화면·오류 화면 캡처 42개를 보존했다. 보안의 전역 config 바인딩 writable 관찰은 권한 상승으로 이어지지 않았으므로 결함 수에 넣지 않았다. CDP offline만으로 SSE 단절을 입증하지 못한 점은 명시했으며, 실제 강제 종료로 재연결 동작을 별도 검증했다.

1. **P0 — QA-01**: dev-up 설치 대상에 fake-tds를 포함하고 실패 단계/안전한 원인 정보를 노출한다. 새 클론 기동 재검증이 최우선이다.
2. **P1 — QA-02**: 진행 중 generation 식별자와 seq를 복구하고 새로고침 후 질문/종료 상태를 다시 보여 준다.
3. **P2 — QA-03/04/05/06/07**: 쓰기 만료 UI, 편집 진단, CAS 로컬 변경 보존, 구성 요소 재시도, 조회 진행·빈 상태를 보완한다.
4. **P3 — QA-08**: 자유 답변 버튼 너비·줄바꿈을 조정한다.

소스 수정은 이 QA의 권한 밖이므로 모든 발견 사항은 미수정으로 남겨 두었다. 이 보고서는 mock 모드의 로컬 개발/프리뷰 품질 평가이며 실제 Claude 생성 품질·SSO·다중 인스턴스 운영·CSP 완전성 검증으로 확대 해석하지 않는다.
