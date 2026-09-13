# QA2 — 새 클론 재검증

검증일: 2026-09-13. 대상은 새 클론 `/Users/psw/Projects/toi-lite-qa2`, GitHub main `9fb2cae8ff75a2a8f568ffc99aaddf5750029454`이다. macOS Apple Silicon, Node 22.14.0, 시스템 Google Chrome 153.0.8010.36 headed 모드, Claude API 키 없는 mock 에이전트로 검증했다. 원본과 QA1 클론은 조작하지 않았으며 모든 Compose·dev-up·dev-down에 `COMPOSE_PROJECT_NAME=toi-qa2`를 지정했다.

기준은 QA1 보고서, FX-B 보고서, FX-A 결과, 루트와 스튜디오 README다. `agent-browser`가 설치되어 있지 않아 e2e의 Playwright로 실제 표시된 Chrome에서 클릭·입력·새로고침·탭 전환을 순차 수행했다. 자동 반복 E2E와 수동 탐색 결과를 구분했다. 서비스 장애는 실제 프로세스 그룹 종료와 `toi-qa2` 컨테이너 중단으로 주입했다. 소스·설정·계약은 수정하지 않았고, UI 편집은 저장소 파일이 아닌 테스트 프로젝트 데이터에만 저장했다.

## 1. QA-01 — 아무 준비 없는 README 단일 기동

**해결됨.** 이 작업의 첫 명령으로 `COMPOSE_PROJECT_NAME=toi-qa2 node scripts/dev-up.mjs`만 실행했다. 추가 설치·복구 조치 없이 **22.537초**에 스튜디오와 프리뷰 origin health 준비가 완료됐고 exit 0이었다. 단계 시간은 스크립트 자체의 단조 시계 로그다. 스크립트 로그에서 시간 기준 시작부터 마지막 ready까지이며, 이후 Chrome 수동 탐색 도구 설치·조작 시간은 포함하지 않는다.

| 단계 | 소요 시간 | 시작 후 완료 |
|---|---:|---:|
| 개발 설정 | 0.008초 | 0.008초 |
| Docker Compose | 1.327초 | 1.336초 |
| 레지스트리·스토리지 health | 0.548초 | 1.884초 |
| fake-tds 설치 | 0.739초 | 2.624초 |
| preview-runtime 설치 | 1.457초 | 4.081초 |
| mock-backend 설치 | 1.495초 | 5.577초 |
| policy-proxy 설치 | 1.522초 | 7.099초 |
| deps-builder 설치 | 1.357초 | 8.456초 |
| agent-server 설치 | 1.581초 | 10.037초 |
| studio 설치 | 1.111초 | 11.149초 |
| 레지스트리 설정·tds 빌드·게시 | 3.168초 | 14.317초 |
| fetch client 게시 | 2.083초 | 16.401초 |
| backend 시작 | 1.526초 | 17.928초 |
| proxy 시작 | 1.022초 | 18.951초 |
| builder 시작 | 1.525초 | 20.476초 |
| agent 시작 | 1.540초 | 22.017초 |
| studio 시작 | 0.516초 | 22.534초 |
| preview health | 0.002초 | 22.536초 |
| 전체 ready | — | **22.537초** |

새 `toi-qa2` 네트워크와 볼륨 3개가 생성됐고 7개 패키지 모두 실제 설치됐다. Docker 이미지·npm·OS 캐시는 초기화하지 않았으므로 새 머신의 다운로드 시간을 뜻하지 않는다. 증거: [단계별 원본 로그](logs/cold-start.log), [첫 Chrome 화면](shots/01-empty.png).

## 2. QA-02~08 — 실제 Chrome 재현

### QA-02 · 부분 해결

고객 목록·상태 변경 생성 → 역질문 대기 → 새로고침 → 다시 새로고침 순으로 수행했다. 두 번 모두 질문과 대화가 새로고침 전 값과 정확히 일치했다. 직접 답변 입력 후 `revision_ready`를 받고 revision 2가 반영됐다. 하지만 같은 URL을 별도 새 탭에서 열면 질문 0개, 대화와 진행 중 표시가 없고 새 요청 입력이 가능했다. 같은 탭 복원은 해결됐고, 요청된 다른 탭 확인은 통과하지 못했다. 원인은 프로젝트별 기록이 `sessionStorage`에만 있고 새 탭에서 서버의 진행 중 생성을 조회하지 않는 구조로 추정된다.

증거: [질문](shots/02-question-1600.png), [첫 새로고침](shots/03-refresh-1.png), [두 번째 새로고침](shots/03-refresh-2.png), [다른 탭](shots/04-other-tab.png), [답변·완료](shots/06-generation-ready.png), [정확한 비교 결과](logs/manual.json).

### QA-03 · 해결됨

기본 120초 설정 그대로 쓰기를 켰고 `1:59 남음`과 상태 변경 성공을 확인했다. 시간을 가속하지 않고 실제 **135.432초 뒤** 토글 off 및 “쓰기 허용 시간이 끝났어요. 다시 켜면 2분 동안 허용돼요.”를 관찰했다. 135.432초는 만료 전환 자체의 정밀 측정이 아니라 활성화부터 사후 확인까지의 실시간 간격이다. 해당 탭에는 중간 편집·재생성을 하지 않았고, 기다리는 동안 별도 프로젝트 탭에서 편집 검사를 수행했다. 다시 켜면 상태 변경이 성공했으며 수동 off도 가능했다.

증거: [on·남은 시간](shots/10-write-enabled-countdown.png), [실제 만료](shots/15-write-expired.png), [재허용 성공](shots/16-write-reenabled.png), [시간 기록](logs/manual.json).

### QA-04 · 부분 해결

정상 제목 수정 후 QA1 문법 오류, `throw new Error('QA runtime failure')`, `import axios from 'axios'`를 각각 UI에 입력하고 저장했다. 문법 오류는 `vfs:/src/App.tsx · 1행 38열`, axios는 `vfs:/src/App.tsx · 1행 18열`과 “‘axios’ 패키지는 이 프로젝트에서 쓸 수 없어요”를 표시했다. runtime은 `QA runtime failure` 원인을 표시하지만 **파일·행은 여전히 없다**. 세 경우 모두 마지막 정상 제목·프리뷰를 유지했고 정상 소스로 재저장하면 복구됐다. runtime 위치는 제공되지 않으면 만들지 않는다는 README 제한과 일치하지만, 이번 요청의 파일·행 확인 기준은 완전히 충족하지 못했다.

증거: [정상 편집](shots/11-edit-normal.png), [문법](shots/12-error-syntax.png), [runtime](shots/12-error-runtime.png), [axios](shots/12-error-axios.png), [진단·프리뷰 텍스트](logs/manual.json).

### QA-05 · 해결됨

같은 프로젝트의 A 탭에 로컬 편집을 남기고 B 탭에서 다른 제목을 먼저 저장했다. A 저장은 CAS 충돌로 차단됐다. “최신 내용 불러오기” 후 최신 제목이 반영되고 “내 편집 보관본”의 `/src/App.tsx`에 A 내용이 남았다. 파일을 펼쳐 “복사”를 클릭한 뒤 실제 클립보드와 보관본의 문자열이 일치함을 확인했다. 새로고침 후 보관본 1개가 유지됐다.

증거: [충돌](shots/13-cas-conflict.png), [보관본·복사 완료](shots/14-cas-backup-copy.png), [클립보드·새로고침 기록](logs/manual.json).

### QA-06 · 해결됨

새 조합 UI가 없으므로 QA1과 동일하게 Chrome 개발자 컨텍스트의 기존 `/projects/:id/source` API로 packageSet만 바꿨다. HTTP 응답 mock, 캐시 삭제, 저장소 설정 변경은 하지 않았다. 복구 동작은 실제 UI “다시 시도” 클릭이며 navigation time origin이 같음을 확인한다.

| 실제 장애 | 실패 표시·유지 화면 | 복구 |
|---|---|---|
| 새 조합 entries에 `react-dom` 추가, POST 202 직후 관리 builder 그룹 SIGKILL | 정상 commit 없음. “화면을 처음 준비하지 못했어요 … 구성 요소 서비스 연결 실패” | builder 재기동 후 버튼 클릭으로 동일 revision 2 반영 |
| MinIO stop 후 `react/jsx-dev-runtime` 추가 | “이전 화면을 유지했어요 … 구성 요소 서비스 응답 오류”, revision 2 유지 | MinIO 정상 health 200 확인 후 버튼 클릭으로 revision 3 반영 |
| Verdaccio 완전 중단 확인 후 tds `1.1.0`→`^1.1.0` 새 조합 | “이전 화면을 유지했어요 … 패키지 또는 버전 확인 필요”, revision 4 유지 | Verdaccio health 200 확인 후 버튼 클릭으로 동일 revision 5 반영 |

MinIO start 직후 health를 기다리지 않고 누른 첫 재시도는 응답 오류가 남았다. 이후 MinIO·Verdaccio health 200을 확인하고 같은 버튼을 다시 누르자 복구됐다. 이 사이 Verdaccio stop을 예비 실행했다가 바로 복구한 구간이 있어 첫 재시도 실패 원인을 MinIO 단독 결함으로 단정하지 않는다. 최종 MinIO 복구와 아래 Verdaccio 실험은 순차로 수행했다.

Verdaccio 첫 `1.0.0`→`1.1.0` 요청은 stop 명령 완료 전에 진행되어 revision 4가 반영됐다. 이 시도는 장애 검증에서 제외했다. 실제로 4873 연결 불가와 컨테이너 exited를 확인한 뒤 `^1.1.0`으로 요청한 결과 실패를 재현했다. 세 장애의 최종 복구는 모두 새로고침 없이 같은 navigation에서 이루어졌다. 재시도·이전 화면 구분 기준은 통과하지만 레지스트리 장애의 원인 안내는 신규 QA2-N02로 남는다.

증거: [최초 실패](shots/26-builder-first-failed.png), [builder 재시도](shots/27-builder-retry-recovered.png), [MinIO 이전 화면](shots/28-minio-previous-retained.png), [MinIO 복구](shots/29-minio-retry-recovered.png), [Verdaccio 실패](shots/31-verdaccio-failed.png), [Verdaccio 복구](shots/32-verdaccio-retry-recovered.png), [장애 시각·동일 navigation](logs/manual.json). 프로세스 복구 로그는 [builder](logs/recover-builder.log), 컨테이너 명령 로그는 `logs/*-stop*.log`, `logs/*-start*.log`에 있다.

### QA-07 · 해결됨

생성 직후 “조회 사유를 입력하고 조회를 눌러 주세요”가 보인다. Chrome CDP로 실제 연결에 1,500ms latency를 적용한 조회에서는 “조회 중…” 버튼이 비활성화됐다. 응답을 대체하지 않았으며 정상 완료 후 마스킹된 C001 상세를 확인했다. 존재하지 않는 고객 ID `QA2-NOT-FOUND`를 입력한 실제 404 응답은 “조건에 맞는 고객이 없어요”로 표시됐다.

실제 policy-proxy 프로세스 중단은 “정책 서버에 연결하지 못했어요. 잠시 후 다시 시도하세요.”, mock-backend 중단은 “고객 시스템이 응답하지 않아요. 잠시 후 다시 시도하세요.”였다. 각각 재기동 후 같은 iframe에서 다시 조회해 복구했다.

증거: [조회 전](shots/17-query-initial.png), [조회 중](shots/18-query-loading.png), [상세](shots/19-detail.png), [결과 없음](shots/20-query-empty.png), [proxy 실패](shots/22-policy-down.png), [proxy 복구](shots/23-policy-recovered.png), [backend 실패](shots/24-backend-down.png), [backend 복구](shots/25-backend-recovered.png).

### QA-08 · 해결됨

실제 질문 화면에서 viewport 1600×1000 및 400×1000을 확인했다. 양쪽 답변 버튼은 너비 48px, 높이 34px, line-height 20px, `white-space: nowrap`이며 한 줄이다. 오른쪽 경계는 각각 339.078px, 366px로 viewport 안에 있다.

증거: [1600px](shots/05-question-1600.png), [400px](shots/05-question-400.png), [측정](logs/manual.json).

## 3. 회귀·보안·반복 E2E

생성·역질문 답변, 5자 사유 요구, 이름·휴대폰 마스킹, C001 상세, 쓰기 기본 차단/on/만료/off/재허용, 정상 편집과 오류 rollback, 질문 대기 중 취소를 확인했다. 취소는 revision 3의 이전 상세 화면을 유지하고 입력을 다시 활성화했다. 증거: [사유](shots/07-reason-required.png), [마스킹](shots/08-masked-list.png), [기본 쓰기 차단](shots/09-write-blocked.png), [취소](shots/21-canceled.png).

실제 프리뷰 iframe에서 JSON POST로 `7200 /dev/session`, `7200 /capabilities`, `7400 /generations`를 호출한 결과 모두 브라우저 `Failed to fetch`로 차단됐다. `__TOI_FETCH_CONFIG__`의 session JWT roles는 **viewer만**, config 객체는 frozen이다. 토큰 원문은 반환·기록하지 않았다. 새 UI의 보관본·진단·재시도·남은 시간은 확인한 화면에서 비밀값이나 내부 서비스 주소를 표시하지 않았다. 파일 경로는 사용자 편집 파일 `vfs:/src/App.tsx`로 표시된다. 증거: [토큰 없는 보안 결과](logs/manual.json).

`npm --prefix e2e ci && npm --prefix e2e run test:repeat`를 **1회 실행**, exit 0, **45 passed / 실패 0 / skip 0 / flaky 0**이었다. 테스트 자체는 **108.158초**, 설치를 포함한 전체 명령은 **110.003초**다. 시작은 2026-09-13 08:39:18.046 UTC이며 기존 A–F와 G–K·레이아웃 총 15개를 각각 3회 실행했다. 앞서 수동 Chrome 제어를 위한 e2e 의존성 설치가 한 번 있었고, 반복 테스트 명령 자체는 추가 실행하지 않았다. 자동 H는 짧은 TTL, 일부 K는 네트워크 주입을 사용하므로 이 보고서의 실제 135초 대기·서비스 중단 결과와 구분한다. 증거: [콘솔](logs/e2e-repeat.log), [원시 JSON](logs/e2e-results.json), [명령 시간](logs/e2e-command.json), [E2E 화면](shots/e2e-studio.png).

실제 `.env`의 비밀값 4개를 문서·텍스트 로그·테스트 JSON·서비스 로그와 비교한 최종 검사에서 원문 일치 0건이었다. `.env` 권한은 0600이다. 화면의 새 UI 텍스트에서도 내부 주소·Bearer·JWT 형태가 없었고, 스크린샷은 주요 진단·보관본·만료·장애 화면을 시각 검토했다. 이 검사는 화면에서 읽히는 내용과 저장한 텍스트에 대한 스팟 체크이며 모든 브라우저 네트워크의 완전한 비밀값 감사는 아니다. 증거: [비밀값 검사](logs/secret-scan.json), [UI 텍스트 검사](logs/manual.json).

## 4. 신규 발견과 잔여 문제

### QA2-N01 · major · 별도 탭은 같은 프로젝트의 진행 중 역질문을 발견하지 못함

1. A 탭에서 프로젝트 생성 후 요청을 보내 질문 대기 상태로 둔다.
2. 같은 프로젝트 URL을 새 B 탭에 입력한다. 기존 탭 복제나 sessionStorage 수동 복사는 하지 않는다.
3. B 탭의 대화·질문·입력 상태를 확인한다.

기대: 같은 프로젝트의 진행 중 생성·질문을 복구하거나 다른 탭에서 진행 중이라고 명시한다. 실제: B는 대화·질문 없이 저장 revision 1만 표시하고 새 요청을 입력할 수 있다. A에서 두 번 새로고침하고 답변하는 흐름은 정상이다. 증거: [A 질문](shots/03-refresh-2.png), [B 빈 대화](shots/04-other-tab.png), [question count 0](logs/manual.json). 추정 원인: `apps/studio/src/controller.ts`의 `open()`이 sessionStorage에 있는 generation만 이어 받고 서버의 프로젝트별 활성 생성을 발견하지 않는다. QA-02 확장 조건에서 새로 확인된 범위이며 QA1 원래 동일 탭 새로고침 문제와 중복해서 독립 결함 수를 부풀리지 않는다.

### QA2-N02 · minor · 레지스트리 연결 장애를 패키지·버전 문제로 안내

1. 정상 프리뷰를 연 상태에서 `toi-qa2` Verdaccio를 중지하고 4873 연결 불가를 확인한다.
2. 기존 tds `1.1.0`을 유효한 범위 `^1.1.0`으로 바꿔 새 조합을 요청한다.
3. 실패 안내를 확인한 뒤 Verdaccio를 시작하고, 같은 revision·packageSet에서 “다시 시도”를 누른다.

기대: 레지스트리 연결 또는 구성 요소 서비스 장애를 안내하며 유효한 패키지 입력을 고치라고 하지 않는다. 실제: “패키지 또는 버전 확인 필요”라고 표시한다. 패키지와 소스를 변경하지 않고 레지스트리만 복구하면 동일 revision 5가 성공한다. 이전 화면 유지·재시도 기능은 정상이다. 증거: [잘못된 원인 안내](shots/31-verdaccio-failed.png), [동일 입력 복구](shots/32-verdaccio-retry-recovered.png), [실제 중단 상태](logs/verdaccio-stopped-containers.json), [동일 revision 기록](logs/manual.json). 추정 원인: `services/deps-builder/src/installer.ts`가 설치 실패를 모두 `InputError`로 만들고 서버가 HTTP 400으로 응답하며, `apps/studio/src/controller.ts`가 400을 패키지·버전 확인으로 일괄 분류한다.

QA-04의 runtime 위치 미표시는 기존 발견의 잔여 사항으로 분류한다. 새 진단 원인 메시지는 개선됐으나 파일·행까지 확인하는 기준에는 미달한다.

## 5. 종료·산출물 보존

Chrome 브라우저와 제어 Node를 종료한 뒤 `COMPOSE_PROJECT_NAME=toi-qa2 node scripts/dev-down.mjs`를 실행해 exit 0을 확인했다. 2026-09-13 08:42:53 UTC 최종 검증에서 **4873·9000·5173·5174·7100·7200·7300·7400 모두 리스너 없음**, 관리 PID 잔존 0, 관리 프로세스 그룹 잔존 0, `toi-qa2` 컨테이너 잔존 0이었다. QA2 볼륨 3개는 문서대로 보존했으며 다른 프로젝트 볼륨은 조작하지 않았다. 증거: [dev-down](logs/final-down.log), [8개 포트·프로세스·컨테이너·볼륨](logs/final-cleanup.json).

테스트가 변경한 추적된 `e2e/artifacts/*`는 실행 전 원본 바이트를 메모리에 보관하고 이번 산출물을 QA2로 복사한 뒤 원래 내용으로 복원했다. 최종 `git diff --stat`는 비어 있고 `git status --short`는 **`?? docs/qa/qa2/`만** 출력한다. 소스·설정·계약 수정과 commit·push는 없다. 수동 조작 스크립트·시각 및 상태 기록·스크린샷·E2E 결과는 모두 이 QA2 폴더에 보존했다.

## 판정 요약

| ID | QA1 심각도 | QA2 판정 | 근거(스크린샷/로그) |
|---|---|---|---|
| QA-01 | blocker | 해결됨 | [22.537초 단일 기동](logs/cold-start.log) |
| QA-02 | major | 부분 해결 | [연속 복원](shots/03-refresh-2.png), [새 탭 미복원](shots/04-other-tab.png) |
| QA-03 | minor | 해결됨 | [실제 2분 후 off](shots/15-write-expired.png), [재허용](shots/16-write-reenabled.png) |
| QA-04 | minor | 부분 해결 | [문법 위치](shots/12-error-syntax.png), [runtime 위치 없음](shots/12-error-runtime.png), [axios 이름](shots/12-error-axios.png) |
| QA-05 | minor | 해결됨 | [보관본·복사](shots/14-cas-backup-copy.png), [클립보드 일치](logs/manual.json) |
| QA-06 | minor | 해결됨 | [최초 실패](shots/26-builder-first-failed.png), [이전 화면 유지](shots/28-minio-previous-retained.png), [재시도 기록](logs/manual.json) |
| QA-07 | minor | 해결됨 | [loading](shots/18-query-loading.png), [empty](shots/20-query-empty.png), [서로 다른 장애](shots/24-backend-down.png) |
| QA-08 | cosmetic | 해결됨 | [1600px](shots/05-question-1600.png), [400px](shots/05-question-400.png) |

신규 발견: QA2-N01(major, 별도 탭의 활성 생성 미복원; QA-02 확장 조건), QA2-N02(minor, 레지스트리 장애를 패키지·버전 문제로 안내). 기존 잔여: QA-04 runtime 위치 미표시.

**QA1 발견 사항 전부 해결: 아니오 — 6건 해결, 2건 부분 해결(QA-02·QA-04).**
