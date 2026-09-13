# QA3 — 새 클론 최종 확인

검증일: 2026-09-13. 대상: `/Users/psw/Projects/toi-lite-qa3`, macOS Apple Silicon, Node 22.14.0, **실제 Google Chrome 153.0.8010.36 headed 모드**, mock 에이전트. 작업 시작 HEAD는 `f7577f5befce1868ab20006ea1980c8f2d78a99a`이며, 지정 `f924d27` 위에 `docs/tasks/QA3-final-verification.md`만 추가된 커밋이다. 제품 소스·설정·계약은 지정 커밋과 동일하다. 원본·이전 QA 클론은 조작하지 않았다.

기준: [QA2 보고서](../qa2/QA2-REPORT.md), [FX2-A 보고서](../../../e2e/artifacts/FX2-A-REPORT.md), [preview-runtime README](../../../packages/preview-runtime/README.md). `agent-browser` 미설치로 QA2와 동일하게 e2e의 Playwright를 통해 표시된 시스템 Chrome에서 실제 UI를 클릭·입력·새로고침·새 탭 탐색했다. 별도 Chrome 탭은 `context.newPage()` 후 URL 직접 탐색으로 만들었으며 탭 복제·sessionStorage 복사는 하지 않았다. 모든 Compose·dev-up·dev-down에 `COMPOSE_PROJECT_NAME=toi-qa3`를 사용했다.

## 1. 아무 준비 없는 단일 기동 — QA-01

**해결됨.** 설치·설정 준비 없이 `COMPOSE_PROJECT_NAME=toi-qa3 node scripts/dev-up.mjs` 한 줄로 시작했고, 추가 조치 없이 **22.274초, exit 0**에 스튜디오·프리뷰 health가 준비됐다. 기동 전 확인한 8개 포트에는 리스너가 없었다. 시각은 스크립트의 단조 시계이며 Chrome 조작 도구 설치 시간은 포함하지 않는다.

| 단계 | 소요 | 시작 후 완료 |
|---|---:|---:|
| 개발 설정 | 0.009초 | 0.009초 |
| Docker Compose | 1.344초 | 1.353초 |
| registry·storage health | 0.542초 | 1.895초 |
| fake-tds 설치 | 0.711초 | 2.607초 |
| preview-runtime 설치 | 1.540초 | 4.147초 |
| mock-backend 설치 | 1.492초 | 5.640초 |
| policy-proxy 설치 | 1.614초 | 7.254초 |
| deps-builder 설치 | 1.394초 | 8.648초 |
| agent-server 설치 | 1.600초 | 10.248초 |
| studio 설치 | 1.211초 | 11.460초 |
| registry 설정·tds 게시 | 3.148초 | 14.608초 |
| fetch client 게시 | 2.067초 | 16.676초 |
| backend 시작 | 1.016초 | 17.692초 |
| proxy 시작 | 1.013초 | 18.706초 |
| builder 시작 | 1.515초 | 20.222초 |
| agent 시작 | 1.523초 | 21.745초 |
| studio 시작 | 0.524초 | 22.270초 |
| preview health | 0.003초 | **22.274초** |

새 `toi-qa3` 네트워크와 볼륨 3개를 생성하고 7개 패키지를 실제 설치했다. Docker 이미지·npm·OS 캐시는 초기화하지 않았으므로 새 머신 다운로드 시간의 측정은 아니다. 기동 이후 Chrome 제어용 `npm --prefix e2e ci`를 별도 1회 실행했다. 증거: [기동 원본 로그](logs/cold-start.log), [첫 화면](shots/01-empty.png).

## 2. 새 탭과 같은 탭 복원 — QA2-N01 / QA-02 확장

**모두 해결됨.** QA2 §4의 별도 탭 절차와 추가 조건을 실제 Chrome에서 확인했다.

| 동작 | 관찰 결과 | 근거 |
|---|---|---|
| A에서 요청 후 역질문 대기 | 원문 `고객 목록 상태 변경 화면 만들어줘 — QA3 원문 보존`, assistant 대화, “조회 사유 기본값을 넣을까요?” 표시 | [A 질문](shots/02-A-question.png) |
| A에서 새로고침 2회 | 매번 질문·전체 chats가 새로고침 전 값과 정확히 일치 | [1회](shots/03-refresh-1.png), [2회](shots/03-refresh-2.png) |
| 새로운 B 탭에 같은 URL 직접 입력 | 원문·assistant 대화·질문 복원, “다른 창에서 진행 중인 요청이 있어요”, 새 요청 입력 비활성 | [B 복원](shots/05-B-new-tab-restored.png) |
| B 자유 답변 “아니요” 제출 | A 질문 `data-state=answered`, “답변이 반영됐어요”, A 이벤트 `revision_ready`, 양쪽 revision 2 커밋 | [A 답변·완료](shots/06-A-answered-ready.png) |
| A에서 다음 생성 대기, 이미 열린 B에서 새 요청 제출 | 다른 창 안내와 기존 질문 복원, **새 POST /generations 0회** | [중복 차단](shots/07-B-duplicate-blocked.png) |
| B에서 생성 중단 | A에 “생성을 중단했어요. 이전 화면은 그대로예요.”, 질문 제거·입력 재활성화, 기존 프리뷰 유지 | [A 종결](shots/08-A-canceled-from-B.png) |

정확한 값 비교·이벤트 판정·요청 횟수는 [후속 수동 기록](logs/manual-followup.json)의 `cross-tab`에 있다. 첫 관찰 스크립트는 A에도 복원 탭 전용 `.generation-notice`가 있다고 가정해 실패했지만 실제 A의 하단 status에는 정상 종결 문구가 있었다. 위 재검사는 사용자 요구인 **종결 표시**를 실제 status에서 검증한다. [첫 관찰 화면](shots/failure-N01.png)과 [첫 기록](logs/manual.json)을 그대로 보존했으며 제품 실패로 계산하지 않았다.

## 3. 실제 저장소 중단·대조군·동일 입력 재시도 — QA2-N02

**해결됨.** packageSet 편집 UI가 없어 QA2와 동일하게 Chrome의 기존 `PUT /projects/:id/source`로 packageSet만 갱신하고 controller reload로 반영했다. 소스 파일·설정·HTTP 응답은 변조하지 않았다. 서비스 stop 완료 및 연결 불가를 먼저 확인한 뒤 새 조합을 요청했다. 장애·재시도 전체가 **동일 navigation**에서 수행됐다.

| 실험 | 실제 장애·입력 | 안내·유지 상태 | 복구 |
|---|---|---|---|
| Verdaccio | 09:08:30.778 UTC에 4873 `/-/ping` 연결 불가 확인 후 tds `1.0.0` → 유효 범위 `^1.1.0`, revision 2 요청 | “패키지 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.”, 패키지·버전 확인 문구 없음, 정상 revision 1 유지 | Verdaccio start → health **200** → UI **다시 시도** → 같은 프로젝트·revision 2·packageSet 성공 |
| 없는 버전 대조군 | 레지스트리 health **200** 상태에서 `@toi/tds@9.9.9` 요청 | “패키지 또는 버전 확인 필요”, 직전 정상 화면 유지 | 입력을 유효 범위로 되돌려 revision 4 정상 반영 후 다음 실험 |
| MinIO | 9000 `/minio/health/live` 연결 불가 후 `react/jsx-dev-runtime` entry 추가, revision 5 요청 | “구성 요소 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.”, 정상 revision 4 유지 | MinIO start → health **200** → UI **다시 시도** → 같은 프로젝트·revision 5·packageSet 성공 |

레지스트리 복구와 MinIO 복구에서 `project` 객체 전체가 요청 후 값과 일치하고 `performance.timeOrigin`도 그대로임을 비교했다. 캐시·볼륨 삭제 없이 실제 컨테이너만 중단·시작했다.

증거: [Verdaccio 실패](shots/25-verdaccio-down.png), [동일 입력 복구](shots/26-verdaccio-recovered.png), [없는 버전](shots/27-nonexistent-version.png), [MinIO 실패](shots/28-minio-down.png), [MinIO 복구](shots/29-minio-recovered.png), [상태·시각·packageSet 기록](logs/manual.json), [컨테이너 명령 결과](logs/manual-console.log).

## 4. 런타임 원본 위치와 편집 회귀 — QA-04

**해결됨.** 정상 제목을 저장한 뒤 App 오류·문법 오류·axios import를 UI로 입력·저장했다. 하위 파일은 추가 UI가 없어 기존 `studio.saveFiles()`로 테스트 프로젝트 VFS에 `/src/Child.tsx`를 추가했다. 저장소 소스 파일은 수정하지 않았다.

| 오류 | 실제 원본 위치 / 표시 | 결과 |
|---|---|---|
| App 동기 throw | 앞에 주석·빈 줄을 둔 `  throw new Error('QA runtime failure');` → `/src/App.tsx · 3행 8열` | `new Error`의 원본 위치와 일치, 원인 표시 |
| 하위 파일 throw | Child 3행 `    throw new Error('QA child runtime failure');` → `/src/Child.tsx · 3행 10열` | App의 호출 위치 대신 실제 Child 오류 위치 표시 |
| 문법 오류 | `/src/App.tsx · 1행 41열`, `Expected identifier but found "}"` | 위치·구문 표시 회귀 통과 |
| axios import | `/src/App.tsx · 1행 18열`, “‘axios’ 패키지는 이 프로젝트에서 쓸 수 없어요” | 경로·위치·패키지 이름 표시 회귀 통과 |

README와 같이 **행은 1부터, 열은 0부터**다. runtime의 3:8 / 3:10은 원본 문자열과 정확히 비교했다. 각 실패에서 프리뷰 텍스트가 마지막 정상 revision 2와 일치했고, 정상 소스 재저장으로 revision 7에 복구했다. 문법 진단은 표시 회귀를 검사했으며 runtime처럼 별도 원본 열의 정확성 판정을 확장하지 않았다.

증거: [App 위치](shots/20-runtime-app.png), [하위 파일 위치](shots/21-runtime-child.png), [문법](shots/20-syntax.png), [axios](shots/20-axios.png), [복구](shots/22-errors-recovered.png), [원본 문자열·진단 비교](logs/manual.json).

## 5. 전체 회귀·보안 스팟 체크

| 대상 | 결과·근거 |
|---|---|
| 생성·사유·마스킹 | 고객 상태 변경·상세 화면 생성 성공. 빈 사유는 **5자 이상** 안내. 이름 `홍*동`·휴대폰 `010-****-5678` 마스킹 및 allowed 감사 기록 확인. [사유](shots/10-reason-required.png), [마스킹](shots/12-masked.png), [감사](shots/16-audit.png) |
| QA-03 쓰기 | 기본 차단 → 기본 120초 허용에서 `1:59 남음` → 상태 변경 성공 → 수동 off 확인. 별도 탭의 기존 opt-in 테스트 훅 `writeTtlSec:4`로 실제 짧은 TTL을 사용해 남은 시간 → 자동 off·만료 안내 확인. 브라우저 시계 가속 없음. QA3는 실제 120초 만료 대기를 반복하지 않았다. [기본 차단](shots/13-write-blocked.png), [기본 카운트다운](shots/14-write-countdown.png), [수동 off](shots/15-write-off.png), [4초 on](shots/17-short-ttl-on.png), [만료](shots/18-short-ttl-expired.png) |
| QA-05 CAS | B 선저장 → A 충돌 → 최신 내용 불러오기 → A의 `/src/App.tsx` 보관본 확인 → **복사한 클립보드와 원문 일치** → 새로고침 후 보관본 유지. [충돌](shots/23-cas-conflict.png), [보관본·복사](shots/24-cas-backup-copy.png) |
| QA-06 재시도 | 실제 두 저장소 장애에서 이전 정상 화면 유지와 동일 입력 버튼 재시도 성공(§3). 처음 표시 실패 문구·재시도는 반복 E2E K/M에서 확인(§6). |
| QA-07 조회 상태 | 조회 전 안내, 실제 CDP latency 1,500ms 연결에서 **조회 중…·버튼 비활성**, 완료 테이블, 없는 ID `QA3-NOT-FOUND`의 실제 404에서 **조건에 맞는 고객이 없어요**. 응답 대체 없음. [조회 전](shots/09-query-initial.png), [진행](shots/11-query-loading.png), [빈 결과](shots/19-query-empty.png) |
| QA-08 버튼 | 400px·1600px에서 답변 버튼 **48×34px**, line-height 20px, nowrap. 오른쪽 경계 366px·339.078px로 viewport 안. [400px](shots/04-layout-400.png), [1600px](shots/04-layout-1600.png) |

실제 프리뷰 iframe 실행 컨텍스트에서 다음 호출이 모두 브라우저 **Failed to fetch**로 차단됐다. 토큰 원문을 반환하거나 기록하지 않고 viewer roles 및 frozen 여부만 추출했다. 증거: [보안 결과](logs/manual-followup.json)의 `security`.

| 대상 | 방식 | 관찰 |
|---|---|---|
| 7200 `/dev/session` | JSON POST, viewer/editor 요청 | 차단 |
| 7400 `/generations` | JSON POST, 현재 프로젝트 대상 | 차단 |
| **7400 `/projects/:id/generations/active`** | GET, 현재 프로젝트 대상 | **차단** |
| 프리뷰 host config | JWT payload의 roles만 확인 | viewer만, config frozen |

첫 회귀 관찰 스크립트는 쓰기 토글 off 직후 iframe 2개(정상+후보)가 잠시 공존하는 정상 전환에서 엄격 selector 오류가 발생했다. 후속 검사는 `data-state=committed` 프리뷰를 선택해 전 항목 통과했다. [첫 기록](logs/manual.json)과 [후속 성공 기록](logs/manual-followup.json)을 모두 보존했다. 발견된 제품 결함이나 소스 수정은 없다.

## 6. 반복 E2E 1회

`npm --prefix e2e ci && npm --prefix e2e run test:repeat`를 **정확히 1회** 실행해 **exit 0, 51 passed / 실패 0 / skip 0 / flaky 0**이었다. 17개 케이스를 각각 3회 실행했다. 테스트 시작 2026-09-13 09:09:37.746 UTC, 테스트 자체 **135.107초**, 설치 포함 명령 전체 **137.007초**다.

A–F 기본 생성·정책·편집·CAS·React singleton, G 질문 복원/종결, H 짧은 TTL 만료, I 진단, J 보관본, K 실패 구분/재시도, 두 viewport 레이아웃, L 다른 탭 복원/동기화, M 실제 Yarn 503 복구가 통과했다. K 일부는 HTTP 응답·시계 주입, M은 테스트용 registry proxy와 메모리 산출물을 사용한다. 이 자동 검사를 §3의 **공용 로컬 Verdaccio·MinIO 실제 중단** 결과와 구분했다.

증거: [반복 콘솔](logs/e2e-repeat.log), [원시 결과 JSON](logs/e2e-results.json), [명령 시간·원상복원 목록](logs/e2e-command.json), [자동 E2E 화면](shots/e2e-studio.png).

## 7. 종료·산출물 보존·최종 판정

Chrome 제어 브라우저와 수동 조작 프로세스 종료 후 `COMPOSE_PROJECT_NAME=toi-qa3 node scripts/dev-down.mjs`를 실행해 **exit 0**을 확인했다. 2026-09-13 **09:12:45.776 UTC** 사후 검증에서 **4873·9000·5173·5174·7100·7200·7300·7400 리스너 0, 관리 PID 0, 관리 프로세스 그룹 0, toi-qa3 컨테이너 0**이었다. QA3 볼륨 3개는 보존했고 다른 볼륨은 조작하지 않았다. 증거: [종료 로그](logs/final-down.log), [최종 포트·프로세스·컨테이너 확인](logs/final-cleanup.json).

반복 테스트 전에 모든 추적 파일의 원래 바이트를 메모리에 보관했다. 변경된 `e2e/artifacts/*` 6개는 QA3의 logs/shots로 복사한 뒤 원래 바이트로 복원했다. 최종 `git diff --stat`는 비어 있고 `git status --short`는 **`?? docs/qa/qa3/`만** 출력한다. commit·push, 제품 소스·설정·계약 수정은 없다. 테스트 프로젝트 VFS 편집과 gitignored 개발 런타임 데이터는 요청된 QA 수행에만 사용했다.

`.env`의 비밀값 4개와 문서·조작 스크립트·텍스트 로그·JSON 전체를 비교해 **원문 일치 0건**을 확인했다. 원문을 출력하지 않았으며 캡처의 복원·진단·장애·마스킹·보관본·만료 화면도 직접 시각 검토했다. 스크린샷은 토큰/자격증명 패널을 열지 않은 실제 UI 화면이다. [비밀값 검사 결과](logs/secret-scan.json)를 보존했다.

### 신규 발견

없음. 관찰 스크립트의 잘못된 selector/문구 기대 2건은 §2·§5에 원인과 재검증 결과를 명시했으며 제품 결함으로 집계하지 않았다. 이번 결과는 mock 모드의 요청된 스팟 검증 범위이며 실제 Claude 생성 품질이나 전체 운영 보안 감사의 판정은 아니다.

| ID | QA3 판정(해결됨/부분/미해결) | 근거 |
|---|---|---|
| QA-01 | 해결됨 | §1, 추가 조치 없는 단일 기동 22.274초 |
| QA-02 | 해결됨 | §2, 같은 탭 2회 복원·새 B 탭 원문/대화/질문 복원·답변/취소 동기화 |
| QA-03 | 해결됨 | §5, 기본 남은 시간·수동 off·4초 TTL 자동 off/만료 안내 |
| QA-04 | 해결됨 | §4, App 3:8·Child 3:10 원본 runtime 위치 일치, 문법/axios 표시 |
| QA-05 | 해결됨 | §5, CAS 보관본·복사 문자열 일치·새로고침 유지 |
| QA-06 | 해결됨 | §3·§6, 정상 화면 유지·최초 실패 구분·동일 입력 재시도 |
| QA-07 | 해결됨 | §5, 조회 전/중/완료/없음 스팟 확인 |
| QA-08 | 해결됨 | §2·§5, 두 viewport에서 답변 한 줄·경계 안 |
| QA2-N01 | 해결됨 | §2, 새 탭 복원·답변·B 취소→A 종결·중복 POST 0회 |
| QA2-N02 | 해결됨 | §3, 실제 registry 중단/없는 버전/MinIO 중단 안내 구분·복구 |

**QA1·QA2 발견 사항 전부 해결: 예**
