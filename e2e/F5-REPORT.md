# F5 — QA4 잔여 발견 수정

2026-09-14(KST) 최종 검증: **41개 시나리오 × 3회 = 123개 통과, 실패·skip·flaky 0건**. Q4-N02·N03·D02·D03·D04를 수정했다. `contracts/`, policy-proxy 서버 코드, `docs/qa/**`, `docs/review/**`, `evals/**`는 변경하지 않았다. git commit은 만들지 않았다.

## 동작 변경

- 정책 응답의 404와 JSON body의 `code`/`error`가 `PROJECT_NOT_FOUND`인 경우만 브로커 멤버십 거부로 분류한다. 일반 upstream 리소스 404는 기존 빈 결과 처리를 유지한다.
- 접근 거부 시 스튜디오는 iframe·브로커·세션·진행 중 생성 구독을 종료하고 편집·생성·저장·쓰기 UI를 잠근다. 프로젝트 존재를 구분하지 않는 안내를 표시한다: “이 프로젝트에 접근할 수 없어요. 멤버에서 제거되었거나 권한이 바뀌었을 수 있어요”. 생성·저장·멤버십 사용자 API의 404도 같은 상태가 된다. 활성 생성이 없다는 명시적 404는 정상적인 비활성 상태로 유지한다.
- 프로젝트를 연 동안 30초마다, 창 포커스가 돌아올 때 멤버십을 확인한다. 중복 확인을 합치고, 프로젝트 전환 뒤 늦은 멤버십 응답은 무시하며, 종료 시 타이머와 이벤트 리스너를 제거한다.
- `@toi/fetch@1.1.1`을 임시 Verdaccio에 게시하고 기본 packageSet을 맞췄다. `ToiAccessRevokedError`는 status 404와 code `PROJECT_NOT_FOUND`를 가지며 mock 생성 코드와 시스템 프롬프트는 이를 조회 오류로 표시한다.
- viewer 다운로드 패널에 editor 이상 권한이 필요한 이유를 표시하고 비활성 버튼의 `aria-describedby`에 연결했다. 상단 viewer 문구도 다운로드 제한을 포함한다.
- 비밀번호 패널과 policy-proxy README는 AES-256 ZIP을 macOS 기본 도구로 열 수 없으며 7-Zip, Keka 또는 `7z x`가 필요하다고 안내한다. 안내에 외부 링크는 없다.

코디네이터 확인으로 복귀 버튼은 **“처음 화면으로”**로 구현했다. 현재 저장소의 루트는 프로젝트 생성 화면이고 목록 API·UI가 없으므로 새 목록 UI는 추가하지 않았다. 이동 시 해당 프로젝트의 sessionStorage 생성 복구와 편집 보관본을 지우며 다른 프로젝트 데이터는 유지한다.

## 수정 전후 캡처

| 발견 | 수정 전(QA4 원본) | 수정 후(F5 실제 Chrome) |
|---|---|---|
| 제거된 멤버가 빈 고객 결과를 봄 | [제거 후 잘못된 안내](../docs/qa/qa4/shots/13-bob-removed-observed.png) | [브로커 조회 후 접근 불가·잠금](artifacts/f5/shots/removed-member-after.png) |
| 프리뷰 요청 없이 제거 감지 | 해당 없음 | [30초 주기 확인 후 접근 불가](artifacts/f5/shots/removed-member-periodic-after.png) |
| viewer 다운로드 비활성 이유 없음 | [viewer 다운로드](../docs/qa/qa4/shots/11-viewer-download.png) | [역할 안내와 비활성 버튼](artifacts/f5/shots/viewer-download-after.png) |

수정 전 캡처는 제공된 당시 기록이며 새로 재현했다고 주장하지 않는다. 수정 후 캡처를 직접 열어 안내·빈 프리뷰·잠긴 컨트롤·viewer 설명의 표시를 확인했다. 비밀번호나 인증 토큰은 캡처하지 않았다.

## 문서 변경 목록

| 문서 | 수정 내용 |
|---|---|
| [루트 README](../README.md) | 프로젝트별 origin, 자격 증명 없는 frame 브로커, `connect-src 'none'`, script `data:` 제거, 멤버십 확인·접근 철회와 E2E 범위 |
| [Studio README](../apps/studio/README.md) | 첫 문단의 공유 origin 제거, 새 404 안내, 주기 확인, 다운로드 역할·aria 설명 |
| [agent-server README](../services/agent-server/README.md) | frame 설정의 토큰 필드 제거, 부모 브로커와 reason 전달, 1.1.1 오류 타입 |
| [policy-proxy README](../services/policy-proxy/README.md) | frame 직접 통신 거부와 Studio Origin, 토큰 보관 위치, AES ZIP 도구, 404 오류 타입 |
| [TOSS-GAP](../docs/compare/TOSS-GAP.md) | 코디네이터 승인에 따라 당시 비교 표는 보존하고 표 아래에 “preview write 부작용” 행의 이후 변경 주석만 추가 |

과거 QA·review·`*-REPORT.md` 원문은 수정하지 않았다.

## 검증

| 검사 | 결과 |
|---|---|
| Studio typecheck / 단위 테스트 | 통과 / 25개 통과 |
| preview-runtime typecheck / 단위 테스트 | 통과 / 43개 통과 |
| preview-runtime 실제 Chrome 테스트 | 26개 통과 |
| agent-server typecheck / 테스트 | 통과 / 125개 통과, 기존 선택적 실제 Claude 1개 skip |
| N·O·AI·AJ 선행 E2E | 4개 통과 |
| V·다운로드 UI 선행 E2E | 2개 통과 |
| G의 생성 기록 404 안내 | 수정 후 선행 1개 통과 |
| 전체 41개 × 3회 | **123개 통과**, 실패·skip·flaky 0, 584.6초 |
| toi-f5 종료·9개 포트 확인 | 컨테이너·볼륨·네트워크 0개, 9개 서비스 포트 및 MinIO 콘솔 9001 모두 비어 있음 |

V는 정책 서버의 실제 `TOI_POLICY_DATA_DIR`를 따르도록 고쳐 임시 환경에서도 암호문·wrapped key 삭제 검증을 유지했다. 다운로드 UI 검사에는 macOS·7-Zip·Keka·`7z x` 안내 확인을 추가했다.

AI는 두 bob 탭을 열어 하나는 제거 직후 실제 proxy 404를 확인하고, 다른 하나는 preview 요청 **0건**인 채 실제 30초 멤버십 확인으로 접근 거부를 확인한다. 두 탭 모두 iframe 제거와 편집·생성·저장·쓰기 잠금을 확인한다. AJ는 실제 viewer 패널의 설명 표시·비활성 버튼·접근 가능한 설명과 연결된 DOM 요소를 확인한다. N의 404 안내 기대값을 변경했고 O의 기존 역할·제거 시나리오는 그대로 통과했다.

증거: [Studio](artifacts/f5/logs/studio-test.log), [preview 단위 검사 및 초기 브라우저 실행](artifacts/f5/logs/preview-initial-test.log), [최종 preview 브라우저](artifacts/f5/logs/preview-browser-test.log), [agent-server](artifacts/f5/logs/agent-test.log), [선행 E2E](artifacts/f5/logs/targeted-e2e.log), [전체 3회 로그](artifacts/f5/logs/e2e-repeat.log), [결과 요약](artifacts/f5/results-summary.json), [Playwright 원본 JSON](artifacts/results.json).

## 환경과 초기 검증 실패

모든 Docker 기동·종료는 `COMPOSE_PROJECT_NAME=toi-f5`만 사용했다. 최초 기동은 이전 registry 토큰이 새 Verdaccio에서 거부돼 실패했다. `.env`를 0600 임시 파일로 백업하고 이 임시 환경의 토큰을 발급해 [1.1.1 게시와 기동](artifacts/f5/logs/dev-up-publish.log)을 완료했다.

처음 선행 E2E에서는 기존 로컬 감사 기록과 새 MinIO 볼륨이 불일치하여 정책 서버가 503으로 차단했다. 서버 검사나 감사 체인을 우회하지 않고 임시 전용 `TOI_POLICY_DATA_DIR`·`DATA_DIR`를 사용해 재기동했고 audit health가 정상임을 확인한 뒤 재검증했다. 새 E2E에서 OIDC 리다이렉트 도중 snapshot을 읽던 대기 조건도 로그인 완료 뒤로 고쳤다. [격리 데이터로 재기동](artifacts/f5/logs/dev-up-isolated.log).

preview 브라우저 첫 실행의 1개 실패는 기존 request fixture가 아직 내려가 있던 Studio 5173으로 HTTP 요청을 보내 생긴 연결 거부였다. 앱 기동 후 동일 테스트 26개가 모두 통과했다. 나머지 브라우저 fixture는 5273/5274에서 동작한다.

전체 반복 첫 시도에서 V가 고정된 이전 로컬 데이터 경로를 읽어 실패해 실행을 중단했다. 서버 동작은 바꾸지 않고 E2E 경로를 실제 설정에 맞췄으며, V와 다운로드 UI를 선행 확인한 뒤 전체 반복을 처음부터 다시 실행했다. `.env`는 기존 E2E 인증 헬퍼가 비공개 객체로 읽으므로 같은 헬퍼에서 데이터 경로 설정만 export해 사용한다.

첫 완료된 전체 반복은 **120개 통과·G의 이전 404 안내 기대값 3개 실패**였다. G는 실제 종료된 생성의 복구·취소 검증을 유지하면서, 존재하지 않는 생성 스트림의 404에는 통일된 접근 거부·잠금과 처음 화면 복귀 후 복구 데이터 제거를 기대하도록 변경했다. 진행 중 tail 로그만 보고 반복 전체가 통과했다고 알린 상태 보고는 이 결과로 정정한다.


## 최종 정리

`COMPOSE_PROJECT_NAME=toi-f5 node scripts/dev-down.mjs --volumes`는 exit 0으로 완료됐다. 프로젝트 label로 조회한 컨테이너·볼륨·네트워크는 모두 0개다. 4873·5173·5174·7100·7200·7300·7400·8080·9000의 9개 서비스 포트와 MinIO 콘솔 9001에도 LISTEN 프로세스가 없다. 다른 Compose 프로젝트의 자원을 종료하거나 삭제하지 않았다.

registry/data 설정 변경 전 비공개 `.env` 백업을 복원하고 바이트 일치를 확인했으며 mode 0600을 유지했다. 임시 서비스 데이터 디렉터리와 환경 백업 파일을 제거했다. 근거: [종료 로그](artifacts/f5/logs/dev-down.log), [자원·포트·환경 복원 검사](artifacts/f5/cleanup.json).

최종 전체 반복의 JSON을 파일·행·시나리오별로 집계해 **고유 시나리오 41개가 각각 3회 통과**했음을 확인했다. worker 0·1·2는 각 41개 통과했고 실패·flaky·skip은 0이다. 남은 작업은 없다.
