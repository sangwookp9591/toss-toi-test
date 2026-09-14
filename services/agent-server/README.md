# TOI agent server

`contracts/src/generation.ts`의 프로젝트 소스 저장과 채팅 생성 API를 구현합니다. Node 22 단일 프로세스가 파일 저장 CAS와 generation 상태를 관리하고, 모델 출력은 staging에 쌓아 `finish`에서만 새 소스 revision으로 저장합니다. 포트는 **7400**입니다.

## 실행

```sh
cd services/agent-server
npm ci
AGENT_MODE=mock npm start
# GET http://localhost:7400/healthz -> {"ok":true,"agentMode":"mock"}
```

`npm run dev`는 소스 watch 모드입니다. 선택 설정은 `.env.example`을 참고해 이 서비스의 `.env`에 둡니다. `data/`, `.env`, `node_modules/`는 gitignore됩니다. 다른 서비스나 루트 lockfile에 의존하지 않습니다. 데이터 위치는 `DATA_DIR`, 정책 서버 위치는 `POLICY_PROXY_URL`(기본 `http://localhost:7200`)로 설정합니다.

환경 자격증명은 SDK의 기본 해석을 한 번 확인했고 사용 가능한 인증을 얻지 못하여 **mock 모드로 검증**했습니다. 실제 Claude 메시지 API는 호출하지 않았습니다. 확인 시각/방법만 [`evidence/credentials.json`](evidence/credentials.json)에 기록했으며 값·토큰·헤더는 출력하지 않았습니다. SDK 생성자는 자격증명이 없어도 성공하고 첫 요청까지 검증을 미루므로, 단순 생성자 성공을 인증 가능으로 취급하지 않습니다.

## HTTP 계약

| API | 결과 |
| --- | --- |
| `POST /projects {name,apiIds}` | 템플릿 파일, 기본 packageSet, revision 1인 Project / 201 |
| `GET /projects/:id` | Project / 200 |
| `PUT /projects/:id/source {baseRevision,files,packageSet?}` | 전체 source 교체 + revision 증가 / 200, 충돌 / 409 |
| `POST /generations {projectId,prompt,baseRevision,requestId}` | `{generationId}` / 202; 동일 입력·requestId는 같은 ID |
| `GET /generations/:id/events` | SSE, `Last-Event-ID` 이후 replay |
| `POST /generations/:id/answers {questionId,answer}` | 대기 중인 질문에 응답 / 204; 없거나 다른 질문 / 409 |
| `POST /generations/:id/cancel` | 취소 / 204; 이미 종결됐으면 무해한 no-op |
| `GET /healthz` | `{ok:true,agentMode:"claude"|"mock"|"local"|"gemini"}` |

CAS 충돌 응답은 `{error:"conflict",currentRevision}`입니다. 같은 requestId를 다른 내용에 재사용하면 409입니다. requestId는 이 서비스 전체에서 유일하게 사용합니다. 잘못된 입력/경로/카탈로그는 400, 없는 리소스는 404입니다. HTTP body는 2MiB로 제한합니다. studio origin 5273에 CORS를 허용합니다.

프로젝트에는 `/src/main.tsx`(createRoot + App), `/src/App.tsx`, `/src/api.ts`가 생성됩니다. 기본 exact entries는 `react`, `react-dom/client`, `react/jsx-runtime`, `@tanstack/react-query`, `@toi/tds`, `@toi/fetch`이며 React/ReactDOM 19.3.0, 사내 fixture 패키지 1.0.0을 사용합니다. React Query는 `^5.0.0`이고 실제 의존성 lock/manifest는 deps-builder가 만듭니다.

## 상태 전이와 이벤트

```text
requested -> staging -> awaiting_answer -> staging -> revision_ready -> done
                 |            |             |
                 +------------+-------------+----> failed / canceled
```

`awaiting_answer ↔ staging`은 여러 질문에 대해 반복할 수 있으며 한 시점에 질문은 하나만 대기합니다. 상태 변경은 `state` 이벤트로 나갑니다. 사용자에게 보이는 종결 이벤트는 `done`, `failed`, `canceled`이고 해당 이벤트 이후 SSE 연결을 닫습니다. 상태가 `done`이라는 state 이벤트만으로 연결을 먼저 닫지는 않습니다.

각 이벤트는 계약 그대로 `{seq,generationId,type,...}`이며 SSE 인코딩은 다음과 같습니다.

```text
id: 6
event: question
data: {"seq":6,"generationId":"...","type":"question","questionId":"...","question":"조회 사유 기본값을 넣을까요?","options":["예","아니요"]}
```

`text.delta`, `file.path/content`, `file_deleted.path`, `packages_requested.packageSet`, `revision_ready.revision/sourceDigest/files/packageSet`, `failed.message/code`, `done.summary`를 지원합니다. revision_ready 전에 `finish`가 staging 파일을 baseRevision CAS로 저장합니다. 저장 충돌은 `failed{code:"conflict"}`로 종결하고 최신 프로젝트를 덮어쓰지 않습니다. 이 처리는 SDK가 finish 도구 오류를 잡아 재시도하는 경우에도 종결 상태를 먼저 기록합니다.

## CAS·replay·cancel 보장 범위

- **CAS:** 비교와 파일 교체 사이에 await가 없는 단일 프로세스 임계 구간입니다. 같은 baseRevision의 동시 HTTP 저장 2건은 정확히 1건만 성공합니다. 완성한 JSON을 동일 디렉터리 임시 파일에 기록하고 rename한 뒤 메모리 값을 갱신합니다.
- **소스 digest:** runtime의 POSIX 경로 정규화와 재귀 object-key 정렬 JSON + SHA-256 규칙을 이 서비스에 독립 구현했습니다. 배열 순서는 보존합니다. 테스트에서 preview-runtime의 실제 `sourceDigest()`와 같은 소스·한글·경로 정규화 입력의 결과를 비교합니다. 런타임 구현은 테스트에서만 읽고 서비스 코드에서는 가져오지 않습니다.
- **replay:** generation별 메모리 + `data/generations/:id.json`의 이벤트 배열에 연속 seq를 보관합니다. 파일 기록 후 live subscriber에게 전달합니다. replay와 구독 등록 사이에는 비동기 양보가 없어 연결 경계의 누락을 막습니다. 완료된 generation도 재접속할 수 있습니다. 클라이언트는 마지막 처리 seq를 `Last-Event-ID`로 보내고 중복 처리를 피해야 합니다. 15초마다 keep-alive 주석을 보냅니다.
- **재시작:** 완료된 소스·이벤트·requestId를 복구합니다. 실행 중이던 모델/질문은 재개하지 않으며 `failed{code:"internal"}`을 추가해 종결합니다. 같은 requestId는 이 실패 generation을 반환하므로 재시도에는 새 requestId를 씁니다.
- **cancel:** 먼저 canceled 상태와 종결 이벤트를 기록한 다음 AbortController로 SDK/HTTP/질문 대기를 중단합니다. 모든 도구는 실행 전과 외부 await 후 active 상태를 확인합니다. 따라서 abort를 무시한 외부 도구가 늦게 반환하거나 모델이 늦게 write/finish를 호출해도 파일·revision·이벤트를 더 남기지 못합니다. 취소가 끝난 작업의 외부 부작용을 되돌린다는 뜻은 아닙니다.

위 보장은 한 Node 프로세스와 정상 파일시스템을 전제로 합니다. 여러 프로세스의 공유 data 디렉터리에는 분산 lock/CAS가 없으므로 지원하지 않습니다. rename은 파일 단위 원자성이고 power-loss fsync 또는 프로젝트+이벤트 파일을 묶은 데이터베이스 transaction은 아닙니다. CAS 저장 직후 이벤트 기록 전 프로세스가 죽으면 프로젝트 revision이 저장됐어도 해당 실행은 재시작 시 실패로 나타날 수 있습니다. 클라이언트는 프로젝트를 다시 GET해 확인해야 합니다.

## Claude 모드

```sh
# .env에 ANTHROPIC_API_KEY를 설정하거나 SDK가 지원하는 인증을 구성
AGENT_MODE=claude npm start
# auto: 시작 시 인증 해석 불가 또는 첫 모델 요청의 AuthenticationError -> mock
AGENT_MODE=auto npm start
```

`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` 및 SDK 기본 profile/config credential chain을 사용합니다. `CredentialClient`는 SDK의 protected `authHeaders`/`validateHeaders`를 감싼 작은 어댑터로 startup에 한 번 실제 해석 가능 여부를 확인합니다. 이는 고정 SDK 소스에 맞춘 구현이고 SDK 업그레이드 시 재검증해야 합니다. 명시적 claude 모드의 인증 부재는 시작 오류이며 auto 모드는 mock으로 내려갑니다. 첫 모델 응답이 시작된 뒤의 오류에 mock 출력을 섞지 않습니다. 키를 요청하거나 실제 API를 자동 호출하는 테스트는 없습니다.

고정 의존성은 `@anthropic-ai/sdk@0.125.0`(2026-09-13 npm 최신 안정 확인), `zod@4.6.4`입니다. 요청은 다음 설정을 사용합니다.

```ts
client.beta.messages.toolRunner({
  model: 'claude-opus-5',
  max_tokens: 64000,
  thinking: { type: 'adaptive' },
  stream: true,
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  tools, messages,
  // 고정 system text + cache_control: ephemeral
}, { signal });
```

바깥 루프에서 iteration stream, 안쪽 루프에서 `content_block_delta/text_delta`를 받아 SSE text로 내보냅니다. 각 iteration 뒤 `stream.finalMessage()`를 await하며, `pause_turn`이면 받은 assistant content를 그대로 `runner.pushMessages()`에 전달합니다. `refusal`이면 model_error입니다. `betaZodTool`은 `@anthropic-ai/sdk/helpers/beta/zod`에서 가져옵니다. RateLimitError → AuthenticationError/PermissionDeniedError → timeout/abort/connection → APIError → AnthropicError 순으로 타입 판정하며 오류 메시지 문자열로 종류를 추측하지 않습니다. 사용자 이벤트에는 provider 응답 본문이나 인증 정보를 넣지 않습니다.

SDK 0.125.0은 이미 `BetaFallbacksParam = Array<BetaFallbackParam> | 'default'`를 타입으로 지원하고 `MessageCreateParamsBase.fallbacks` 필드가 있습니다. 따라서 any cast나 요청 외부 JSON 우회가 필요하지 않습니다. 확인한 로컬 소스는 `node_modules/@anthropic-ai/sdk/src/resources/beta/messages/messages.ts`의 `BetaFallbacksParam`/`fallbacks`, `src/lib/tools/BetaToolRunner.ts`의 스트림 반복·`pushMessages`·signal, `src/helpers/beta/zod.ts`의 `betaZodTool`입니다. 공식 근거: [tool runner](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner), [refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback).

`list_registered_apis`, `get_api_schema`, `list_files`, `read_file`, `write_file`, `delete_file`, `ask_user`, `request_packages`, `finish`를 제공합니다. write/delete/read 경로는 정규화된 `/src/` 아래만 허용합니다. 카탈로그는 react, react-dom, @tanstack/react-query, @toi/tds, @toi/fetch, zod, date-fns입니다. 카탈로그 밖 요청은 tool error이며 각 entry의 root package가 dependencies에 있어야 합니다. 시스템 프롬프트는 [`src/system-prompt.ts`](src/system-prompt.ts)의 고정 상수이고 프로젝트 정보는 user 메시지로 분리했습니다.

R1 M2 보강: 두 레지스트리 도구의 결과는 `{"untrusted_api_registry_data": ...}` JSON으로 감쌉니다. 고정 시스템 프롬프트는 도구 결과 안의 지시를 따르지 않고 데이터로만 취급하도록 명시합니다. description·schema·example의 내용은 시스템 프롬프트에 삽입하지 않습니다.

`finish`와 `PUT /projects/:id/source`는 저장 전에 모든 `/src/**` 파일을 공통 정적 검사합니다. raw `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, 모든 `http(s)://` 텍스트(허용 목록 없음), `/dev/session`·`/capabilities`·`/audit` 문자열, `__TOI_FETCH_CONFIG__` 대입 및 직접 속성 대입을 거부합니다. finish는 경로·이유가 담긴 tool error를 반환하여 모델이 수정할 수 있고 HTTP 저장은 400을 반환합니다. 거부된 소스는 저장하거나 revision_ready로 내보내지 않습니다. `@toi/fetch`의 `toiFetch`와 trusted host config 읽기는 허용합니다.

이 검사는 **보조 방어선**입니다. 보수적인 텍스트 검사이므로 주석·표시용 문자열도 거부될 수 있고, 문자열 연결·별칭·`globalThis['fe'+'tch']` 등 동적 우회를 완전 차단하지 못합니다. 실제 인증·데이터 접근·쓰기 경계는 **policy-proxy(F1)**가 매 요청에 적용하는 정책입니다. 정적 검사나 프롬프트를 보안 sandbox로 취급하지 않습니다.

## Gemini 모드

```sh
# GEMINI_API_KEY는 agent-server 프로세스에만 전달한다
AGENT_MODE=gemini GEMINI_API_KEY=... npm start
```

Gemini는 새 SDK 없이 `fetch`로 `generateContent` function calling을 사용하며 요청 헤더 `x-goog-api-key`로만 인증합니다. 기본 모델은 `gemini-3.8-flash`이며, 2026-09 현재 Google 공식 모델 문서에서 Stable·Function calling 지원, deprecations 문서에서 shutdown 미정으로 확인했습니다: [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/latest-model), [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations). `GEMINI_MODEL`로 변경할 수 있습니다. Function declaration은 공식 Generate Content API가 지원하는 `parametersJsonSchema` 필드를 사용하며, `toolConfig.functionCallingConfig.mode: ANY`로 선언된 도구 중 하나를 매 응답 호출하도록 요청합니다([Function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Generate Content API](https://ai.google.dev/api/generate-content)). 텍스트만 반환되는 예외 응답에는 `STOP`(또는 누락)일 때만 “작업을 계속하고 끝나면 finish 도구를 호출하라.”를 최대 2회 user 턴으로 재요청합니다. `MAX_TOKENS`·`SAFETY` 등 비-STOP 종료 사유의 기존 분류는 유지합니다. 요청에는 시스템 프롬프트와 기존 도구 집합을 그대로 사용하고, 취소·턴/요청 시간/비용 한도·429/5xx 분류·입출력·thinking 토큰 metrics를 적용합니다. `GEMINI_TIMEOUT_MS` 기본값은 요청당 120초입니다. 실제 Gemini 호출은 이 저장소 테스트에서 수행하지 않고 fake `fetch`만 사용합니다.

## 정책 프록시와 생성 UI 연결

레지스트리 도구는 Keycloak `toi-agent-server` client credentials로 받은 audience `toi-api` 액세스 토큰으로 GET `/apis`, `/apis/:apiId`를 호출합니다. 토큰은 메모리에 만료 전까지 캐시하고 401이면 한 번 새로 발급합니다. `TOI_AGENT_CLIENT_SECRET`은 dev-up이 루트 `.env`에 무작위 생성합니다. `/dev/session`은 제거했습니다. 토큰을 모델 도구 결과·SSE·프로젝트 소스에 넣지 않습니다.

템플릿의 `/src/api.ts`는 **trusted host**가 번들 실행 전에 넣은 `globalThis.__TOI_FETCH_CONFIG__`를 읽어 `configureToiFetch()`를 한 번 호출합니다. 필드는 projectId, env, transport: "broker"뿐이며 값이 없으면 명확한 오류를 던집니다. 이 global은 coordinator가 채택한 `BuildInput.hostConfig.toiFetch` → preview frame 주입 계약과 같습니다. 세션·capability와 Keycloak 토큰은 스튜디오 메모리에만 있고 frame에는 전달하지 않습니다. 생성 코드는 postMessage 브로커로 요청합니다. `toiFetch(apiId,path,{reason})`는 Response를 반환하므로 `.json()`을 await합니다. reason 옵션은 스튜디오 브로커가 UTF-8로 인코딩해 X-Toi-Reason으로 보냅니다. `@toi/fetch@1.1.1`의 `ToiAccessRevokedError`(404, PROJECT_NOT_FOUND)는 접근 오류로 표시하며 빈 결과로 처리하지 않습니다.

mock은 고객 목록·상세·상태 변경 키워드에 따라 서로 다른 결정적 App을 생성합니다. TDS의 실제 Button/TextField/Table export를 사용하고, 조회 사유 UI를 요구하며, 상태 변경은 쓰기 권한이 없는 기본 preview에서 비활성화해 둡니다. mock은 임의 API 스키마에 맞춘 범용 생성기가 아니라 고객 API fixture입니다. 실제 수정/저장·capability 승인 UX는 후속 studio 작업 범위입니다.

## 검증과 curl 로그

```sh
npm run typecheck
npm test
npm run smoke        # 7400이 비어 있어야 함; mock 서버 + 실제 curl --no-buffer + 자동 answers
npm run smoke:policy # 실행 중인 실제 :7200의 등록 API 도구 확인
# 실제 Claude 호출은 명시적으로만:
RUN_LIVE_CLAUDE=1 npm test -- tests/claude.test.ts
```

실행 결과(Node 22.14.0, 2026-09-13):

```text
npm run typecheck: tsc --noEmit — exit 0
vitest: Test Files 3 passed (3)
        Tests 37 passed | 1 skipped (38)
skip: live Claude test — RUN_LIVE_CLAUDE was not 1
npm run smoke: curl exit 0, answer HTTP 204, saved revision 2
npm run smoke:policy: live customers API, schemaVersion 1, requireReason true, done
```

네트워크 없는 Claude 테스트는 실제 Anthropic SDK의 fetch만 SSE fixture로 교체합니다. SDK가 betaZodTool을 실제 실행하고 파일/finish 이벤트가 만들어지는 것, 텍스트 스트림, pause_turn, refusal, auto 인증 fallback, SDK finish 중 CAS conflict를 검증합니다. 그 밖에 동시 CAS, requestId 멱등, SSE 끊김/replay, 늦은 도구 결과 취소, 질문/응답, 허용 import 정적 검사(esbuild parser), digest 동등성, 프로세스 재시작 이벤트 복구, 서비스 세션 401 갱신을 검증합니다.

R1 수정 후 기존 17개 + live skip 1개를 유지하고 20개를 추가했습니다. 금지 패턴 15개를 각각 HTTP 400·finish tool_error·revision 미변경으로 검증하고, 목록/상세/상태 변경 템플릿과 toiFetch/config 읽기의 통과를 확인했습니다. 인젝션 description fixture + 실제 SDK fake SSE 테스트는 두 도구의 JSON 래퍼, 고정 시스템 프롬프트, 악성 코드 finish의 `is_error` 응답 및 안전한 수정 후 단 한 번의 revision_ready를 확인합니다. 실제 모델의 인젝션 저항성을 측정한 테스트는 아닙니다.

수정한 7400 서비스를 `AGENT_MODE=mock`으로 재시작한 뒤 **“고객 목록 화면 만들어줘” → 답변 → revision_ready(revision 2) → done**을 실제 HTTP/SSE로 확인했습니다. 같은 프로젝트에 위험 소스를 PUT하면 이유를 포함한 400을 반환했습니다([R1 실서비스 증거](evidence/r1-mock-smoke.json)). 갱신한 레지스트리 래퍼를 소비하는 `npm run smoke:policy`도 실제 7200에서 통과했습니다. E2E가 저장하는 일반 JSX·지연 Promise·TDS/React 예제는 금지 패턴이 없으며 목록·상태 변경 생성은 검증한 mock 템플릿을 사용합니다. E2E의 iframe 보안 probe는 테스트 런너에서 실행되어 생성 소스 저장 검사 대상에 속하지 않습니다.

실제 `curl --no-buffer`(동일한 `curl -N` 옵션)의 출력에서 추출한 전체 흐름은 다음과 같습니다. answers는 별도 HTTP 요청입니다.

```text
1 state:requested
2 state:staging
3 text
4 text
5 state:awaiting_answer
6 question
POST answers -> 204
7 state:staging
8 file
9 state:revision_ready
10 revision_ready
11 state:done
12 done
```

SSE 원문(id/event/data 포함): [`evidence/mock-sse.log`](evidence/mock-sse.log). 요약: [`evidence/mock-smoke.json`](evidence/mock-smoke.json). W3 실제 연동: [`evidence/policy-integration.json`](evidence/policy-integration.json); Engine 도구에서 서비스 세션을 거쳐 `/apis`와 `/apis/customers`를 호출했고 응답에 upstreamBaseUrl이 없음을 확인했습니다.

## 남은 한계

모델 품질·실제 API 지연/요금·실제 server-side fallback 동작은 라이브 호출 없이 확인하지 않았습니다. 프롬프트의 exact import 규칙은 모델 생성에 대한 지침이며 모든 임의 코드의 정책 준수를 증명하지 않습니다. mock 산출물의 import와 구문은 정적으로 검사하지만 일반 Claude 출력에 타입 검사·브라우저 실행 성공 gate는 없습니다. 이후 preview-runtime이 별도로 검증합니다.

서비스는 로컬 개발용 API이며 사용자 인증·프로젝트 권한 분리·rate limiting·event retention/압축·SSE backpressure 제한은 구현하지 않았습니다. 파일 JSON snapshot은 작은 실험 규모를 위한 것으로 매 이벤트마다 다시 기록합니다. 모델 반복은 최대 50회이며 finish 없이 종료되면 model_error입니다. ask_user는 답이나 취소가 올 때까지 기다리며 별도 자동 timeout은 두지 않습니다. 프록시의 최종 데이터/쓰기 정책은 모델이나 이 서버가 대신 보장하지 않습니다.


## QA2: 다른 탭의 활성 생성 발견

`GET /projects/:projectId/generations/active`는 해당 프로젝트의 종결되지 않은 최신 생성에 대해 `ActiveGeneration` (`generationId`, `state`, `lastSeq`, 원래 사용자 `prompt`, ISO `createdAt`)을 반환한다. 프로젝트가 없거나 활성 생성이 없으면 404다. 최신 생성이 종결되었고 이전 생성이 진행 중이면 그 이전 생성을 반환한다. 생성 레코드의 request에 prompt를, createdAt에 시작 시각을 저장한다. 서버 재시작 시 미완료 생성은 기존 규칙대로 failed 처리하므로 활성 목록에서 제외된다.

F3b Origin 검사를 그대로 적용하여 정확한 studio Origin 또는 Origin 없는 서버 요청만 허용한다. preview Origin, null, 기타 Origin은 403이며 SSE와 동일하게 보호된다. 새 탭은 이 응답으로 사용자 요청을 복원하고 `Last-Event-ID` 없이 SSE 전체를 재생한다. 같은 generation의 어느 탭에서 답변해도 기존 `state: staging` 이벤트가 질문의 답변 완료를 알리고, 취소는 `state: canceled`와 `canceled` 이벤트가 모든 구독자에 전달된다. 스튜디오는 진행 중 생성 발견 시 새 생성 대신 해당 생성에 연결한다.

## P0-1 identity와 프로젝트 멤버십

모든 사용자 엔드포인트는 Keycloak `toi-studio` 사용자 액세스 토큰을 요구합니다. `jose@6.1.3`의 RS256 JWKS 검증으로 issuer·audience(`toi-api`)·서명·만료·필수 클레임을 검사합니다. `GET /healthz`와 OPTIONS는 공개이며 기존 정확한 Origin 및 JSON 규칙을 유지합니다. SSE도 Bearer 토큰을 요구하고 열려 있는 스트림은 매초 멤버십·액세스 토큰 만료를 확인해 종료합니다.

프로젝트 생성은 builder 역할과 그룹이 필요하고 생성자가 owner, 첫 그룹이 teamId가 됩니다. 멤버십은 `data/memberships/` 아래 원자적으로 저장하며 변경마다 version이 증가합니다. 기존 익명 프로젝트는 자동 귀속하지 않으므로 로그인 후 새 프로젝트를 만드세요.

| 역할 | 권한 |
|---|---|
| viewer | 프로젝트·활성 생성·이벤트·멤버십 열기, preview read |
| editor | viewer + 생성·답변·취소·소스 저장, preview write |
| owner | editor + 멤버 추가·변경·제거, live 쓰기 승인 요청 |

비멤버에게는 모든 프로젝트·생성 경로가 404를 반환합니다. realm role이나 같은 팀 그룹만으로 프로젝트에 접근할 수 없습니다. `GET /projects/:id/membership`은 멤버만, `PUT /projects/:id/members/:sub {role}`와 DELETE는 owner만 허용하며 마지막 owner의 제거·강등은 409입니다. `GET /projects/:id/users?username=bob`은 owner에게 Keycloak의 활성 사용자 `{sub,username}[]`를 돌려줍니다. 사용자 이름과 sub는 클라이언트 입력을 신뢰하지 않고 IdP에서 확인합니다. agent 서비스 계정에만 realm-management view-users 권한을 부여합니다.

`GET /internal/projects/:id/membership`은 Origin 없는 `toi-policy-proxy` 서비스 계정 토큰만 허용합니다. 일반 사용자, 다른 서비스 계정, azp만 서비스 이름인 사용자 토큰은 거부합니다. policy-proxy는 이를 매번 조회하므로 멤버 제거는 다음 proxy 요청부터 적용됩니다. Keycloak 계정 비활성화는 갱신 실패와 최대 5분 액세스 토큰 만료로 반영됩니다.

실제 로그인은 루트 `node scripts/dev-up.mjs` 후 스튜디오에서 합니다. alice/bob/carol/dana/root 비밀번호는 `.env`의 `TOI_PASSWORD_*` 값입니다. 테스트 헬퍼도 인증을 생략하지 않고 실제 RS256 서명과 HTTP JWKS를 사용하며 실제 Keycloak UI 로그인 검증은 e2e가 담당합니다.
