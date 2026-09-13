# F3b: R2 후속 — agent-server N1 (services/agent-server)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 수정할 곳: `services/agent-server/`
- 반드시 읽을 것: `docs/review/REVIEW-R2.md` §4 N1, 재현 `docs/review/repro/r2/07-preview-to-agent-csrf.*`, 참고 구현 `services/policy-proxy/src/server.ts`의 Origin 판정(F1)

## Change
1. **서버 측 Origin 판정**(CORS 헤더만으로는 부족: 단순 요청은 서버에서 실행된다)
   - 허용: 스튜디오 origin(`http://localhost:5173`, env로 설정 가능)과 Origin 헤더 없는 서버 간 호출.
   - 거부(403, 부작용 없음): 프리뷰 origin(5174), `null`, 알 수 없는 모든 Origin. 판정은 라우팅·본문 파싱·상태 변경보다 **먼저**.
   - 대상: 상태를 바꾸는 모든 엔드포인트(`POST /projects`, `PUT /projects/:id/source`, `POST /generations`, `POST /generations/:id/answers`, `POST /generations/:id/cancel`)와 읽기 엔드포인트(`GET /projects/:id`, `GET /generations/:id/events`). `GET /healthz`는 예외.
2. 상태 변경 엔드포인트는 `Content-Type: application/json`이 아니면 415(프리플라이트 강제). 스튜디오와 E2E가 이미 JSON으로 호출하는지 확인하고, 깨지면 ask.
3. SSE `GET /generations/:id/events`도 프리뷰·알 수 없는 Origin이면 403.
4. 테스트: 프리뷰 Origin·`null`·임의 Origin으로 각 엔드포인트 → 403이고 **generation이 생성되지 않음**(저장소·이벤트 파일 무변화), text/plain·Content-Type 없음 → 415, 스튜디오 Origin·Origin 없음 → 기존대로 성공. 기존 37개 테스트 유지.
5. `docs/review/repro/r2/07-preview-to-agent-csrf.mjs`를 수정 후 다시 실행해 `docs/review/repro/r2/after/07-*.out`에 저장(원본 보존). 실제 Chrome에서 프리뷰가 생성 작업을 만들지 못함을 확인.

## Constraints
- `services/agent-server/**`와 `docs/review/repro/r2/after/07-*` 밖 수정 금지. 전역 설치 금지, git commit 금지. 7400 재시작 허용(`AGENT_MODE=mock`).

## Ownership
- 편집 가능: `services/agent-server/**`, `docs/review/repro/r2/after/07-*`
- F3a가 병렬로 `services/policy-proxy/**`, `scripts/dev-up.mjs`를 수정한다.

## Observable acceptance
- `cd services/agent-server && npm run typecheck && npm test` 통과(추가 테스트 포함).
- after/07 출력에서 서버 측 generation 생성 없음.
