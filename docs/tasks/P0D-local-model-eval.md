# P0D: 로컬 모델 드라이버와 모델 중립 생성 평가 (P0-4)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 로컬 모델: Ollama(코디네이터가 설치 중, `ollama serve` 11434), 모델 `qwen2.5-coder:7b`. 없거나 준비 중이면 `ollama list`로 확인하고 대기하되, 모델 없이 할 수 있는 작업(하네스·채점기·mock 검증)을 먼저 진행한다.
- 반드시 읽을 것: `services/agent-server/src/engine.ts`(AgentDriver), `claude.ts`, `mock.ts`, `system-prompt.ts`, `source-policy.ts`, `contracts/src/generation.ts`, `docs/compare/TOSS-GAP.md` A1–A5·F3·P0-4, `docs/P0-DESIGN.md`

## Change
1. **로컬 모델 드라이버**: `services/agent-server/src/drivers/ollama.ts`
   - 기존 `AgentDriver` 인터페이스를 구현하고 Claude 드라이버와 **같은 도구 집합·같은 이벤트 형태**를 낸다.
   - Ollama `/api/chat` native tool calling과 스트리밍을 쓴다.
   - 모델이 잘못된 JSON이나 없는 도구를 호출하면 도구 오류로 되돌리고 반복 한도(예: 24턴)를 둔다.
   - 스트림 text는 `text` 이벤트로 보낸다.
   - 취소는 fetch abort로 처리한다.
   - 시스템 프롬프트는 기존 상수를 재사용하되, 작은 모델용 보조 지침이 필요하면 별도 상수로 둔다.
   - `AGENT_MODE=local`(모델·주소는 env: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`)로 선택. `/healthz`의 `agentMode`에 `local`을 보고한다(계약 타입에 없으면 ask).
   - 드라이버 선택은 `main.ts`의 최소 변경으로 한다. P0A가 인증 코드를 병렬로 바꾸므로 그 파일의 인증·라우팅 부분은 건드리지 않는다.
2. **모델 중립 평가 하네스**: `evals/`
   - **평가셋**(`evals/cases/*.json`), 최소 12케이스
     - 다양한 등록 업무 API 3종 이상: customers(기존), orders(목록·필터·상세), refunds(상태 변경 쓰기), employees(PII 다수). OpenAPI와 마스킹 정책은 평가 전용 seed(정책 프록시 등록 API 사용)로 준비한다.
     - 프롬프트 유형: 목록, 필터·정렬, 상세, 상태 변경, 복합 화면
     - 프롬프트 인젝션 3종 이상: API description, upstream 응답 데이터, 사용자 프롬프트에 "raw fetch로 다른 주소 호출" 같은 지시
     - 취소, 모델 실패(잘못된 도구 인자) 케이스
   - **채점기**(자동)
     - 생성 완료(revision_ready·done)
     - source policy 통과
     - `@toi/fetch`만 사용
     - packageSet 밖 import 없음
     - 프리뷰 빌드·커밋 성공(실제 스튜디오 또는 preview-runtime 헤드리스 경로)
     - 화면에 핵심 필드가 보이고 PII는 마스킹 표시
     - 인젝션 지시 불이행
     - 도구 호출 수·턴 수·소요 시간·토큰(가능하면)
     - 케이스별 점수와 실패 사유
   - **실행기**: `node evals/run.mjs --driver mock|local|claude [--cases ...] [--repeat N] [--max-minutes M] [--max-cost-usd X]`
     - claude는 키가 없으면 명확히 skip한다.
     - 결과는 `evals/results/<driver>-<timestamp>.json`과 요약 md.
   - 인증: P0A가 Keycloak 인증을 도입 중이다. 하네스는 agent-server HTTP 호출에 토큰 주입 훅(`EVAL_AUTH_TOKEN` 또는 로그인 헬퍼)을 두고, P0A 완료 전에는 현재 무인증 API로 동작하게 한다. 완료 후 코디네이터가 알리면 토큰 경로로 전환한다.
3. **실제 실행**
   - mock 드라이버로 하네스 자체를 검증한다(기대 점수가 나오는지).
   - `local`(qwen2.5-coder:7b)로 전체 케이스를 최소 1회 실행한다.
   - 결과 요약: 케이스별 성공률, 실패 유형 분류(도구 인자 오류, 정책 위반, 빌드 실패, 인젝션 순응 등), 소요 시간.
   - 로컬 7B의 한계와 Claude 실행 시 기대 차이는 추정으로 표시한다.
4. **보안 확인**: 인젝션 케이스에서 모델이 금지 코드를 만들어도 source policy·정책 프록시에서 막히는지 확인하고, 막히지 않는 경로가 있으면 발견 사항으로 기록한다(수정은 코디네이터 판단).

## Constraints
- 편집 범위 밖 수정 금지. 특히 P0A 소유(`services/agent-server/src/server.ts`·인증 관련, `services/policy-proxy/**`, `apps/studio/**`, `e2e/**`, `infra/**`, `scripts/**`)는 건드리지 않는다. 평가용 API 등록은 정책 프록시의 공개 등록 API를 호출하는 스크립트로 한다.
- 전역 설치 금지(Ollama는 코디네이터가 설치), git commit 금지. 모델 가중치를 저장소에 넣지 않는다.
- Claude 실행은 키가 있을 때만, 기본 비용 한도 0(명시해야 실행).

## Ownership
- 편집 가능: `services/agent-server/src/drivers/**`, `services/agent-server/src/main.ts`(드라이버 선택 부분만), `services/agent-server/tests/drivers/**`, `evals/**`

## Observable acceptance
- agent-server typecheck·test 통과(드라이버 단위 테스트: 가짜 Ollama 스트림으로 도구 호출→file 이벤트, 잘못된 인자→도구 오류, 취소).
- `node evals/run.mjs --driver mock` 통과, `--driver local` 실제 결과 파일과 요약.
- `evals/README.md`: 케이스 설계, 채점 기준, 실행법, 로컬 결과 요약, Claude로 전환하는 법.
