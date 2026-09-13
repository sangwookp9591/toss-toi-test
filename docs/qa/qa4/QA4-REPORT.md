# QA4 — 새 클론 P0 실사용 검증

2026-09-13 KST, `/Users/psw/Projects/toi-lite-qa4`, 시스템 Chrome 153.0.8010.36, mock 에이전트. 최초 HEAD `042c2a3`에서 기동 결함을 발견했고, 코디네이터 지시에 따라 `git pull --ff-only` 1회로 main `92469f1`을 받은 뒤 처음부터 재검증했다. 최초 실패 증거는 보존했다. 소스·설정·계약을 직접 수정하거나 commit·push하지 않았다.

수동 항목은 **실제 headed Chrome에서 버튼·입력·역할 선택 UI를 조작**했다. DevTools 실행 컨텍스트에 해당하는 Playwright frame evaluate로 격리 설정·fetch·navigation을 검사했다. alice 본인 승인 HTTP 거부, 감사 verify·retention, registry 장애용 packageSet 변경만 기존 API 또는 로컬 도구로 보완했다. 테스트 사용자 비밀번호는 클론 `.env`에서 메모리로 읽었고 로그인 입력 화면을 캡처하지 않았다. 아래 표의 `부분`은 서버 보안 거부는 동작하지만 요청한 사용자 안내가 불완전한 경우다.

## 1. 기동

| 실행 | 결과 |
|---|---|
| 최초 `042c2a3` | 지정 포트 9개 비어 있음 확인 후 준비 없이 `COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-up.mjs` 실행. **10.448초, exit 1**, Keycloak provisioning 실패. Docker child가 프로젝트명을 누락하여 `toi-lite` 컨테이너 4개와 기존 볼륨을 사용했다(Q4-N01). |
| 수정 후 `92469f1` | 코디네이터가 잘못 생성된 컨테이너만 정리하고 원본 볼륨을 보존. 허가받은 `.env`·`scripts/.run` 초기화 후 포트 9개 부재를 재확인하고 같은 한 줄 실행. **41.095초, exit 0**, 추가 조치 없이 전체 서비스 준비. |
| 격리 | 시작 로그 `Docker Compose project: toi-qa4`; 새 컨테이너 4개·named volume 4개 모두 `toi-qa4`. `toi-lite` 컨테이너는 0이며 원본 볼륨 inspect 메타데이터는 전후 동일. |
| 환경·발견성 | 새 `.env` **0600**. README만으로 alice 로그인 주소와 `TOI_PASSWORD_ALICE` 확인 위치를 찾았고 실제 로그인 성공. 앱 프로세스 `AGENT_MODE=mock` 확인; 로컬 모델·Claude 키 미사용. |

근거: [최초 로그](logs/cold-start.log), [최초 Docker/env 증거](logs/bootstrap-evidence.json), [기존 볼륨](logs/volume-observation.json), [수정 후 로그](logs/cold-start-retest.log), [수정 후 자원 비교](logs/retest-startup.json), [재검증 전 상태](logs/retest-before.json). [최초 연결 거부](shots/01-studio-unavailable.png)는 headless Chrome 보조 캡처이며 이후 실제 UI 검사와 구분한다. npm이 취약성 경고를 출력했으나 이번 QA에서 의존성을 변경하지 않았다.

## 2. 식별·멤버십·승인

alice가 프로젝트를 만들고 고객 상태 변경 화면을 생성·답변·저장하여 revision 3까지 반영했다. 로그아웃 후 새로고침에서도 로그인 화면이 나타났고 무한 리다이렉트가 없었다. carol이 alice 프로젝트 URL을 직접 열면 “프로젝트를 찾을 수 없거나 멤버가 아니에요”와 프리뷰 0개를 확인했다.

alice가 bob을 viewer로 추가하면 프리뷰는 열리고 생성·소스·쓰기 입력은 비활성화되며 편집자 이상 권한 안내가 표시됐다. editor 승격 후 bob이 UI에서 생성·답변하여 revision 4를 커밋했다. 다시 viewer로 추가해 제거 시각부터 재측정했을 때 **278ms에 첫 proxy 요청 404**로 거부돼 5초 조건은 충족했다. 다만 남아 있는 프리뷰는 이를 **“조건에 맞는 고객이 없어요”**로 표시해 접근 거부 안내가 잘못됐다(Q4-N02).

alice가 live 승인 요청을 만들면 본인 UI에는 승인 버튼이 없고, 같은 alice로 decision API를 요청하면 **403 FOUR_EYES_REQUIRED**다. dana는 실제 로그인 후 프로젝트 ID로 요청을 조회해 승인했으며, alice의 **승인 상태 새로고침**을 누르면 “승인됨”이 반영됐다. 자동 polling으로 반영된 것으로 주장하지 않는다.

근거: [alice 저장](shots/07-generated-saved.png), [로그아웃·새로고침](shots/08-logout-refresh.png), [carol 거부](shots/09-carol-denied.png), [bob viewer](shots/10-bob-viewer.png), [bob editor 생성](shots/12-bob-editor-generated.png), [제거 후 잘못된 안내](shots/13-bob-removed-observed.png), [본인 요청 대기](shots/14-alice-approval-pending.png), [dana 승인](shots/15-dana-approved.png), [alice 반영](shots/16-alice-approval-reflected.png), [수동 수치](logs/manual.json).

## 3. 프리뷰 격리·브로커

두 프로젝트의 frame origin은 아래처럼 서로 달랐다. frame 설정은 `env, projectId, transport` 세 키뿐이고 `transport=broker`, frozen=true였으며 토큰 키가 없었다. frame에서 `fetch('http://localhost:7200/healthz')`는 Failed to fetch로 차단됐다.

- `http://p-f1af5992-1c2c-47a3-9ee0-ba24ee65ed93.preview.localhost:5174`
- `http://p-284ca0de-7676-4784-84b1-48b003ec2e05.preview.localhost:5174`

실제 frame 콘솔에서 `location.href='http://127.0.0.1:53626/capture/?x=1'`을 실행했다. 로컬 수신 요청 **0**, 자격증명 유출 **0**이었고 “프리뷰가 외부로 이동하려 해서 차단했습니다” 안내와 원래 프로젝트 origin의 revision 1 화면 복구를 확인했다. 실제 자격증명은 프레임에 주입하지 않고 Node 메모리에만 보관했다. 최초 probe는 Locator.evaluate의 element 인자를 누락해 잘못된 URL을 만들었으며, 수정된 probe의 실제 navigation 결과만 판정했다.

브로커 조회는 빈 사유에 “조회 사유를 5자 이상 입력하세요”를 표시했다. 사유 입력 후 이름 `홍*동`, 휴대폰 `010-****-5678` 등 마스킹된 고객 목록이 표시됐다. 쓰기 토글 off에서 권한 거부, on에서 “상태를 정지로 바꿨어요”를 확인했다. 기본 **120초 TTL**을 실제 시간으로 경과시켜 토글 off 및 만료 안내를 확인했다. 시계 가속·짧은 TTL 주입은 수동 검증에 사용하지 않았다.

5174의 `Host: invalid.localhost:5174` 요청은 **421**이었다. 별도 로컬 origin의 HTML에서 Studio iframe을 열면 CSP frame-ancestors 오류와 `chrome-error://chromewebdata/`가 관측됐고 Studio는 렌더링되지 않았다.

근거: [사유](shots/17-reason-required.png), [마스킹](shots/18-masked-broker.png), [쓰기 거부](shots/19-write-denied.png), [쓰기 성공](shots/20-write-success.png), [navigation 복구](shots/21-preview-navigation-recovered.png), [외부 embedding 차단](shots/22-studio-embedding-blocked.png), [쓰기 만료](shots/25-write-expired-password-masked.png), [원시 판정](logs/manual.json).

## 4. 다운로드·감사

alice가 **CSV·XLSX 각각 20행 ZIP**을 UI에서 만들고 ZIP 저장 버튼으로 내려받았다. 32자 비밀번호는 한 번 표시됐고 닫으면 해당 output이 사라졌다. 캡처에서는 비밀번호를 마스킹했다. 같은 ZIP 저장 버튼 재사용과 별도로 만든 미사용 링크의 **60초 실제 만료 후 저장** 모두 “링크가 만료되었거나 이미 사용됐어요”로 거부됐다.

macOS 기본 `/usr/bin/unzip -t`는 **exit 81**, “need PK compat. v5.1 (can do v4.5)”로 AES ZIP을 지원하지 못했다. 7z/7zz는 설치돼 있지 않았다. Python `pyzipper`로 두 ZIP을 직접 열어 **암호화 bit=true, AES strength=3(256-bit), AE-2**를 확인했다. 비밀번호 없음·오답은 모두 거부됐으며 정상 비밀번호로 읽은 CSV 및 XLSX XML에는 마스킹된 이름·전화가 있고 원문 이름·전화는 없었다. 비밀번호는 Python stdin으로만 전달하고 평문 추출 파일은 남기지 않았다.

bob viewer는 충분한 다운로드 사유를 입력해도 생성 버튼이 비활성화돼 요청을 보낼 수 없었다. 다만 다운로드를 못 하는 이유를 설명하는 문구가 없다(Q4-N03). 서버 viewer 거부는 반복 E2E U의 별도 검사 범위다.

root 실제 로그인 후 `/audit/verify`는 **ok=true, anchorSeq=anchoredThrough=44**였다. 이후 작업을 추가하고 policy-proxy에 SIGTERM을 보내 정상 종료했다. 종료 직전 **lastSeq=57, replicationPending=25**, 종료 후 최신 원격 앵커 **seq=57**과 새 세그먼트 **33–57**을 확인했다. dev-down 없이 `COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-up.mjs --restart=policy-proxy`로 재기동한 뒤 **ok=true, anchorSeq=57, replicationPending=0**이었다. shutdown 로그에 별도 flush 문구는 없어 원격 객체·종료 후 health 불가·재시작 verify를 증거로 삼았다. 첫 종료의 head는 이미 앵커돼 있었으므로 E2E 후 별도 보강 검사를 했다. 일반 preview-session 기록을 append한 직후 **lastSeq=502, anchorSeq=501, replicationPending=182**를 읽고 즉시 SIGTERM을 보냈다. 종료 후 원격 앵커는 **seq=502**이며 직전 lastHash와 일치했다. 따라서 미반영 앵커의 실제 종료 flush도 직접 확인했다([보강 증거](logs/audit-final-flush.json)). 다시 정상 기동한 뒤 **verify ok, anchorSeq=502, replicationPending=0**이었다([최종 verify](logs/audit-final-verify.json), [재기동 로그](logs/policy-final-restart.log)).

MinIO `mc retention info` 및 S3 GetObjectRetention으로 실제 세그먼트·앵커의 **COMPLIANCE**, 다음 날까지의 RetainUntilDate를 확인했다. 감사 객체 삭제는 시도하지 않았다. dev-up 자체의 기존 임시 retention probe는 표준 기동 과정에서 실행된다.

근거: [CSV 비밀번호 가림](shots/23-download-csv-password-masked.png), [XLSX 가림](shots/23-download-xlsx-password-masked.png), [재사용 거부](shots/24-csv-link-reuse-denied.png), [60초 만료](shots/26-expired-download-masked.png), [viewer 다운로드](shots/11-viewer-download.png), [macOS unzip](logs/macos-unzip.log), [Python AES 검사](logs/zip-inspection.json), [종료 flush](logs/audit-stop.json), [재기동](logs/policy-restart.log), [mc retention](logs/mc-retention.log), [감사 응답](logs/manual.json). 암호화된 실제 파일: [CSV ZIP](logs/download-csv.zip), [XLSX ZIP](logs/download-xlsx.zip). 비밀번호는 보존하지 않는다.

## 5. env 격리 스팟

dev-up 관리 프로세스와 자식 20개의 `ps eww -p <pid> -o command=` 출력을 메모리에서 파싱하고 **키 이름만** 저장했다. mock-backend와 studio에는 세션·capability·KEK·Keycloak/client secret 키가 없었다. policy-proxy에는 필요한 세션·capability·다운로드 KEK·policy client 키가 있었고 agent-server에는 자기 client 키만 있었다. 실제 agent node 프로세스 3개 모두 `AGENT_MODE=mock`을 확인했다. npm launcher는 ps env가 비어 있는 경우가 있어 실제 하위 node 프로세스 관측으로 보완했다.

근거: [서비스별 키 이름](logs/service-env-keys.json). 환경 격리를 OS 사용자 권한·파일시스템 비밀 접근 차단으로 확대 해석하지 않는다.

## 6. 기존 기능 회귀 스팟

| 항목 | 실제 관찰 | 근거 |
|---|---|---|
| 역질문·새 탭 | A 질문을 새 B에서 복원, chats 정확 일치, B에서 아니요 답변 후 A revision 2 반영 | [질문](shots/04-question.png), [새 탭](shots/05-new-tab-restored.png) |
| 취소 | 질문 대기에서 생성 중단 → 입력 재활성화·중단 안내·정상 revision 4 유지 | [취소](shots/28-generation-canceled.png) |
| CAS | B 미저장 편집 후 A 선저장 → B 충돌 → 최신 불러오기 → 보관본 원문 일치, reload 후 유지 | [충돌](shots/29-cas-conflict.png), [보관본](shots/30-cas-backup.png) |
| 레지스트리 중단 | QA4 Verdaccio만 stop, 4873 연결 불가 후 새 유효 packageSet(`@toi/tds=^1.1.0`) 요청 → 연결 장애 안내·revision 7 유지 | [중단](shots/32-registry-down.png), [stop 로그](logs/registry-stop.log) |
| 레지스트리 재시도 | QA4 Verdaccio start·health 성공 후 UI 다시 시도 → 같은 navigation·packageSet·revision 8 성공 | [복구](shots/33-registry-recovered.png), [start 로그](logs/registry-start.log) |
| runtime 위치 | App 원본 3행 `  throw new Error(...)`에 **/src/App.tsx · 3행 8열**, 마지막 정상 revision 5 유지 | [진단](shots/31-runtime-location.png) |
| 400px | 답변 버튼 48×34px, x=318/right=366으로 화면 안·한 줄, 패널 세로 배치 | [400px](shots/06-layout-400.png) |

기존 API를 통한 packageSet 변경은 테스트 프로젝트 VFS만 변경했다. Git 소스 파일은 수정하지 않았고 registry 응답을 모의 대체하지 않았다. 세부 수치·원문 위치·동일성 비교는 [manual.json](logs/manual.json)에 있다.

## 7. 스크립트

다음 전체 명령을 **정확히 1회** 실행해 완료했다. 수동 검증은 기본 승인 TTL 상태에서 마쳤고 이 단계에서만 --e2e가 승인 TTL 8초를 적용했다.

```sh
npm --prefix e2e ci && COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-up.mjs --e2e && npm --prefix e2e run test:repeat
```

**117 passed, failed 0, skipped 0, flaky 0**, 39개 시나리오를 각각 3회 통과했다. 테스트 시작 2026-09-13 14:29:54.998 UTC, 테스트 자체 **485.745초(8.1분)**, 설치·--e2e 기동 포함 전체 명령 **509.026초**, exit 0이다. [콘솔](logs/e2e-repeat.log), [결과 요약](logs/e2e-summary.json), [원시 JSON](logs/e2e-artifacts/e2e/artifacts/results.json), [실행·복원 목록](logs/e2e-command.json), [래퍼](run-repeat.py). 반복 전 모든 추적 파일의 원래 바이트를 메모리에 보관했다. 달라진 추적 산출물 5개는 QA4로 복사한 뒤 원상복원했고 git diff는 비어 있다. 수동 Chrome·로컬 수신기는 E2E 전에 닫았다. E2E의 일부 장애 검사는 응답·시계 주입을 사용하며, §6의 실제 QA4 registry 중단 검사와 구분한다. 다운로드 U의 viewer API 거부와 W의 audit 검증도 3회씩 통과했다.

## 8. 종료·산출물 보존

`COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-down.mjs`는 **exit 0**으로 종료했고 기본 동작은 QA4 named volume 4개를 보존했다. 이어 `COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-down.mjs --volumes`도 **exit 0**으로 COMPLIANCE 감사 객체가 들어 있던 QA4 볼륨 4개를 모두 제거했다. **S3 COMPLIANCE는 Docker 볼륨 자체 삭제를 막지 않았다.** 감사 객체의 S3 삭제는 시도하지 않았다.

2026-09-13 **14:40:28.881 UTC** 최종 확인에서 **포트 9개 LISTEN 0, 알려진 서비스 PID 0, 관리 프로세스 그룹 구성원 0, QA4 컨테이너 0, QA4 볼륨 0**이다. 수동 Chrome·로컬 수신기와 후속 감사 확인용 Chrome도 닫았다. `toi-lite` 컨테이너 0, 원본 볼륨 메타데이터는 재검증 전후 동일하다. [기본 종료](logs/final-down.log), [기본 down 후 보존 볼륨](logs/volumes-after-default-down.log), [볼륨 삭제](logs/final-down-volumes.log), [최종 잔존 검사](logs/final-cleanup.json).

E2E가 바꾼 추적 파일 5개는 `logs/e2e-artifacts/`에 복사한 뒤 원래 바이트로 복원했다. 최종 `git diff --stat`는 비어 있고 `git status --short`는 `?? docs/qa/qa4/`만 표시한다. 임시 Python ZIP 라이브러리는 제거했고 재현용 검사 코드와 설치 로그만 보존했다.

비밀값 처리 한계: 자동화에서 모호한 `role=status` selector가 실패하며 **이미 만료된 미사용 ZIP 비밀번호 1개가 일시 tool 오류 출력에 포함되는 절차상 실수**가 있었다. 해당 패널을 즉시 닫고 값을 보고서·캡처·durable 로그에 복사하지 않았으며 이후 구체적인 `p[role=status]`를 사용했다. `.env` 테스트 계정 비밀번호·키는 노출되지 않았다. 따라서 전체 실행에서 비밀값 출력이 전혀 없었다고 주장하지 않는다. 첫 부트스트랩 단계의 보고서·로그 `.env` 원문 검사 0건은 [초기 검사](logs/secret-scan.json)에 있고, 최종 산출물의 비밀 원문 일치도 **0건**이다([최종 검사](logs/final-secret-scan.json)). 비밀번호가 보이는 6개 캡처는 가림 처리를 직접 시각 확인했다. 이 durable 산출물 검사 결과는 앞서 밝힌 일시 tool 출력 사고를 부정하지 않는다.

## 판정표

| ID | 영역 | 판정(통과/부분/실패) | 근거(캡처·로그 경로) |
|---|---|---|---|
| Q4-01 | alice 로그인·생성·저장 | 통과 | [저장](shots/07-generated-saved.png), logs/manual.json |
| Q4-02 | 로그아웃·새로고침·리다이렉트 | 통과 | [로그인 복귀](shots/08-logout-refresh.png) |
| Q4-03 | carol URL 직접 입력·존재 비노출 | 통과 | [거부](shots/09-carol-denied.png) |
| Q4-04 | bob viewer 프리뷰·생성/저장 제한 | 통과 | [viewer](shots/10-bob-viewer.png) |
| Q4-05 | bob editor 승격·생성 | 통과 | [생성](shots/12-bob-editor-generated.png) |
| Q4-06 | bob 제거·5초 이내 접근 거부 | 부분 | 278ms/404는 통과, [잘못된 안내](shots/13-bob-removed-observed.png) |
| Q4-07 | alice live 요청·본인 승인 불가 | 통과 | [대기](shots/14-alice-approval-pending.png), manual.json 403 |
| Q4-08 | dana 승인·alice 반영 | 통과 | [반영](shots/16-alice-approval-reflected.png) |
| Q4-09 | 두 프로젝트 iframe origin 분리 | 통과 | logs/manual.json Q4-09 |
| Q4-10 | frame config 토큰 없음 | 통과 | logs/manual.json Q4-10 |
| Q4-11 | 직접 policy health fetch 차단 | 통과 | logs/manual.json Q4-11 |
| Q4-12 | local navigation·안내/복구·토큰 부재 | 통과 | [복구](shots/21-preview-navigation-recovered.png), 요청 0 |
| Q4-13 | broker 목록·마스킹·사유 | 통과 | [마스킹](shots/18-masked-broker.png) |
| Q4-14 | 쓰기 off 거부·on 성공·만료 off | 통과 | [성공](shots/20-write-success.png), [만료](shots/25-write-expired-password-masked.png) |
| Q4-15 | 잘못된 Host 421 | 통과 | logs/manual.json Q4-15 |
| Q4-16 | 다른 origin의 Studio iframe 차단 | 통과 | [차단](shots/22-studio-embedding-blocked.png) |
| Q4-17 | CSV/XLSX·비밀번호 1회 표시/닫기 | 통과 | [CSV 가림](shots/23-download-csv-password-masked.png), manual.json |
| Q4-18 | AES ZIP·암호 없음 거부·마스킹 | 통과 | [Python 검사](logs/zip-inspection.json), macOS unzip 미지원 |
| Q4-19 | 동일 링크 재사용 거부 | 통과 | [거부](shots/24-csv-link-reuse-denied.png) |
| Q4-20 | 60초 링크 만료 | 통과 | [거부](shots/26-expired-download-masked.png) |
| Q4-21 | viewer 다운로드 거부 문구 | 부분 | 버튼 비활성이나 [설명 없음](shots/11-viewer-download.png) |
| Q4-22 | root verify ok·anchorSeq | 통과 | logs/manual.json Q4-22, seq 44 |
| Q4-23 | 정상 재시작 verify·종료 flush | 통과 | [앵커 501→502 flush](logs/audit-final-flush.json), [재시작 verify](logs/audit-final-verify.json) |
| Q4-24 | 세그먼트·앵커 retention | 통과 | [mc](logs/mc-retention.log) |
| Q4-25 | ps eww 서비스 env 키 격리 | 통과 | [키 목록](logs/service-env-keys.json) |
| Q4-26 | 역질문 답변 | 통과 | [질문](shots/04-question.png), manual.json |
| Q4-27 | 새 탭 복원 | 통과 | [복원](shots/05-new-tab-restored.png) |
| Q4-28 | 취소 | 통과 | [중단](shots/28-generation-canceled.png) |
| Q4-29 | CAS 보관본 | 통과 | [보관본](shots/30-cas-backup.png) |
| Q4-30 | 실제 registry 중지·재시도 | 통과 | [실패](shots/32-registry-down.png), [복구](shots/33-registry-recovered.png) |
| Q4-31 | runtime 원본 오류 위치 | 통과 | [3행 8열](shots/31-runtime-location.png) |
| Q4-32 | 400px 레이아웃 | 통과 | [400px](shots/06-layout-400.png) |
| Q4-N01 | Compose 이름 누락 수정 후 재검증 | 통과 | [41.095초 기동](logs/cold-start-retest.log), [격리](logs/retest-startup.json) |

## 신규 발견

### Q4-N01 — high, 수정 후 재검증 통과: Compose 프로젝트명 누락

- 재현: 최초 `042c2a3`, 포트가 비어 있는 새 클론에서 `COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-up.mjs`.
- 기대: QA4 자원만 사용하고 한 줄로 준비.
- 실제: Docker child allowlist가 COMPOSE_PROJECT_NAME을 제거하여 `toi-lite` 컨테이너를 만들고 기존 `toi-lite_*` 볼륨을 연결, Keycloak 단계에서 실패. 기존 관리자 비밀번호 불일치가 실패 원인이라는 코디네이터 판단이다.
- 영향: 다른 프로젝트 볼륨 오염 위험. 워커는 다른 프로젝트 정리를 수행하지 않고 코디네이터에게 즉시 ask했다.
- 수정/재검증: 코디네이터가 정리·수정한 main `92469f1`을 받아 클론 임시 산출물을 초기화, 한 줄로 41.095초 성공. 시작 로그·Docker label·mount·기존 볼륨 메타데이터 비교로 격리를 확인했다.
- 근거: [최초 로그](logs/cold-start.log), [최초 자원](logs/bootstrap-evidence.json), [캡처](shots/01-studio-unavailable.png), [재검증](logs/retest-startup.json).

### Q4-N02 — medium, 미해결: 멤버 제거 404가 빈 고객 결과로 표시됨

- 재현: alice가 bob을 멤버로 추가, bob이 고객 상태 변경 프리뷰를 연 상태에서 alice가 bob 제거, bob 프리뷰에서 사유 입력 후 조회.
- 기대: 데이터 접근 거부와 멤버십/권한 확인 안내. 기존 프로젝트의 존재를 추가로 드러낼 필요는 없다.
- 실제: 제거 클릭 후 278ms에 proxy **404**로 차단되지만 프리뷰는 **“조건에 맞는 고객이 없어요”**, Studio는 기존 편집 UI와 정상 반영 상태를 유지한다.
- 영향: 접근 통제 우회는 없지만 제거된 사용자가 권한 문제를 검색 결과 없음으로 오인한다. 생성 mock 코드의 404 처리와 프로젝트 접근 안내 구분이 필요하다.
- 근거: [캡처](shots/13-bob-removed-observed.png), [manual Q4-06/Q4-06-recheck](logs/manual.json).

### Q4-N03 — low, 미해결: viewer 다운로드 비활성 이유 없음

- 재현: bob viewer로 프로젝트 열기 → 암호화 다운로드 → 5자 이상 사유 입력.
- 기대: 다운로드는 editor 이상 권한이 필요하다는 거부/권한 문구.
- 실제: “암호화 파일 만들기”는 계속 비활성화되지만 패널에는 설명이 없다. 상단 viewer 문구도 생성·저장·쓰기 테스트만 열거하고 다운로드는 언급하지 않는다.
- 영향: 보안 거부는 유지되지만 사용자가 비활성 원인을 알 수 없다.
- 근거: [캡처](shots/11-viewer-download.png), [manual Q4-21](logs/manual.json).

## 문서 결함

- **Q4-D01 — 최초 발견, 수정됨/오류 경로 재실측 없음:** README는 원인 요약을 약속했지만 최초 Keycloak 실패 로그는 `command failed; inspect the log`뿐이었다. F4는 해당 프로젝트 볼륨·자격증명 복구 명령을 출력하도록 수정했다. 이번 재기동은 정상 경로 성공이며 인증 오류를 다시 만들지는 않았다.
- **Q4-D02 — 미해결:** 루트 README 실행 설명은 viewer session/capability를 프리뷰에 전달한다고 적고 CSP 표는 `connect-src http://localhost:7200`, script `data:`를 허용한다고 적는다. 현재 F3-A/Studio README와 실제 frame 검사는 토큰 없는 broker, direct fetch 차단이다. 신규 사용자가 현재 보안 경계를 잘못 이해할 수 있다.
- **Q4-D03 — 미해결:** Studio README 첫 문단은 공유 `http://localhost:5174`를 프리뷰 origin으로 적지만 실제로는 프로젝트별 origin이다.
- **Q4-D04 — 안내 보완 필요:** macOS 기본 unzip으로 암호화 ZIP을 열 수 없었다. 다운로드 UI/README에 지원하는 AES ZIP 해제 도구 안내가 없으며 Python을 별도로 준비해야 했다.
- 로그인 계정·비밀번호 위치는 README에서 찾을 수 있었다. 기동 실패를 로그인 문서 누락으로 집계하지 않았다.

**P0 실사용 검증 통과: 아니오** — E2E 117개와 핵심 통제·최종 정리는 통과했지만, 제거된 멤버의 잘못된 안내와 viewer 다운로드 권한 설명 누락이 남았다.
