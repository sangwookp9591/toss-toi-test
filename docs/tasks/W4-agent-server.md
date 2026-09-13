# W4: 채팅 에이전트 서버 (services/agent-server)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 만들 곳: `services/agent-server/`
- 반드시 읽을 것: `docs/ARCHITECTURE.md`, `contracts/src/generation.ts`, `contracts/src/package-set.ts`, `contracts/src/policy.ts`, `contracts/src/runtime.ts`, `intent/INTENT.md`
- 참고: `astra-critique.md` §5 E(Backend 경합 설계와 상태 전이 표)

## Change
1. **`contracts/src/generation.ts` HTTP API 구현** (Node 22 + TypeScript, 포트 7400)
   - 프로젝트 저장: 파일 기반(`data/`, gitignore). `PUT /projects/:id/source`는 `baseRevision` CAS, 불일치 409.
   - 템플릿: `POST /projects`가 `/src/main.tsx`(createRoot + App), `/src/App.tsx`, `/src/api.ts`(`@toi/fetch` 사용 예)로 revision 1 생성. 기본 packageSet은 react 19, react-dom/client, react/jsx-runtime, @tanstack/react-query, @toi/tds, @toi/fetch.
   - generation: `requestId` 멱등. 상태 전이 `requested → staging → (awaiting_answer ↔ staging) → revision_ready → done` / `failed` / `canceled`.
   - SSE: 이벤트마다 `id: seq`. 이벤트를 generation별로 메모리+파일에 보관하고 `Last-Event-ID`로 replay. 종결 이벤트 뒤 스트림 종료. keep-alive 주석 15초.
   - cancel: 진행 중인 모델 호출 abort, 이후 도구 결과·저장·이벤트 전송 금지, `canceled` 종결.
   - finish: staging 파일을 `baseRevision` CAS로 저장 → 성공 시 `revision_ready`(새 revision, sourceDigest — `packages/preview-runtime`과 같은 정규화 규칙을 쓰도록 `contracts`의 설명을 따르고, 구현 함수는 이 서비스에 복제하되 테스트로 동일 입력 동일 digest 확인) → `done`. 충돌이면 `failed{code:"conflict"}`.
2. **에이전트 (Claude 모드)**
   - `@anthropic-ai/sdk` 최신, 모델 `claude-opus-5`, `thinking: { type: "adaptive" }`, `max_tokens` 64000, 스트리밍 tool runner:
     `client.beta.messages.toolRunner({ model, max_tokens, tools, messages, stream: true })` + `betaZodTool`(`@anthropic-ai/sdk/helpers/beta/zod`, zod). 바깥 루프는 iteration, 안쪽 루프에서 `content_block_delta`의 `text_delta`를 SSE `text`로 전달. 각 iteration은 `await stream.finalMessage()`로 `stop_reason`을 확인하고 `pause_turn`이면 `runner.pushMessages({ role: "assistant", content })`로 재개.
   - refusal 대비: `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`를 요청에 포함하고, `stop_reason === "refusal"`이면 `failed{code:"model_error"}`. SDK 타입이 이 필드를 받지 않으면 SDK 문서/소스를 확인하고 근거를 README에 적는다(추측 금지).
   - 도구(계약 목록): `list_registered_apis`·`get_api_schema`는 policy-proxy `GET /apis`, `GET /apis/:apiId`(서비스 세션으로) 호출. `write_file` 경로는 `/src/` 아래만 허용. `request_packages`는 허용 카탈로그(react, react-dom, @tanstack/react-query, @toi/tds, @toi/fetch, zod, date-fns) 밖이면 도구 오류. `ask_user`는 answers 도착까지 대기(취소되면 즉시 종료).
   - 시스템 프롬프트(상수 파일, 캐시 친화적으로 고정): 데이터는 `@toi/fetch`의 `toiFetch(apiId, path)`로만, 조회 사유 입력 UI 필수(requireReason API), `@toi/tds` 컴포넌트 우선, packageSet.entries 밖 import 금지, 파일은 `/src/` 아래, 마지막에 `finish` 호출.
   - 오류 처리: SDK 타입 예외(`Anthropic.RateLimitError`, `Anthropic.APIError` 등)를 구체적인 것부터 분기. 문자열 매칭 금지.
3. **mock 모드**: `AGENT_MODE=mock`이거나 `auto`에서 자격증명 해석이 실패하면(첫 호출의 인증 오류 포함) 결정적 생성기로 동작. 프롬프트 키워드(예: "고객 목록", "상세", "상태 변경")에 따라 미리 준비한 파일 세트를 `text` 조각 → `question`(예: "조회 사유 기본값을 넣을까요?") → `file` 이벤트 순서로 스트리밍. 이벤트 형태는 Claude 모드와 완전히 같다. `/healthz`의 `agentMode`로 노출.
4. **테스트** (vitest)
   - CAS: 같은 baseRevision 동시 저장 2건 중 1건만 성공.
   - 멱등: 같은 requestId 두 번 → 같은 generationId.
   - SSE replay: 중간에 끊고 Last-Event-ID로 재연결 시 누락·중복 없음.
   - cancel 후 늦게 끝난 도구 결과가 저장·전송되지 않음.
   - ask_user ↔ answers 왕복.
   - mock 모드 E2E: 생성 → revision_ready → 저장된 파일이 packageSet 밖 import를 쓰지 않음(정적 검사).
   - Claude 모드는 네트워크 없이 도는 테스트로 SDK 스트림을 fake로 대체(도구 호출 → 파일 이벤트 변환 검증). 실제 API 호출 테스트는 `RUN_LIVE_CLAUDE=1`일 때만.
5. **자격증명 확인**: 환경에서 `ANTHROPIC_API_KEY` 등 SDK 기본 해석이 되는지 한 번만 확인하고, 없으면 mock으로 검증을 끝낸 뒤 README에 "실제 모드 실행 방법"을 적는다. 사용자에게 키를 요구하지 않는다.

## Constraints
- `services/agent-server/**` 밖 수정 금지. `contracts/`는 읽기 전용(어긋나면 ask). 비밀은 `.env`.
- 전역 설치 금지, git commit 금지. 포트 7400. policy-proxy(7200)는 W3가 병렬로 만든다 — 테스트에서는 fake 레지스트리 서버로 대체하고, W3 산출물이 있으면 통합 확인을 추가한다.

## Ownership
- 편집 가능: `services/agent-server/**`

## Observable acceptance
- `npm test`, `npm run typecheck` 통과, 요약을 README에.
- mock 모드에서 `curl -N` SSE로 생성 전체 흐름(state → text → question → answers → file → revision_ready → done) 확인 로그를 README에.
- README: 상태 전이, 이벤트 계약, CAS·replay·cancel 보장 범위, Claude 모드 설정, 한계.
