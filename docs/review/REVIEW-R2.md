# R2 수정 검증 리뷰 — R1 발견 사항 재확인

- 대상: `main` `d8b8bb0`(F1: C1·H1·H2·M1), `4f9b42c`(F2: M2·M3·벤치). 코드·설정·계약은 수정하지 않았다.
- 방법: 수정자 README·테스트 통과 보고는 판정 근거로 쓰지 않았다. 실행 중인 서비스(4873, 9000, 7100, 7200, 7300, 7400, 5173, 5174, `agentMode: mock`)와 격리 인스턴스, 그리고 실제 Chrome에서 직접 공격·우회를 시도했다. 재현 스크립트와 출력은 [`repro/r2/`](repro/r2/)에 있다.
- 비파괴 원칙: 새 projectId·새 프로젝트·임시 dataDir·임시 upstream만 사용했다. 쓰기 요청은 거부가 기대되는 경로로만 보냈다. 토큰·시크릿 원문은 어떤 출력에도 남기지 않았다(길이·일치 여부만 기록).
- 표기: `검증 여부`는 **직접 재현함** 또는 **코드로만 판단**이다. R1과 같이 추측성 영향은 심각도를 한 단계 낮췄다.

## 요약

| R1 ID | R1 심각도 | R2 판정 | 한 줄 근거 |
|---|---|---|---|
| C1 | critical | **수정됨** | 실행 중 :7200에 프리뷰 Origin 발급·레지스트리·감사 요청 7종, Origin 변형 7종, `/proxy/*` 경로 혼동 8종 모두 토큰 발급 없음. 실제 Chrome(프리뷰와 같은 sandbox)에서 Origin 없는 인증 요청 경로 없음. |
| H1 | high | **수정됨** (잔여 medium 1: N5) | 과거 기본 시크릿 5종 위조 세션 모두 401, `.env` 0600·gitignore·히스토리/로그/프로세스 인자 노출 없음. 단 운영 가드가 `NODE_ENV === 'production'` 정확 일치일 때만 동작한다. |
| H2 | high | **수정됨** (회귀 medium 1: N3, 잔여 medium 1: N4) | 이중·삼중·사중 인코딩, 전각 점, 오버롱 UTF-8, `%u`, `%2f`, `?`·`#` 삽입 모두 400. 대신 upstream 경로 접두사가 사라지는 회귀와 `;` 세그먼트 원문 전달이 남았다. |
| M1 | medium | **수정됨** (회귀 medium 1: N2) | R1 변형 4종(Phone, contact.phone, phones[], phone 객체) 모두 마스킹·감사. 새 잔여 PII 스캔이 **seed 등록 API의 날짜를 계좌번호로 오탐**해 실제 응답 값을 훼손한다. |
| M2 | medium | **부분** → **low로 하향** | 텍스트 검사는 동적 조합 표본 14종이 모두 통과한다. 다만 C1 수정 후 우회 코드도 정책 프록시에서 `@toi/fetch`와 동일한 권한만 가진다. 실질 영향은 별개 원인인 N1(agent-server)과 CSP 부재뿐이다. |
| M3 | medium | **수정됨** (잔여 low) | 서로 다른 range 3개가 같은 lock으로 수렴하면 빌드 1회, 실패·저장소 오류 후 예약 누수 없음. 실제 Yarn은 range별 lockfile이 달라 병합 경로가 거의 발동하지 않는다(README에 명시됨). |
| Bench | low | **수정됨** | 요약 문장에서 warm이 "TOI 내부 cold→warm"으로 분리되어 Sandpack cold와 병치되지 않는다. |

**새 발견**: medium 5건(N1~N5), low 7건(L1~L7). critical/high는 없다. → **§5 머지 판단: TOI-lite 1차 범위 종료 가능**(medium은 후속 과제로 추적).

---

## 1. R1 발견별 판정

### C1 · 프리뷰 코드의 임의 역할 세션 발급 — **수정됨**

**수정 내용(코드 확인)**: `services/policy-proxy/src/server.ts:91`에서 라우팅 전에 Origin을 서버 측에서 판정한다. 규칙은 다음과 같다.
- Origin이 없으면 서버 간 호출로 허용한다.
- 스튜디오 origin(`http://localhost:5173`)은 모든 경로를 허용한다.
- 프리뷰 origin(`http://localhost:5174`)은 `rawUrl`이 `/proxy/<apiId>`와 일치할 때만 허용한다.
- 그 밖의 경우는 CORS 헤더 없이 403으로 거부한다.

추가 방어는 세 가지다. 발급 요청은 JSON만 받는다(`:99`, 단순 요청 차단). platform-admin 발급은 Origin이 없고 서버용 dev admin 토큰이 있어야 한다(`:106-108`). 비관리자 `/audit`은 projectId가 필수이고 subject로 범위가 제한된다(`:122-127`, `storage.ts:65-67`). 라우터는 `proxyMatch`(`:100`)를 먼저 처리하므로 `/proxy/..` 형태로 발급 라우트에 도달할 수 없다.

**R1 원래 repro 재실행**: [`r1-01-...rerun.out`](repro/r2/r1-01-preview-privilege-escalation.rerun.out). 1단계에서 ACAO 헤더가 없어 `grep`이 실패하고 exit 1로 끝난다. 뒷단계는 아래 R2 스크립트로 대신 검증했다.

**R2 직접 재현**: [`01-c1-bypass.sh`](repro/r2/01-c1-bypass.sh) / [출력](repro/r2/01-c1-bypass.out)은 실행 중 :7200에 요청을 보냈다. [`02-c1-browser.mjs`](repro/r2/02-c1-browser.mjs) / [출력](repro/r2/02-c1-browser.out)은 실제 Chrome에서 `preview-runtime/src/index.ts:85`와 같은 `sandbox="allow-scripts allow-same-origin"`으로 5174 문서를 띄워 시도했다.
```
A1 POST /dev/session json roles=[viewer,editor,admin]   HTTP 403  ACAO=none  token=false ORIGIN_FORBIDDEN
A5 POST /capabilities (viewer token)                     HTTP 403  ACAO=none  token=false ORIGIN_FORBIDDEN
A7 GET /audit?projectId (viewer token)                   HTTP 403  ACAO=none  token=false ORIGIN_FORBIDDEN
F1 preview GET /proxy/customers/customers (read cap)     HTTP 200  (정상 경로 유지)
F2 preview PATCH with read cap                           HTTP 403  WRITE_FORBIDDEN
```
실제 Chrome에서 확인한 결과는 다음과 같다(echo 서버가 받은 Origin 기준).
```
cors-json / nocors-text / nocors-noref / beacon / blob:worker  → origin=http://localhost:5174
srcdoc(sandbox) → origin=null
nocors-get-auth → origin=(none), authorization=false   ← Origin이 빠지는 유일한 경우는 Authorization도 제거된 no-cors GET
form POST → sandbox(allow-forms 없음)로 전송 안 됨, window.open → null, top.location → SecurityError
```
**결론**: 브라우저가 "Origin 없음 = 서버 간 호출" 규칙을 흉내 내면서 Bearer 토큰까지 싣는 경로는 없다. 우회 결과는 §2-C1에 있다.

### H1 · 운영 모드의 개발용 시크릿·dev 세션 — **수정됨** (잔여: N5, L6)

**수정 내용**: `config.ts:17-21`의 production 가드는 세 시크릿에 대해 누락, 32바이트 미만, 알려진 기본값을 모두 거부한다. `TOI_DEV_AUTH_ENABLED !== 'false'`도 거부하고, `TOI_DEV_ADMIN_TOKEN`은 존재하기만 해도 거부한다. 개발 모드에서 알려진 기본값이나 누락된 값은 프로세스별 난수로 대체한다(`:13`, `:22`). `scripts/dev-up.mjs:6-21`은 난수 키를 gitignore된 `.env`(0600)에 기록한다.

**직접 재현함**:
- [`13-h1-forged-defaults.out`](repro/r2/13-h1-forged-defaults.out): 과거 기본 시크릿 5종과 추측값 3종으로 위조한 platform-admin 세션을 실행 중 :7200 `/audit`에 보냈고, **8건 모두 401**이었다.
- [`08-h1-config-guard.out`](repro/r2/08-h1-config-guard.out): production에서 기본 시크릿, dev auth 미설정, `TOI_DEV_ADMIN_TOKEN=""`, `FALSE`(대문자)는 **거부**됐다. 반면 `NODE_ENV=Production`·`prod`·`"production "`·`staging`은 **devAuth=true로 수락**됐다(→ N5).
- [`03-h1-exposure.out`](repro/r2/03-h1-exposure.out): `.env`는 mode 600, gitignored, 추적되지 않는다. 세 키 모두 git 히스토리·`scripts/.run/*.log`·전체 프로세스 인자(`ps -axww`)에 없다. 프로세스 환경(`ps -E`, 같은 사용자만 열람 가능)에는 policy-proxy와 **mock-backend**에 존재한다(→ L6).
- [`14-h1-mock-backend-default.out`](repro/r2/14-h1-mock-backend-default.out): 실행 중 :7300은 저장소 기본 서비스 토큰을 401로 거부했다. 단 `mock-backend/src/main.ts:4`는 env가 없으면 여전히 기본값으로 기동한다(→ L6).
- R1 원래 repro 재실행 [`r1-02-...rerun.out`](repro/r2/r1-02-production-defaults.rerun.out): A에서 `sessionSecretIsRepoDefault=false`로 나오고, B에서 production 가드가 throw해 exit 1로 끝난다.

**ephemeral 시크릿 재시작 시 기존 세션(코드로만 판단)**: dev-up 경로에서는 `.env`에 키가 영속되어 재시작 후에도 세션이 유지된다. `.env` 없이 proxy를 단독 실행하면 재시작마다 키가 바뀌어 기존 토큰은 401이 된다(안전한 방향). 스튜디오는 `controller.ts:39`의 `#sessions ??=` 때문에 401 후에도 세션을 다시 발급하지 않아 새로고침 전까지 동작하지 않는다(보안 영향 없음, 사용성 low). agent-server의 `PolicyClient`는 401에서 재발급한다(`policy-client.ts:20`).

### H2 · 이중 인코딩으로 allowlist 우회 — **수정됨** (회귀: N3, 잔여: N4, L3)

**수정 내용**: `server.ts:13-24` `normalizePath`는 최대 3회 디코딩한다. 디코딩 중 `%2f`가 나오거나 결과에 `%`·`\`·`.`/`..` 세그먼트·`?#`·제어문자가 남으면 거부한다. `:31-35` 템플릿 변수는 점만으로 된 값을 거부한다. `:59-60`은 `new URL(pathname, base).pathname !== pathname`이면 거부한다.

**직접 재현함**(격리 인스턴스): [`04-h2-m1-isolated.mts`](repro/r2/04-h2-m1-isolated.mts) / [출력](repro/r2/04-h2-m1-isolated.out). `node:http`로 원문 경로를 그대로 보냈다.
```
이중 인코딩 (R1) %252e%252e        400 INVALID_PATH
삼중 / 사중(루프 3회 초과) 인코딩   400 / 400
전각 점 ．． / 이중 인코딩 전각 점  400 / 400
오버롱 %c0%ae / %e0%80%ae / %u002e  400 / 400 / 400
%3f  %23  %253f  %5c  %2f  %252f  %00  %09   모두 400
세미콜론 ..;  / ..%3b              200 upstream=["/reports/..;/admin"]   ← N4
세그먼트 끝 . (2024./admin.)        200 upstream=["/reports/2024./admin."] ← N4
한글 경로 파라미터                  400 INVALID_PATH                       ← L3(정상 입력 거부)
upstreamBaseUrl=<up>/tenant-a/api   200 upstream received ["/items/42"]   ← N3(접두사 소실)
```
R1 원래 repro 재실행 결과([`r1-03-...rerun.out`](repro/r2/r1-03-proxy-path-and-mask.rerun.out)): `encoded /reports/%252e%252e/admin -> 400 | upstream received: []`.

### M1 · 마스킹의 대소문자·중첩·배열·타입 변형 — **수정됨** (회귀: N2, 잔여: L1, L4)

**수정 내용**: `mask.ts:45-55`는 pointer 세그먼트를 대소문자 무시로 비교한다. `:38-44`는 규칙이 맞은 노드의 하위 문자열·숫자를 재귀로 마스킹한다. `:13-31`은 모든 문자열에 이메일·주민번호·휴대폰·계좌 정규식으로 잔여 스캔을 한다. 경고는 `unregistered_pii_field`와 `mask_rules_unmatched` 두 가지다. `server.ts:65-70`은 JSON이 아닌 응답에 PII가 있으면 502로 막는다.

**직접 재현함**:
- R1 원래 repro 재실행: `{"Phone":"010-****-5678","contact":{"phone":"010-****-5678"},"phones":["010-****-5678"],"phone":{"number":"010-****-5678"}}`. 감사에는 `/items/0/contact/phone (detected)` 등 6개 경로가 기록됐다.
- 우회 표본 21종과 content-type 위장 5종은 [`04-...out`](repro/r2/04-h2-m1-isolated.out)에 있다(§2-M1).
- **실행 중 :7200 오탐**([`11-m1-false-positive.out`](repro/r2/11-m1-false-positive.out)): seed 등록 연산 `GET /customers/{id}/orders`의 `createdAt: "2026-08-01T00:00:00.000Z"`가 `"****-****-0801T00:00:00.000Z"`로 훼손되고 `policyWarnings: ["unregistered_pii_field", …]`가 기록된다(→ N2).

### M2 · 등록 데이터 경유 프롬프트 인젝션 — **부분**, 실질 영향 기준 **low로 하향**

**수정 내용**: `engine.ts:112`는 레지스트리 결과를 `untrusted_api_registry_data`로 감싼다. `system-prompt.ts`는 신뢰 경계를 명시한다. `source-policy.ts:6-17`은 finish와 소스 PUT 시점에 텍스트 금지 패턴을 검사한다(`engine.ts:148`, `server.ts:47`). 코드 주석(`:4-5`)은 이 검사가 우회 가능한 보조 방어라고 스스로 밝힌다.

**직접 재현함**([`09-m2-source-guard.out`](repro/r2/09-m2-source-guard.out)): 리터럴 `fetch(`만 차단된다. 다음 14종은 모두 **PASSES guard**다.
- `globalThis['fe'+'tch']`, `const f = window.fetch`, `fetch.call`, `Reflect.apply(fetch…)`, `fetch`
- protocol-relative `//evil.test`, `'http:'+'//…'`, `'/dev/'+'session'`, `atob(…)`
- `Object.assign(__TOI_FETCH_CONFIG__, …)`(frozen이라 런타임에서는 무효), `navigator['sendBeacon']`, `import('data:…')`, form 생성

**실제 정책 우회로 이어지는가**:
- **정책 프록시(7200)**: 이어지지 않는다. 우회 코드의 raw 요청도 Origin 5174로 나가므로 `/proxy/*`만 허용되고, 호스트가 준 viewer 세션·capability 권한만 가진다(§1-C1 A·F, 02 브라우저 결과).
- **agent-server(7400)**: 이어진다. 다만 원인은 텍스트 검사가 아니라 7400의 서버 측 Origin 검사 부재이며 **N1**로 분리했다.
- **외부 유출**: 프리뷰에 CSP가 없어서(`curl -I :5174/frame.html`에 CSP 헤더 없음) 마스킹된 화면 데이터와 viewer 토큰을 외부로 보낼 수 있다. 서버가 loopback에 bind되어 있고 viewer 토큰은 이미 가진 read 권한 이상을 주지 않으므로 low다.

### M3 · deps-builder single-flight — **수정됨** (잔여 low: L5)

**수정 내용**: `builder.ts:44`는 install 전 후보 키를 entries 정렬·dependencies·profile로 정규화한다. `:65-80`은 install 후 artifactKey로 먼저 예약(`artifacts` 맵)한 뒤 진행 중 빌드와 저장소 manifest를 재확인한다(`:82-92`). `finally`(`:78-80`)에서 예약을 해제한다. README `:42-44`는 "서로 다른 range는 install이 2회 발생할 수 있다"로 계약 문구를 실제 보장 범위에 맞췄다(R1 권고 반영).

**직접 재현함**:
- [`06-m3-failure-paths.out`](repro/r2/06-m3-failure-paths.out)은 fixture를 주입하고 실제 builder 코드를 실행했다.
```
1. 다른 range 3개, 설치 완료 시점 상이 → keysEqual, final=ready, installs 3, bundles 1, cleanups 3, artifacts/requests/builds 맵 0
2. 빌드 실패 → failed, 재요청 시 building→ready (영구 building·예약 누수 없음)
3. 예약 중 store.get 실패 → 두 대기자 모두 reject, 맵 0, 이후 요청 복구
4. 예약 중 store.get 무응답 → 수렴 요청 전원 무기한 대기 (타임아웃 없음, 기존 코드에도 동일)   ← L5
5. cleanup()이 throw → builds 맵에 키 잔존, 이후 요청이 재빌드 없이 failed 반환 + unhandledRejection  ← L5
```
- [`12-m3-live-ranges.out`](repro/r2/12-m3-live-ranges.out): 실행 중 :7100에 `^19.0.0`/`19.3.0`/`~19.3.0`을 동시에 보냈다. **artifactKey 3개가 모두 다르고**(lockfileSha256도 다름) 세 조합이 모두 `ready`로 끝났다. 실제 Yarn에서는 수렴 병합이 발동하지 않지만 교착이나 영구 building도 없다.

**교착 판단**: `request()`는 `resolve()`만 기다리고, `resolveArtifact()`는 빌드 완료를 기다리지 않는다(`building`을 즉시 반환). 따라서 대기 순환이 없다. 새로운 교착은 없다.

### Bench · warm/Sandpack 병치 — **수정됨**
`bench/README.md:3-5`에서 Sandpack cold(918ms)와 TOI cold(2,069ms)를 한 문장에 비교하고, warm(397ms)은 "TOI-lite 내부 cold → warm 변화 … Sandpack cold와의 동급 비교 값이 아니다"라는 별도 문단으로 분리했다. 수치·조건표(`:17-22`)는 유지됐다. **코드(문서)로 확인함**.

---

## 2. 수정 우회 시도 결과표

### C1

| # | 시도 | 결과 | 판정 | 근거 |
|---|---|---|---|---|
| 1 | 프리뷰 Origin `POST /dev/session` (json / text/plain / Content-Type 없음) | 403, ACAO 없음, 토큰 없음 | 막힘 | 01 A1-A3 |
| 2 | 프리뷰 Origin preflight `OPTIONS /dev/session` | 403 → 브라우저 실제 요청 불가 | 막힘 | 01 A4 |
| 3 | 프리뷰 Origin `/capabilities`·`/apis`·`/audit` (viewer 토큰) | 403 | 막힘 | 01 A5-A7 |
| 4 | `Origin: null` (sandbox srcdoc·data:) | 서버 403 / Chrome 실제 `origin=null` 전송 확인 | 막힘 | 01 B1, 02 #10 |
| 5 | 대소문자 `HTTP://LOCALHOST:5173`, `127.0.0.1:5173`, `5173.evil.test`, `:05173`, 중복 Origin, 빈 Origin | 모두 403(정확 문자열 비교) | 막힘 | 01 B2-B7 |
| 6 | `Referer`만 있고 Origin 없는 요청 | 서버는 viewer/editor 발급(서버 간 규칙). **Chrome은 POST·CORS·beacon·blob Worker 모두 Origin을 붙이고**, Origin이 빠지는 no-cors GET은 Authorization을 제거한다 → 브라우저로 흉내 불가 | 막힘(브라우저) | 01 D1, 02 echo 로그 |
| 7 | 서버 간 규칙을 브라우저가 흉내: form POST, sendBeacon(text/plain·json), no-cors + `referrerPolicy:no-referrer`, blob: Worker, Service Worker | form은 sandbox로 미전송, 나머지는 Origin 5174, SW는 blob URL 등록 거부 | 막힘 | 02 #2-#7, #11, #13 |
| 8 | `/proxy/*` 허용 규칙으로 발급 라우트 도달: `/proxy/../dev/session`, `/proxy/%2e%2e/…`, `..%2f`, `?/dev/session`, `/proxy%2f…`, `/PROXY/../audit`, `//proxy/x/../../apis` | proxy 핸들러로만 라우팅(401/403) 또는 Origin 403, 토큰 없음 | 막힘 | 01 C1-C8 |
| 9 | 프리뷰에서 스튜디오 origin 창 열기(`window.open`/opener), `top.location` 이동 | `window.open` → null(allow-popups 없음), top 이동 SecurityError | 막힘 | 02 #8-#9 |
| 10 | 프리뷰가 스튜디오 5173을 중첩 iframe으로 로드 | 로드는 되지만 cross-origin이라 DOM 접근 불가. 스튜디오에 frame-ancestors가 없어 UI 가림 공격 여지 → **L7** | 부분(low) | 02 #12 |
| 11 | 5173의 `frame.html`을 중첩해 `load` 메시지 주입 | `frame.ts:27-30`이 `event.origin === parentOrigin`(5173만 허용)과 `source === parent`를 요구 → 5174 발신 거부 | 막힘(코드) | 코드로만 판단 |
| 12 | platform-admin: 스튜디오 Origin / Origin 없음 + 토큰 없음 | 403 DEV_ADMIN_FORBIDDEN | 막힘 | 01 D2-D3 |
| 13 | `/audit` subject 필터: projectId 누락 / 타인 프로젝트 / 중복 파라미터 | 400 / 빈 배열 / 빈 배열 | 막힘 | 01 E1-E3 |
| 14 | `/audit` subject 필터: dev 발급기로 **타인 sub 사칭** 세션 | 서버 간 호출에서는 그 사용자 기록 1건 열람, 프리뷰 Origin에서는 403. dev bootstrap의 자기 선언 identity 한계이며 README `:182`에 명시 → **L7 참고(정보)** | 설계 한계 | 01 E4-E5 |
| 15 | viewer 토큰으로 타 프로젝트·`env=live` read capability (서버 간) | 200 발급. 프로젝트 membership 미검증(R1 부록과 동일, README 명시). 프리뷰에서는 403 | 설계 한계 | 01 D4 |
| 16 | 프리뷰 → **agent-server(7400)** 단순 요청 | `POST /generations`가 서버에서 실행되어 generation 생성 → **N1** | **우회됨(다른 서비스)** | 07 |

### H1

| 시도 | 결과 | 판정 | 근거 |
|---|---|---|---|
| dev-up이 만든 `.env`가 커밋되는가 | gitignored, 미추적, 히스토리에 값 없음 | 안전 | 03 |
| 로그 노출 | `scripts/.run/*.log` 3개에 값 없음(서비스는 시크릿을 로그에 쓰지 않음) | 안전 | 03 |
| 프로세스 목록 노출 | 명령행 인자에는 없음. 환경(같은 사용자만 열람)에는 policy-proxy와 **mock-backend**에 서명키 존재 → L6 | 부분(low) | 03, `dev-up.mjs:39` |
| 과거 저장소 기본키로 세션 위조 | 5종 + 추측값 3종 모두 401 | 막힘 | 13 |
| 운영 가드: 기본키 / dev auth 미설정 / `ADMIN_TOKEN=""` / `FALSE` | 모두 기동 거부 | 막힘 | 08 |
| 운영 가드: `NODE_ENV=Production`·`prod`·`staging`·후행 공백 | **수락, devAuth=true**(Production은 dev admin 토큰도 수락) → **N5** | **우회됨** | 08 |
| 운영 가드: 세 시크릿 동일 값 / 저엔트로피 `"a"×32` | 수락("독립 난수" 요구가 README에만 있고 강제되지 않음) | 잔여(low, N5에 포함) | 08 |
| ephemeral 재시작 시 기존 세션 | dev-up 경로는 `.env`로 영속. 단독 기동 시 401(안전). 스튜디오는 새로고침 전까지 재발급하지 않음 | 안전/사용성 low | 코드로만 판단(`controller.ts:39`) |

### H2

| 시도 | 결과 | 판정 |
|---|---|---|
| 삼중·사중 인코딩 | 400 | 막힘 |
| 전각 점 `．．`(원문/이중 인코딩) | 400(`new URL`이 percent-encode해 pathname 불일치) | 막힘 |
| 오버롱 UTF-8 `%c0%ae`, `%e0%80%ae`, IIS `%u002e` | 400(`decodeURIComponent` 예외) | 막힘 |
| `?`·`#` 삽입(`%3f`, `%23`, `%253f`) | 400 | 막힘 |
| `;` 삽입 `..;`, `..%3b` | **200, upstream이 `/reports/..;/admin` 원문 수신** → N4 | **잔여(조건부)** |
| 세그먼트 끝 `.` (`2024./admin.`) | **200, 원문 전달** → N4 | 잔여(조건부) |
| `...` / 빈 세그먼트 `//` | 404 OPERATION_NOT_REGISTERED | 막힘 |
| 백슬래시·`%2f`·`%252f`·NUL·탭 | 400 | 막힘 |
| 다른 등록 템플릿으로 교차(`/customers/{id}` → `%252e%252e%252freports`) | 400 | 막힘 |
| upstreamBaseUrl 경로 접두사 | **접두사 소실(`/tenant-a/api/items/42` → `/items/42`)** → N3 | **회귀** |
| 정상 비ASCII 경로 파라미터(한글) | 400 → L3 | 기능 회귀(low) |

### M1

| 시도 | 결과 | 판정 |
|---|---|---|
| 키 유니코드 변형(전각 `ｐｈｏｎｅ`, 키릴 `рhone`, `phone​`) + 문자열 값 | 잔여 스캔이 값을 마스킹하고 `unregistered_pii_field` 기록 | 막힘 |
| **숫자 타입** 전화·주민·계좌(미등록 키) | **원문 통과**(`scanPii`는 문자열만 검사, `mask.ts:22`) → L1 | 잔여(low) |
| 등록 규칙 매칭 + 같은 객체의 숫자 주민번호 | **원문 통과, 경고 없음**(규칙이 매칭되어 `mask_rules_unmatched`도 없음) → L1 | 잔여(low) |
| 구분자 없음 `01012345678`, `+82 10 …`, 문장 내 번호 | 마스킹 | 막힘 |
| 밑줄·en dash·괄호·전각 숫자·공백 주민번호·`010x1234x5678`·필드 분할 | 원문 통과 → L1 | 잔여(low, 보조 탐지 한계) |
| PII가 객체 **키** | 원문 통과 → L1 | 잔여(low) |
| 비JSON content-type 위장: `text/plain`, `application/vnd.api+json` | 502 UPSTREAM_PII_RESPONSE | 막힘 |
| `application/json` 선언 + 비JSON 본문 | 502 | 막힘 |
| `text/html; x=application/json` + JSON | JSON으로 처리되어 마스킹 적용 | 막힘 |
| 대용량 20MB(10만 행) | 200, **이벤트 루프 최대 6.6초 차단**(sanitize 5.6초는 기존 코드, 신규 스캔 1.1초) → L4 | 잔여(low) |
| 문자열 10MB 반복 / 이메일 regex 병리 입력 5MB | 0.5초 / 0.06초 차단, 선형(백트래킹 폭발 없음) | 막힘 |
| 깊이 2만 객체 / 10만 배열 중첩 | 502 UPSTREAM_UNAVAILABLE(프로세스 생존, 감사 기록) | 막힘(fail-closed) |
| **정상 날짜 문자열** `2026-08-01T…` | **계좌로 오탐해 값 훼손(실행 중 seed API)** → N2 | **회귀** |

### M2 / M3 우회·실패 경로 요약

| 대상 | 시도 | 결과 |
|---|---|---|
| M2 | 동적 조합 14종 텍스트 검사 우회 | 전부 통과. 정책 프록시 우회로는 이어지지 않음(C1 결과). agent-server 영향은 N1, 외부 유출은 CSP 부재(low) |
| M3 | 교착 | 없음(대기 순환 없음, 06-1~3) |
| M3 | 영구 building(빌드 실패) | 없음. failed 후 재빌드(06-2, 실행 중 7100 모두 ready) |
| M3 | 예약 누수(빌드 실패·저장소 오류) | 없음. 맵 0(06-2, 06-3) |
| M3 | cleanup 실패 / store 무응답 | builds 맵 잔존 + unhandledRejection / 무기한 대기 → L5 |

---

## 3. 회귀 확인

### E2E A~F 직접 실행
`npm --prefix e2e run test`를 1회 실행했다. **6 passed (15.3s), unexpected 0, flaky 0**. 출력은 [`e2e-run1.out`](repro/r2/e2e-run1.out), 결과는 [`e2e-run1-results.json`](repro/r2/e2e-run1-results.json), 화면은 [`e2e-run1-studio.png`](repro/r2/e2e-run1-studio.png)에 있다. 실행으로 변경된 추적 파일 `e2e/artifacts/{results.json,studio.png}`는 `repro/r2/`로 복사한 뒤 원래 상태로 되돌렸다(작업 트리에 남은 변경은 `docs/review/repro/r2/`뿐이다).
```
✓ A: 생성, 역질문, 마스킹, 조회 사유와 감사 기록
✓ B: 문법 오류는 마지막 정상 화면 유지
✓ C: 이전 실행을 지연해도 최신 revision만 커밋
D preview issuance boundary: {"roles":["viewer"],"probes":[{"endpoint":"/dev/session","tokenObtained":false,"blocked":true},{"endpoint":"/capabilities","tokenObtained":false,"blocked":true}],"authenticatedCapabilityBlocked":true}
✓ D: viewer 자체 발급 차단, 읽기 전용 차단, 제한된 쓰기 허용
✓ E: 두 탭 CAS 충돌과 최신 내용 다시 불러오기
✓ F: 사내 useToast와 앱 React 인스턴스 공유
```

### 스튜디오 정상 흐름
E2E A·D는 실제 Chrome에서 스튜디오 UI를 조작하므로 이것으로 확인했다.
- 생성: 채팅 → 역질문 → 코드 반영
- 프리뷰: 마스킹된 고객 목록 렌더링(`010-****-5678`, 스크린샷에서 이름 `김*동`)
- 활동 기록: `GET · 200 · 허용 / 고객 문의 확인`, 감사의 `maskedFields`
- 쓰기 허용 토글: 토글 전 PATCH는 "쓰기 권한" 오류, 토글 후 "상태를 정지로 바꿨어요"와 PATCH allowed 감사 기록

모두 정상이다. 다만 E2E와 스튜디오 기본 템플릿은 `/customers/{id}/orders`를 사용하지 않아 **N2 회귀를 잡지 못한다**.

### 참고: 단위 테스트(판정 근거 아님)
[`10-unit-tests.out`](repro/r2/10-unit-tests.out)의 결과는 policy-proxy 67/67, agent-server 37 passed + 1 skipped(live), deps-builder `single-flight.test.ts` 2/2다. 수정자 보고와 일치한다. 위 판정은 이 결과가 아니라 §1·§2의 직접 실행에 근거한다.

### 발견한 회귀 요약
| ID | 원인 커밋 | 내용 |
|---|---|---|
| N2 | d8b8bb0 (M1) | 잔여 PII 스캔이 날짜 문자열을 계좌로 마스킹 → seed 주문 API 값 훼손·거짓 경고 |
| N3 | d8b8bb0 (H2) | upstream URL을 `new URL(absolutePath, base)`로 만들며 base 경로 접두사 소실 |
| L3 | d8b8bb0 (H2) | 비ASCII(한글 등) 경로 파라미터를 400으로 거부 |

---

## 4. 새로 발견한 문제

### N1 · (medium) 프리뷰 코드가 agent-server에 preflight 없는 단순 요청으로 생성 작업을 시작·취소·답변할 수 있음
`services/agent-server/src/server.ts:26-33`(CORS 헤더만, 서버 측 Origin 거부 없음), `:12-19`(Content-Type 무관 JSON 파싱), `:51-53`(`POST /generations`), `:59-62`(`cancel`, `answers`)

- **실패 시나리오**: 정책 프록시와 같은 C1 계열이다. 프리뷰(5174)의 생성 코드 또는 M2 인젝션으로 유도된 코드가 `fetch('http://localhost:7400/generations', {method:'POST', mode:'no-cors', body: JSON.stringify({projectId, prompt, baseRevision, requestId})})`를 보낸다. text/plain 단순 요청이라 preflight가 없고, 서버는 Origin을 보지 않고 실행한다.
  - projectId는 `__TOI_FETCH_CONFIG__.projectId`에서, revision은 프레임 문서에 인라인된 load payload에서 얻을 수 있다.
  - Claude 모드에서는 공격자 프롬프트로 에이전트가 해당 프로젝트 소스를 새 revision으로 저장한다. 사용자가 작성하거나 검토하지 않은 코드가 영속되고(되돌린 revision도 다시 오염), 유료 API 호출을 반복 유발할 수 있다.
  - generationId를 알면 사용자의 생성 작업을 취소하거나 답변을 주입할 수 있다(응답이 opaque라 id 획득은 어렵다).
  - 데이터 정책 자체는 7200이 계속 강제하므로 critical/high는 아니다.
- **직접 재현함**([`07-preview-to-agent-csrf.mjs`](repro/r2/07-preview-to-agent-csrf.mjs) / [출력](repro/r2/07-preview-to-agent-csrf.out)): 실제 Chrome, 프리뷰와 같은 sandbox, 새 격리 프로젝트로 시도했다.
  ```
  preview → {"generationPost":"opaque 0","corsRead":"blocked (no ACAO for 5174)"}
  server-side generation from preview request: {"state":"awaiting_answer","projectId":"<probe project>","events":["state","state","text","text","state","question"]}
  ```
  mock 드라이버는 역질문에서 멈추므로 **소스 변경까지는 재현하지 않았다**(revision 1 유지).
- **왜 테스트가 못 잡았나**: E2E D와 F1은 7200 경계만 검증한다. 7400은 "스튜디오만 호출한다"는 전제로 CORS 헤더만 설정했다.
- **권고**: 7200과 같은 서버 측 Origin 거부(5174 및 알 수 없는 Origin → 403, 스튜디오·서버 간만 허용)와 `Content-Type: application/json` 강제를 적용한다. 프리뷰 frame에 `Content-Security-Policy: connect-src <proxy> <deps>`를 두면 M2류 raw 네트워크 전체를 한 번에 줄일 수 있다.
- **담당**: `services/agent-server`(+ CSP는 `apps/studio/scripts/dev.mjs`, `packages/preview-runtime`)

### N2 · (medium, 회귀) 잔여 PII 스캔이 ISO 날짜를 계좌번호로 오탐해 seed 등록 API 응답을 훼손
`services/policy-proxy/src/mask.ts:17`(account 패턴 `\d{2,6}-\d{2,6}-\d{2,6}` / `\d{10,16}`), `:57-60`

- **실패 시나리오**: 등록 연산 `GET /customers/{id}/orders`(mock `data.ts:17`)의 `createdAt: "2026-08-01T00:00:00.000Z"`가 `4-2-2` 숫자 그룹이라 account 패턴에 맞는다. 응답이 `"****-****-0801T00:00:00.000Z"`로 바뀌어 프리뷰 앱이 날짜를 표시하거나 정렬하지 못한다. 감사에도 `/items/*/createdAt (detected)`와 `unregistered_pii_field`가 거짓으로 남아 경고의 신호 가치가 떨어진다(경보 피로). 13자리 epoch ms 문자열, 10~16자리 주문번호·송장번호도 같은 방식으로 훼손된다.
- **직접 재현함**(실행 중 :7200): [`11-m1-false-positive.sh`](repro/r2/11-m1-false-positive.sh) / [출력](repro/r2/11-m1-false-positive.out)
  ```
  {"items":[{"id":"C002-O1",…,"createdAt":"****-****-0801T00:00:00.000Z"},…]}
  {"path":"/customers/C002/orders","maskedFields":["/items/0/createdAt (detected)",…],"policyWarnings":["unregistered_pii_field","mask_rules_unmatched"]}
  ```
- **왜 테스트가 못 잡았나**: `hardening.test.ts`의 잔여 스캔 표본은 PII 양성 케이스 위주이고 음성(날짜·ID) 케이스가 없다. E2E도 orders를 조회하지 않는다.
- **권고**: account 규칙을 은행 계좌 형식(예: 3-2~6-4~6 + 문맥 키)으로 좁히고, ISO 날짜·시간(`\d{4}-\d{2}-\d{2}(T|$)`)은 제외한다. 잔여 스캔은 기본 "경고만(감사)" 모드로 두고 값 치환은 키 이름 휴리스틱(phone/tel/rrn/ssn/account 등)이 겹칠 때만 하는 방안을 검토한다. 음성 표본(날짜·UUID·주문번호·금액) 회귀 테스트를 추가한다.
- **담당**: `services/policy-proxy`

### N3 · (medium, 회귀) upstream URL 생성이 등록된 `upstreamBaseUrl`의 경로 접두사를 버림
`services/policy-proxy/src/server.ts:59-60`(`new URL(pathname, api.upstreamBaseUrl)`, pathname은 `/`로 시작), 비교: R1 시점 `3796c13` `server.ts`의 `` `${api.upstreamBaseUrl.replace(/\/$/, '')}${pathname}` ``

- **실패 시나리오**: platform-admin이 게이트웨이 뒤 API를 `upstreamBaseUrl: "https://gw.internal/tenant-a/api"`로 등록한다(`validateApi`는 경로 있는 base를 허용하고 allowlist도 전체 문자열로 비교한다, `storage.ts:36-37`). H2 수정 뒤 프록시는 `https://gw.internal/items/42`, 즉 **등록되지 않은 같은 호스트의 다른 경로**로 서비스 토큰을 붙여 호출한다. 기능 장애(404·오작동)이면서, 게이트웨이 루트에 다른 서비스가 있으면 등록 범위 밖 upstream에 도달한다. 현재 seed(`http://localhost:7300`, 경로 없음)에는 영향이 없다.
- **직접 재현함**(격리 인스턴스, [`04-...out`](repro/r2/04-h2-m1-isolated.out)):
  ```
  proxy /proxy/tenant/items/42 -> 200 | upstream received: ["/items/42"] | R1 시점 코드(문자열 결합)라면 /tenant-a/api/items/42
  ```
- **권고**: `const target = new URL(base); target.pathname = target.pathname.replace(/\/$/, '') + pathname;`처럼 접두사를 보존해 만든 뒤, 정규화 결과가 `base.pathname` 접두사로 시작하고 `접두사 + pathname`과 같은지 검사한다. 경로 있는 base로 등록한 API 회귀 테스트를 추가한다. 또는 `validateApi`에서 경로 있는 base를 명시적으로 거부한다.
- **담당**: `services/policy-proxy`

### N4 · (medium, 조건부 — upstream 해석은 미재현) `;` 경로 파라미터·세그먼트 끝 `.`를 원문 그대로 upstream에 전달
`services/policy-proxy/src/server.ts:22`(`.`/`..` 정확 일치만 거부), `:34`(템플릿 변수는 점만으로 된 값만 거부)

- **실패 시나리오**: `/proxy/<api>/reports/..;/admin`은 `{year}`에 `..;`가 들어가 등록 템플릿을 통과한다. `new URL`에서도 dot-segment가 아니므로 pathname 비교를 통과하고, upstream은 `/reports/..;/admin`을 받는다. Tomcat·Spring 계열 upstream은 `;` 이후를 path parameter로 떼어 `..`로 해석하므로 H2와 같은 **미등록 경로 도달**이 upstream 측에서 재발한다. 끝 `.`(`admin.`)은 Windows/IIS 계열에서 제거되어 다른 리소스에 매칭될 수 있다. mock-backend는 Node라 해당하지 않는다.
- **직접 재현함**(프록시 전달까지, 격리 인스턴스): `세미콜론 ..; → 200 upstream=["/reports/..;/admin"]`, `..%3b → 동일`, `2024./admin. → 200 원문 전달`. upstream의 `..;` 해석은 **재현하지 않음**(추측성 → 한 단계 낮춰 medium).
- **권고**: 디코딩 후 세그먼트에 `;`가 있으면 거부한다. 세그먼트가 `.`로 끝나거나 점만으로 이뤄지면 템플릿 변수든 리터럴이든 거부한다. 경로 변수 값은 `[A-Za-z0-9_-]`와 비ASCII 허용 등 명시적 문자 집합으로 제한한다(L3과 함께).
- **담당**: `services/policy-proxy`

### N5 · (medium) 운영 가드가 `NODE_ENV === 'production'` 정확 일치에만 걸려, 오타·다른 환경 이름에서 dev 발급이 켜짐(fail-open)
`services/policy-proxy/src/config.ts:16-24`(`devAuth: nodeEnv !== 'production' && env.TOI_DEV_AUTH_ENABLED !== 'false'`), `scripts/dev-up.mjs:7`

- **실패 시나리오**: 배포 매니페스트에 `NODE_ENV=Production`, `prod`, `staging`, `"production "`(후행 공백)이 들어가면 가드가 통째로 건너뛰어진다. 이때 `devAuth=true`가 되어, 네트워크로 프록시에 닿는 누구나(Origin 없는 요청) editor 세션을 발급받아 write capability를 얻는다. `TOI_DEV_ADMIN_TOKEN`이 남아 있으면 platform-admin까지 발급된다. `TOI_DEV_AUTH_ENABLED` 기본값도 "켜짐"이라 이중으로 fail-open이다. 운영 가드에서 세 시크릿 동일 값이나 저엔트로피 32바이트도 수락된다.
- **직접 재현함**(설정 함수, 서비스 미기동): [`08-h1-config-guard.out`](repro/r2/08-h1-config-guard.out)
  ```
  NODE_ENV=Production (대문자 P)   ACCEPTED {"devAuth":true,"devAdminToken":true,…}
  NODE_ENV=prod                    ACCEPTED {"devAuth":true,…}
  NODE_ENV=staging, 시크릿 없음    ACCEPTED {"devAuth":true,"sessionFromEnv":false,…}
  production + 세 시크릿 동일 값   ACCEPTED
  ```
  서버가 loopback에 bind한다는 전제(`main.ts:7`) 때문에 원격 악용은 배포 형태에 달려 있다. 따라서 high가 아닌 medium으로 본다.
- **권고**: dev 발급을 **opt-in**으로 뒤집는다. `TOI_DEV_AUTH_ENABLED === 'true'` **그리고** `NODE_ENV === 'development'|'test'`일 때만 켜고, 그 밖의 모든 NODE_ENV에는 production 가드를 적용한다. 세 시크릿이 서로 다른지 검사한다.
- **담당**: `services/policy-proxy`

### L1 · (low) 잔여 PII 스캔은 문자열만 검사하고, 등록 규칙이 매칭되면 누락을 경고하지 않음
`mask.ts:22`(`typeof node === 'string'`만), `:58-59`
- 미등록 키의 **숫자 타입** 주민번호 `9001011234567`·계좌 `110123456789`·전화 `1012345678`은 원문 그대로 통과한다. 같은 객체에서 등록 규칙이 하나라도 매칭되면 `mask_rules_unmatched`도 없어 감사상 **조용히** 누출된다. 구분자 변형(밑줄, en dash, 괄호, 전각 숫자, 공백 주민번호, 필드 분할)과 객체 키 속 PII도 미탐이다.
- **직접 재현함**: [`04-...out`](repro/r2/04-h2-m1-isolated.out) M1 표본. README(`:79`, 부록)가 "보조 탐지"로 명시하고 1차 방어는 등록 pointer이므로 low다.
- **권고**: 숫자 노드도 `String()`으로 스캔한다. 전각 숫자는 NFKC 정규화 후 스캔한다. 등록 API 스키마의 필드 목록과 응답 키를 대조해 "스키마에 없는 키" 경고를 추가한다.

### L2 · (low) M2 텍스트 검사의 우회 가능성 + 프리뷰 CSP 부재
`agent-server/src/source-policy.ts:6-17`, `apps/studio/scripts/dev.mjs:16`(응답에 CSP 없음)
- §1-M2 참조. 실질 영향은 N1과 외부 유출 채널이다. **직접 재현함**(09, 02).
- **권고**: 텍스트 검사는 유지하되 방어의 중심은 CSP `connect-src`/`img-src`와 7400 Origin 거부로 옮긴다.

### L3 · (low, 회귀) 비ASCII 경로 파라미터를 400으로 거부
`server.ts:59-60`. `new URL`이 비ASCII를 percent-encode하므로 디코딩된 pathname과 달라져 `/customers/%ED%99%8D…`가 **400 INVALID_PATH**가 된다(04 출력). 현재 seed id는 ASCII라 영향이 없다. N3·N4 수정 시 명시적 문자 집합과 인코딩 후 비교로 함께 해결할 것을 권고한다.

### L4 · (low) 큰 upstream 응답에서 프록시 이벤트 루프 장시간 차단, 응답 크기 상한 없음
`server.ts:71`(`upstream.json()` 무제한), `storage.ts:8-19`(`sanitize`: 문자열마다 시크릿×표현 3종 split/join), `mask.ts:19-31`
- **직접 재현함**: [`04-...out`](repro/r2/04-h2-m1-isolated.out), [`05-m1-cost-breakdown.out`](repro/r2/05-m1-cost-breakdown.out)
  ```
  100k rows (~20MB)  status=200 total=12787ms maxEventLoopBlock=6623ms maskJsonAlone=1117ms
  JSON.parse 59ms | maskJson 1100ms | sanitize 5564ms | JSON.stringify 56ms
  ```
- 차단 대부분은 기존 `sanitize`에서 발생하고, M1 수정이 약 1.1초/20MB를 더한다. upstream이 신뢰 서비스이고 mock은 `size ≤ 100`이라 low다. 권고는 두 가지다. upstream 응답 바이트 상한(예: 5MB 초과 시 502)을 두고, `sanitize`는 응답 전체 JSON 문자열에 한 번만 적용한다.

### L5 · (low) deps-builder: cleanup 실패 시 `builds` 맵 잔존으로 재빌드 불가, store 무응답 시 수렴 요청 무기한 대기
`deps-builder/src/builder.ts:117`(`finally { await installed.cleanup(); this.builds.delete(key); }`), `:85`(신규 `builds.has(key)` 조기 반환), `:87`
- **직접 재현함**([`06-...out`](repro/r2/06-m3-failure-paths.out) 4·5):
  - `cleanup()`이 throw하면 `builds.delete`가 실행되지 않는다. F2가 추가한 `:85`가 이후 요청에 `failed`를 재빌드 없이 반환하고 unhandledRejection이 난다(기본 Node 설정이면 프로세스 종료).
  - manifest 조회가 응답하지 않으면 같은 artifactKey로 수렴한 요청 전부가 대기한다(조회 무기한 대기 자체는 기존 코드와 같다).
- `rm({force:true})`는 드물게만 실패하므로 low다. 권고: `finally`에서 `builds.delete`를 먼저 하고 cleanup 오류는 로그로만 남긴다. store 조회에 타임아웃을 둔다.

### L6 · (low) dev-up이 모든 자식에 전체 env를 전달해 upstream(mock-backend)이 세션·capability 서명키를 보유, mock-backend는 저장소 기본 토큰 fallback 유지
`scripts/dev-up.mjs:39`(`env:{...process.env,…}`), `services/mock-backend/src/main.ts:4-5`
- **직접 재현함**(03): 실행 중 mock-backend 환경에 `TOI_SESSION_SECRET`·`TOI_CAPABILITY_SECRET`이 있다. upstream이 손상되면 세션 위조가 가능해진다(최소 권한 위반). mock-backend는 env 누락 시 저장소 기본값 `toi-dev-upstream-secret`으로 기동하고, production에서도 기본값 여부는 검사하지 않는다(현재 실행 중 인스턴스는 401로 거부, 14).
- **권고**: 서비스별 필요한 키만 allowlist로 넘기고, mock-backend의 기본값 fallback을 제거한다.

### L7 · (low) 프리뷰 origin 공유·스튜디오 framable (UI 가림 / 교차 프로젝트 저장소 공유)
`apps/studio/scripts/dev.mjs:7-10`(5173·5174가 같은 핸들러로 스튜디오 `index.html`까지 제공, X-Frame-Options·frame-ancestors 없음), 모든 프로젝트 프리뷰가 단일 origin 5174
- **부분 재현함**(02 #12): 프리뷰 안에서 스튜디오 5173을 중첩 iframe으로 로드할 수 있다(DOM 접근은 불가).
  - 투명 오버레이로 "쓰기 테스트 허용" 클릭을 유도하는 UI 가림 공격이 가능하다. 다만 결과는 사용자가 직접 토글한 것과 같은 권한 범위다.
  - 모든 프로젝트 프리뷰가 localStorage·BroadcastChannel을 공유해, 한 프로젝트의 생성 코드가 다른 프로젝트 프리뷰에서 받은 capability(write 120초)를 저장했다가 재사용할 여지가 있다(**코드로만 판단**).
- 참고(정보): dev 발급기의 `sub`는 자기 선언이라 서버 간 호출로 다른 스튜디오 사용자 id를 사칭하면 그 사용자의 감사가 보인다(01 E4). 프리뷰에서는 403이며 README `:182`의 dev bootstrap 한계에 해당한다.
- **권고**: 스튜디오 응답에 `frame-ancestors 'self'`를 두고, 5174는 `frame.html`과 frame 자산만 제공한다. 장기적으로 프로젝트별 프리뷰 origin(서브도메인)을 둔다.

---

## 5. 머지 판단

**남은 critical/high: 없음.**

- R1의 critical(C1)과 high 2건(H1, H2)은 원래 공격과 R2 우회 시도(실행 중 서비스 + 실제 Chrome)에서 모두 막혔다.
- R2에서 새로 찾은 문제 중 가장 높은 것은 medium이다(N1~N5). N1의 영향은 데이터 정책이 아니라 프로젝트 소스 무결성과 비용이다. N3·N4·N5는 배포나 upstream 조건에 따라 달라지는 조건부 문제다.

→ **TOI-lite 1차 범위 종료 가능.**

권장 후속 순서(1차 종료를 막지 않음):

| 우선 | ID | 이유 |
|---|---|---|
| 1 | N2 (medium, 회귀) | 현재 seed 등록 API 응답을 실제로 훼손한다. 데모에서 바로 드러나고 감사 경고 신뢰도를 떨어뜨린다. |
| 2 | N1 (medium) | C1과 같은 계열(프리뷰 → 무인증 단순 요청)이 7400에 남아 있다. 서버 측 Origin 거부 몇 줄로 닫힌다. |
| 3 | N3 · N4 · L3 (H2 후속) | 경로 구성과 문자 집합을 한 번에 정리한다. 경로 있는 base를 쓰는 실제 API를 등록하기 전에 필요하다. |
| 4 | N5 | 운영 배포 전 필수. dev 발급을 opt-in으로 뒤집는다. |
| 5 | L1 · L2 · L4~L7 | 보조 탐지 강화, CSP, 크기 상한, 최소 권한, origin 분리 |

INTENT 관점에서 "데이터 정책을 AI가 아니라 플랫폼이 보장한다"는 주장은 정책 프록시 경계에 대해서는 R2 시점에 성립한다. 남은 과제는 그 경계 밖의 서비스(agent-server)와 운영 설정의 fail-closed화다.
