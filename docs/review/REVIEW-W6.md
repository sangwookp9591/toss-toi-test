# REVIEW-W6 — W6-A1 / W6-A2 / W6-C1 독립 코드 리뷰

- 대상: 커밋되지 않은 작업 트리(2026-09-14 기준, `git diff`)
- 범위: A1 policy-proxy upstream 응답 상한, A2 deps-builder storage 타임아웃, C1 agent-server Gemini 드라이버
- 방식: 읽기 전용 리뷰. 저장소 파일은 이 보고서만 작성. `.env` 열람 안 함, dev-up 실행 안 함, git 조작 안 함.
  재현 스크립트는 세션 scratchpad에서만 실행. (재현 명령 하나가 실수로 `services/deps-builder/.review-tmp.mts`를 만들었고 같은 명령에서 바로 지웠음. `git status`로 남은 변경이 없는 것을 확인함.)
- 주의: `contracts/src/generation.ts` diff에는 W6-B1(`apiBindings`) 변경이 섞여 있음. C1 관련 부분은 `/healthz` 주석 한 줄뿐이라 이 리뷰에서는 그 줄만 봄.

## 실행한 검증 (Node v22.22.1)

| 명령 | 결과 |
|---|---|
| `npm --prefix services/policy-proxy run typecheck` | 통과 |
| `vitest run test/hardening.test.ts` (policy-proxy) | 119/119 통과 |
| `npm --prefix services/deps-builder run typecheck` | 통과 |
| `tsx --test test/{failure,single-flight,hash,cors}.test.ts` (deps-builder, 서비스 불필요) | 11/11 통과 |
| `npm --prefix services/agent-server run typecheck` | 통과 |
| `vitest run tests/drivers` (agent-server) | 2 files, 11/11 통과 |
| `node --test scripts/dev-up.test.mjs` | 9/9 통과 |
| scratchpad 재현: fake MinIO 클라이언트가 `NoSuchKey`를 던질 때 `MinioStore.get` 동작 | **결함 재현됨** (C-1 참고) |

실행하지 않은 것: deps-builder `integration.test.ts`(MinIO·Verdaccio 필요), `node evals/run.mjs --driver gemini`(`evals/results/`에 파일을 쓰기 때문에 쓰기 금지 범위에 걸림), 실제 Gemini API 호출.

---

## 요약

| 심각도 | 건수 | 항목 |
|---|---|---|
| critical | 1 | C-1 (A2) MinIO에 없는 키가 `storage_unavailable`로 바뀌어 첫 빌드가 모두 실패 |
| high | 3 | H-1 (C1) 평가 비용 한도가 전체 실행이 아니라 케이스마다 새로 적용됨 · H-2 (C1) 도구 스키마가 Gemini `parameters` 규격과 맞지 않을 가능성(unverifiable) · H-3 (A2) 타임아웃이 실제 MinIO 작업을 끊지 않아 소켓·메모리 누수 |
| medium | 6 | M-1~M-6 |
| low | 7 | L-1~L-7 |

---

## CRITICAL

### C-1 (A2) `MinioStore.get`이 없는 키를 `undefined`가 아니라 `storage_unavailable`로 던짐
- 위치: `services/deps-builder/src/store.ts:23-24`, `:28`
- 원인: `stream()`이 이제 `storageOperation`으로 감싸져 있음. `storageOperation`의 `catch`(`security.ts:24`)는 **모든** 오류를 `BuilderError('storage_unavailable')`로 바꿈. 그래서 MinIO의 `NoSuchKey`/`NotFound` 코드가 사라지고, `get()` 안의 `['NoSuchKey','NotFound'].includes(error.code)` 검사가 항상 거짓이 되어 오류를 다시 던짐.
- 실패 시나리오: 실제 MinIO 환경에서 처음 들어온 요청은 `resolve()`의 `store.get('requests/<hash>.json')`(builder.ts:59)에서 인덱스가 없음 → `storage_unavailable` → HTTP 503. 캐시가 없는 요청은 **한 번도 빌드되지 않음**. `status()`의 manifest 조회(`builder.ts:43`)도 같은 문제라서, 에셋 라우트에서 발행되지 않은 키를 조회하면 404가 아니라 503이 됨.
- 재현(scratchpad): `client.getObject`가 `{code:'NoSuchKey'}`로 reject하게 한 `MinioStore` → `MinioStore.get missing THREW BuilderError storage_unavailable`, `builder.status missing THREW storage_unavailable`. HEAD 코드에서는 `undefined`를 반환함.
- 테스트가 놓친 이유: 새 단위 테스트는 `MemoryStore`와 fake store만 쓰고 `MinioStore`는 한 번도 거치지 않음. `integration.test.ts`는 서비스가 없으면 돌지 않음.
- 권고 수정: `MinioStore.get` 안에서는 감싸지 않은 `this.client.getObject`를 직접 부르고 NoSuchKey 판별을 먼저 한 다음, 바깥에서 한 번만 `storageOperation`으로 감쌈. 아니면 `MinioStore`에서는 타임아웃을 빼고 `PackageBuilder.store` 래퍼(builder.ts:29-31) 한 곳에만 둠(지금은 이중·삼중으로 감싸져 있음). NoSuchKey → `undefined`를 확인하는 `MinioStore` 단위 테스트(fake client)를 추가함.

---

## HIGH

### H-1 (C1) `--max-cost-usd`가 전체 평가가 아니라 generation(케이스)마다 새로 계산됨
- 위치: `services/agent-server/src/drivers/gemini.ts:40`, `:53`, `:110-115`, `evals/runner.mjs:48`
- 원인: `metrics.costUsd`는 `run()`을 호출할 때마다 0에서 시작함. 러너는 드라이버 인스턴스 하나에 `maxCostUsd: maxCost`를 넘겨서 모든 케이스에 재사용함. Claude 경로가 쓰는 전역 `report.costReservedUsd` 누적(runner.mjs:31-32)은 Gemini 경로에 없음.
- 실패 시나리오: `--max-cost-usd 1 --repeat 3`에 케이스가 6개면 최대 18 USD를 쓸 수 있음. 결과 JSON의 `costReservedUsd`는 0으로 남아서 비용 추정이 틀리게 기록됨. 명세의 "초과 전에 중단"을 어김.
- 권고 수정: 러너에서 `fetcher` 래퍼나 `reserve` 콜백을 주입해 `report.costReservedUsd`를 전역으로 누적하고 한도를 검사함(Claude 경로와 같은 방식). 아니면 드라이버에 공유 budget 객체를 넘김. "여러 run에 걸친 누적 한도" 테스트를 추가함.

### H-2 (C1) 함수 선언 `parameters`에 전체 JSON Schema를 넣음 → Gemini 400 가능성 (unverifiable)
- 위치: `gemini.ts:42`
- 내용: `betaZodTool`의 `input_schema`가 그대로 들어감. 확인해 보니 `"$schema":"https://json-schema.org/draft/2020-12/schema"`, `additionalProperties:false`가 있고, `request_packages`에는 `$defs`, `$ref`, `propertyNames`까지 들어 있음. Google 공식 문서(https://ai.google.dev/gemini-api/docs/function-calling)는 `parameters`에 대해 "Only a subset of the OpenAPI schema is supported."라고 적고 있음.
- 실패 시나리오: 실제 호출 첫 턴부터 HTTP 400(`Unknown name "$schema"` 같은 오류) → 모든 generation이 `Gemini API error (HTTP 400)`로 실패. fake fetch 테스트는 요청 본문 스키마를 검사하지 않아서 이 문제를 잡지 못함.
- 권고 수정: JSON Schema를 그대로 받는 `parametersJsonSchema` 필드로 보내거나(필드 지원 여부는 문서로 확인 필요), `$schema`·`$defs`·`$ref`를 풀고 지원하지 않는 키워드를 제거한 OpenAPI subset으로 변환함. 코디네이터가 승인하는 실호출 스모크에서 가장 먼저 확인할 항목.

### H-3 (A2) 타임아웃이 `Promise.race`뿐이라 실제 MinIO 요청·스트림을 끊지 않음
- 위치: `services/deps-builder/src/security.ts:19-26`, `store.ts:23`, `:28`
- 실패 시나리오: 무응답 MinIO에서 `get`이 10초 뒤 `storage_unavailable`로 끝나도 `getObject` HTTP 요청과 소켓은 계속 살아 있음. 나중에 응답이 오면 `get` 내부 루프가 본문 전체를 `chunks`에 계속 쌓음(아무도 쓰지 않는 메모리). `stream()`이 늦게 resolve되면 반환된 `Readable`은 소비·파기되지 않아 소켓이 풀에 반납되지 않음. 장애가 이어지면서 재시도가 몰리면 소켓과 메모리가 계속 쌓임. 업로드도 타임아웃 뒤 실제 PUT이 계속 진행됨(콘텐츠 주소 키라 결과 오염은 없지만 부하는 남음).
- 권고 수정: `storageOperation`이 `AbortSignal`을 받아 operation에 넘기고, 타임아웃에서 abort하게 함. minio 클라이언트가 signal을 지원하지 않으면 늦게 resolve된 stream을 `.destroy()`하는 후처리를 붙임(`race`에서 진 쪽 promise에 `.then(s => s.destroy?.())`). `get`의 본문 수집 루프도 타임아웃 뒤에는 중단함.

---

## MEDIUM

### M-1 (C1) 사고(thinking) 토큰이 비용·metrics에서 빠짐
- 위치: `gemini.ts:72-73`
- 내용: `promptTokenCount`와 `candidatesTokenCount`만 더함. 공식 API 참조(https://ai.google.dev/api/generate-content)의 `UsageMetadata`에는 `thoughtsTokenCount`("Number of tokens of thoughts for thinking models"), `toolUsePromptTokenCount`가 따로 있음. 2.5/3 계열 Flash는 기본으로 thinking을 쓰고, thinking은 출력 단가로 과금되는 것으로 알려져 있음(과금 포함 여부는 문서에 명시가 없어 unverifiable).
- 실패 시나리오: 실제 비용보다 `costUsd`가 작게 기록됨 → 다음 턴 예약 `metrics.costUsd + reserve`가 작게 잡혀 한도를 넘길 수 있음. 평가 결과의 비용 추정도 과소함.
- 권고 수정: `outputTokens += candidatesTokenCount + thoughtsTokenCount`, `inputTokens += toolUsePromptTokenCount`를 반영하거나 `totalTokenCount`를 보수적으로 사용함. metrics에 `thoughtsTokens`를 따로 기록함.

### M-2 (C1) 병렬 functionCall 응답을 별도 user 턴 여러 개로 보냄 (unverifiable)
- 위치: `gemini.ts:78-95`, 특히 `:88`, `:93`
- 실패 시나리오: 모델이 한 턴에 functionCall 두 개 이상을 내면 functionResponse마다 `{role:'user'}` Content를 새로 push함. Gemini는 보통 호출 수와 같은 개수의 functionResponse part를 **한 Content**에 담기를 기대함. 연속 user 턴이나 개수 불일치는 400을 낼 수 있음. 공식 문서에서 이 형식을 명시한 부분은 찾지 못했음.
- 권고 수정: 한 모델 턴의 응답 part를 모아 `{ role: 'user', parts: [...functionResponses] }` 하나로 push함. 병렬 호출 fake 테스트를 추가함.

### M-3 (C1) 결과 JSON·Markdown·로그 redaction 테스트가 러너 쪽에 없음
- 위치: `evals/runner.mjs` (테스트 없음), `services/agent-server/tests/drivers/gemini.test.ts`
- 내용: 명세는 "결과 JSON·Markdown·로그·오류 메시지에서 키가 나오지 않도록 redaction 테스트"를 요구함. 지금 테스트는 드라이버의 URL·헤더·요청 본문·이벤트만 봄. 러너 결과 파일, `report.error`, 콘솔 출력, 비-HTTP 오류 경로(`Gemini connection failed`)는 검사하지 않음. 코드를 읽어 본 바로는 러너가 키를 결과에 쓰는 경로를 찾지 못했음. 다만 `report.error = error.message`(runner.mjs 하위)는 하위 오류 메시지를 그대로 저장하니 회귀를 막을 테스트가 필요함.
- 명세의 "키 없이 `node evals/run.mjs --driver gemini` → SKIP 저장": 코드상 `runner.mjs:45`에서 SKIP하고 저장하는 것은 확인함. 실행은 쓰기 금지 범위라 **unverifiable**.
- 권고 수정: `summary(report)`와 `JSON.stringify(report)`에 키 문자열이 없는지 확인하는 러너 단위 테스트를 추가함(fake env 키, results 경로는 임시 디렉터리로 주입).

### M-4 (A1) `upstream.ok` 검사보다 본문 읽기를 먼저 해서 기존 오류 코드와 지연이 바뀜
- 위치: `services/policy-proxy/src/server.ts:105-107`
- 실패 시나리오: (a) upstream이 404/403과 함께 상한을 넘는 본문(또는 큰 Content-Length)을 보내면 기존의 `404 UPSTREAM_REJECTED` 대신 `502 UPSTREAM_TOO_LARGE`가 됨. (b) upstream이 오류 헤더는 즉시 보내고 본문을 천천히 보내면, 기존에는 바로 `UPSTREAM_REJECTED`였지만 이제 5초 타임아웃 뒤 `502 UPSTREAM_UNAVAILABLE`이 됨. "오류 코드는 바꾸지 않는다" 제약을 어김.
- 권고 수정: `fetch` 직후 `!upstream.ok`이면 `upstreamAbort.abort()`(또는 `body.cancel()`) 후 `UPSTREAM_REJECTED`를 던지고, 성공 응답에만 `upstreamBody`를 호출함.

### M-5 (A1) JSON 파싱 실패 오류 코드가 `UPSTREAM_UNAVAILABLE` → `UPSTREAM_RESPONSE_INVALID`로 바뀜
- 위치: `server.ts:115`
- 내용: 기존에는 `upstream.json()` 예외가 HttpError가 아니어서 `502 UPSTREAM_UNAVAILABLE`로 감사됐음. 상태 코드는 같지만 응답 `error`와 감사 `denyReason`이 달라짐. 의미상으로는 개선이지만 명세 제약(오류 코드 불변)과 충돌함. 이 코드를 기대하는 대시보드·E2E가 있는지 확인이 필요함(unverifiable).
- 권고 수정: 기존 코드를 유지하거나, 코디네이터 승인을 받고 README·계약 문서에 변경을 기록함.

### M-6 (A2) 스트리밍 에셋 본문에는 타임아웃이 없음
- 위치: `store.ts:28`, `services/deps-builder/src/server.ts:39-40`
- 실패 시나리오: `getObject`가 헤더만 제때 주고 본문을 멈추면 `pipeline(stream, res)`가 끝없이 대기함. 클라이언트 연결과 MinIO 소켓이 계속 점유됨. 이번 명세 범위(조회·업로드)의 경계에 있는 문제.
- 권고 수정: 스트림 idle 타임아웃(데이터 없이 N초가 지나면 `destroy`)을 두거나 README에 한계로 명시함.

---

## LOW

### L-1 (A2) 타임아웃 env 값이 너무 크면 1ms 타임아웃이 됨
- 위치: `services/deps-builder/src/config.ts:17-23`
- 시나리오: `DEPS_BUILDER_STORAGE_PUT_TIMEOUT_MS=9999999999`처럼 2^31-1보다 큰 값이면 Node가 `TimeoutOverflowWarning`을 내고 1ms로 설정함 → 모든 저장 작업이 즉시 `storage_unavailable`. 잘못된 값(`abc`)은 경고 없이 기본값으로 대체됨.
- 권고: 정수 범위 `1..2147483647`을 검사하고, 잘못된 값이면 기동 시 실패시킴(A1의 설정 방식과 맞춤).

### L-2 (A2) `finally` 밖의 `installed.cleanup()` 호출은 여전히 보호되지 않음
- 위치: `builder.ts:75`, `:91`, `:94`, `:95`, `:98`
- 시나리오: 기존 빌드와 겹치는 경로에서 cleanup이 throw하면, 이미 준비된(ready) 상태를 반환해야 할 요청이 실패함. 명세는 `finally`만 요구했으니 범위 밖이지만 같은 종류의 문제임.
- 권고: 같은 `try/catch + log` 헬퍼로 통일함.

### L-3 (A1) HEAD 요청에서 Content-Length만 보고 거부할 수 있음
- 위치: `server.ts:54-55`
- 시나리오: HEAD 응답의 Content-Length는 실제 본문이 없어도 GET 기준 크기를 담음 → 큰 리소스의 HEAD가 `UPSTREAM_TOO_LARGE`가 됨. 기존에도 HEAD는 JSON 파싱에 실패했으니 실질 회귀는 작음.
- 권고: `method === 'HEAD'`이면 본문 읽기와 크기 검사를 건너뜀.

### L-4 (A1) 테스트가 "본문을 읽기 전에 거부"를 실제로 검증하지 않음
- 위치: `services/policy-proxy/test/hardening.test.ts` A1 테스트
- 내용: Content-Length 케이스는 본문이 28바이트뿐이라 스트리밍 검사로도 같은 결과가 나옴. upstream이 헤더만 보내고 본문을 보내지 않는 케이스(즉시 502, 5초 대기 없음)를 넣어야 사전 거부가 증명됨. 거부 감사에 본문 조각이 없다는 단언도 없음.
- 권고: 헤더 `Content-Length: 1e9` + 본문 미전송 upstream에서 응답 시간이 짧은지 확인하고, 감사 레코드에 본문 문자열이 없는지 단언함.

### L-5 (C1) 기본 모델 `gemini-2.5-flash`의 적절성 (unverifiable)
- 위치: `gemini.ts:6`, `runner.mjs:16`, `.env.example`, `services/agent-server/README.md:110`
- 내용: 2026-09 기준 공식 모델 페이지(https://ai.google.dev/gemini-api/docs/models)와 function calling 문서 예제는 3.x Flash(`gemini-3.8-flash` 등)를 주로 쓰고, 2.5 Flash도 여전히 stable로 표시됨. 이 내용은 요약 도구로 조회한 것이라 정확한 목록과 지원 종료 일정은 deprecations 페이지로 직접 확인해야 함. 기본값이 드라이버와 러너 두 곳에 중복돼 있음.
- 권고: 코디네이터가 모델을 확정하고, 기본값은 드라이버에서 export한 상수 하나를 러너가 import해서 씀.

### L-6 (C1) `AGENT_MODE=gemini` 서버 모드에는 시간 상한·비용 상한이 없음
- 위치: `services/agent-server/src/main.ts:9`
- 시나리오: `new GeminiDriver()`는 `maxDurationMs`·`maxCostUsd`를 넘기지 않음 → Gemini 요청이 멈추면 사용자가 취소할 때까지 generation이 걸려 있음. 평가에서만 한도가 적용됨. Ollama 드라이버도 같은 상태라 "기존 드라이버와 동일"로 볼 수는 있음.
- 권고: `GEMINI_TIMEOUT_MS` 같은 기본 요청 타임아웃(예: 요청당 120초)을 둠.

### L-7 (C1) 기타 작은 문제
- `gemini.ts:66`: 케이스 타임아웃이 `response.json()` 도중에 발생하면 "timed out"이 아니라 `Gemini returned invalid JSON`으로 분류됨. 원인이 뒤바뀐 메시지.
- `gemini.ts:74`: `finishReason`은 provider가 준 문자열을 그대로 오류 메시지에 넣음. 키가 섞일 경로는 없지만 길이 제한과 허용 목록을 두는 편이 안전함.
- `runner.mjs:16`, `:52`: 스코어러·환경 모듈을 동적 import로 옮기면서 SKIP 결과의 `selfTest`가 모든 드라이버(claude/local 포함)에서 `null`이 됨. 기존 결과 형식이 바뀐 것.
- `scripts/dev-up.test.mjs`: `GEMINI_API_KEY`가 agent-server에만 가고 다른 서비스에는 가지 않는다는 단언이 없음. allowlist 코드(`service-env.mjs:8`)는 올바름.

---

## 명세 충족 체크

### W6-A1
| 항목 | 판정 |
|---|---|
| 스트림 누적 상한 초과 시 abort + `502 UPSTREAM_TOO_LARGE` | 충족 (`server.ts:59-64`) |
| Content-Length 사전 거부 | 충족. 테스트 증명은 약함(L-4) |
| 기본 5 MiB, `POLICY_MAX_UPSTREAM_BYTES`, 잘못된 값이면 기동 실패 | 충족 (`config.ts:32-33`, 테스트 있음) |
| 거부를 deny로 감사, 본문 미포함 | 충족 (catch → `denyReason`) |
| sanitize 중복 제거 | 충족. 성공 경로에서 응답 sanitize는 1회(`send(..., true)`), 다운로드 입력에만 별도 적용 |
| 기존 오류 코드 불변 | **위반 소지** (M-4, M-5) |
| 마스킹·권한·감사 순서 회귀 | 발견 없음. 권한 검사 순서는 변경 없음, 타임아웃 5초 유지 |
| API 키·토큰 누출 | 발견 없음 (`X-Service-Token`은 헤더에만, 오류 본문은 코드 문자열뿐) |

### W6-A2
| 항목 | 판정 |
|---|---|
| `builds.delete`를 cleanup보다 먼저, cleanup 실패는 로그만 | 충족 (`builder.ts:123-126`) |
| 조회 10초 / 업로드 60초 타임아웃, env 조정, `storage` 분류 | 충족. 다만 **MinioStore 회귀(C-1)**, 작업 미중단(H-3), env 검증 약함(L-1) |
| 타임아웃 후 재요청이 새 빌드로 진행 | fake store에서는 충족(테스트 통과). 실제 MinIO에서는 C-1 때문에 unverifiable |
| manifest-last·해시 재검증·single-flight 유지 | 코드상 변경 없음, single-flight 테스트 통과 |

### W6-C1
| 항목 | 판정 |
|---|---|
| `AgentDriver` 구현, 같은 도구 집합, `SYSTEM_PROMPT` 사용 | 충족 (`createTools` 재사용). 스키마 호환성은 H-2 |
| `x-goog-api-key` 헤더만 사용, `?key=` 없음 | 충족 (테스트로 URL·search·본문 확인) |
| 취소·턴 상한·케이스 시간 상한·429/5xx 분류 | 충족(모두 `model_error`). 서버 모드 시간 상한은 L-6 |
| 토큰 metrics | 부분 충족 (thinking 토큰 누락, M-1) |
| mode `'gemini'`, `AGENT_MODE=gemini` | 충족 (`engine.ts:17`, `main.ts:8-9`). 계약 변경은 주석 한 줄 |
| `--driver gemini`, 키 없으면 SKIP | 코드상 충족. 실행은 unverifiable |
| `--max-cost-usd` 단가 env 기반 사전 중단 | **미충족** (H-1, 케이스마다 초기화) |
| `GEMINI_API_KEY`를 agent-server에만 전달, `.env.example` 빈 값 | 충족 (`service-env.mjs`, 두 `.env.example`) |
| redaction 테스트(결과 JSON·Markdown·로그) | 부분 충족 (M-3) |
| 스트림 abort 누락 | 해당 없음: 비스트리밍 `generateContent`, 오류 응답은 `body.cancel()` 처리(`gemini.ts:64`) |
| 실제 API 미호출, fake fetch | 충족 |

## 우선 조치 권고
1. C-1 수정과 MinioStore NoSuchKey 단위 테스트 추가 (A2 머지 차단 사유)
2. H-1 전역 비용 누적 (Gemini 실호출 승인 전 필수)
3. H-2 스키마 변환: 실호출 스모크 전 필수
4. H-3 타임아웃 시 실제 작업 중단 또는 늦게 온 stream 파기
5. M-4 `ok` 검사 순서를 원래대로 복원
