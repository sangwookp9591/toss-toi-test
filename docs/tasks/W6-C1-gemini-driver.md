# W6-C1: agent-server Gemini 드라이버와 평가 연결 (P0-4 잔여)

공통 제약: [`W6-common.md`](W6-common.md). **이 작업은 키를 다루므로 공통 제약의 비밀값 조항을 특히 지킨다.**

## Target
`services/agent-server/src/drivers/`(참고: `ollama.ts`, `../claude.ts`), `services/agent-server/src/main.ts`, `evals/runner.mjs`, `scripts/dev-up.mjs`의 서비스별 env allowlist, `.env.example`.

## Change
- `GeminiDriver`를 `AgentDriver` 인터페이스(`engine.ts:17`)로 구현한다. Gemini API의 function calling으로 기존 도구(`list_registered_apis`, `get_api_schema`, 파일 staging, 역질문, finish 등 Claude/Ollama 드라이버가 쓰는 같은 도구 집합)를 호출한다. 시스템 프롬프트는 `system-prompt.ts`를 그대로 쓴다.
- 인증은 `GEMINI_API_KEY` env, 요청 헤더 `x-goog-api-key`. **URL 쿼리 `?key=` 금지.** 모델은 `GEMINI_MODEL` env. 기본값은 Google 공식 문서(ai.google.dev)에서 2026-09 현재 function calling을 지원하는 안정 Flash 모델 ID를 확인해 정하고, 확인한 문서 URL을 보고에 적는다. 새 SDK 의존성보다 `fetch` 직접 호출을 우선한다.
- 취소(AbortSignal), 턴 수 상한, 케이스 시간 상한, HTTP 오류/429를 기존 드라이버와 같은 실패 분류로 처리한다. 토큰 사용량(입력/출력)을 metrics로 기록해 평가 결과에 비용 추정이 가능하게 한다.
- `AgentDriver.mode`에 `'gemini'`를 추가하고, `AGENT_MODE=gemini`로 선택되게 한다. 이 mode 타입이 `contracts/`에 있으면 해당 한 줄만 수정을 허용한다.
- `evals/runner.mjs`에 `--driver gemini`를 추가한다. 키가 없으면 기존 claude처럼 SKIP 결과를 저장하고 끝낸다. `--max-cost-usd` 한도를 토큰 단가 env(`GEMINI_INPUT_USD_PER_MTOK`, `GEMINI_OUTPUT_USD_PER_MTOK`)로 계산해 초과 전에 중단한다.
- `dev-up.mjs`는 `GEMINI_API_KEY`를 agent-server 자식 프로세스에만 넘긴다. `.env.example`에 빈 값으로 변수만 추가한다.
- 결과 JSON·Markdown·로그·오류 메시지에서 키가 나오지 않도록 redaction 테스트를 둔다.

## Constraints
실제 Gemini API를 호출하지 않는다(키도 없고, 실호출은 코디네이터가 승인 후 따로 한다). 테스트는 fake `fetch`로 한다. 기존 mock/local/claude 동작 불변.

## Ownership
`services/agent-server/src/**`, `services/agent-server/test/**`(또는 기존 테스트 위치), `services/agent-server/README.md`, `evals/runner.mjs`, `evals/README.md`, `scripts/dev-up.mjs`(env allowlist 부분만), `.env.example`, 필요 시 `contracts/`의 driver mode 한 줄.

## Observable acceptance
- fake fetch 테스트: 도구 호출 왕복으로 finish까지, 역질문, 취소, 429/5xx 실패 분류, 비용 한도 중단, 헤더에만 키 존재·URL/결과/오류에 키 없음.
- `node evals/run.mjs --driver gemini`를 키 없이 실행하면 SKIP 결과 저장.
- `npm --prefix services/agent-server run typecheck`, `test` 통과. `node --test scripts/*.test.mjs` 등 scripts 테스트가 있으면 통과.
