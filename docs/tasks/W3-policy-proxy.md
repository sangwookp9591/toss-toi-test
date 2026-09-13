# W3: 정책 프록시 + API 레지스트리 + mock 업무 백엔드 (services/policy-proxy, services/mock-backend)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 만들 곳: `services/policy-proxy/`, `services/mock-backend/`
- 반드시 읽을 것: `docs/ARCHITECTURE.md`, `contracts/src/policy.ts`, `contracts/src/runtime.ts`(ParentToFrame.capabilityToken), `intent/INTENT.md` Constraints

## Change
1. **mock-backend (7300)**: 고객 관리 업무 API. `GET /customers?query=&page=&size=`, `GET /customers/:id`, `PATCH /customers/:id`(status 변경), `GET /customers/:id/orders`. 결정적 시드 데이터 200명(이름, 휴대폰, 이메일, 주민번호, 계좌번호, 등급, 상태). OpenAPI 3.1 문서를 `GET /openapi.json`로 제공. upstream 전용 서비스 토큰(`X-Service-Token`)이 없으면 401 — 브라우저가 직접 부를 수 없음을 보이기 위함.
2. **policy-proxy (7200)**: `contracts/src/policy.ts` HTTP API를 그대로 구현.
   - 세션: `POST /dev/session`이 HMAC 서명 JWT 발급(sub, roles, exp). 역할 예: `viewer`, `editor`, `platform-admin`.
   - API 레지스트리: 파일 기반 저장(JSON, `data/` gitignore)로 충분. 시작 시 `customers` API를 mock-backend OpenAPI로 자동 등록하는 seed 스크립트. 마스킹 정책 예: `/items/*/phone: phone`, `/items/*/rrn: rrn`, `/items/*/account: account`, `/email: email`, `requireReason: true`, `allowedRoles: ["viewer","editor"]`, `allowWrite: true`.
   - capability: HMAC 서명 토큰(jti, exp, projectId, mode, env, apiIds). read가 기본.
   - 프록시 판정 순서는 계약 주석 그대로. 거부도 감사 기록. upstream 호출 시 서비스 토큰을 서버가 붙인다. 응답 헤더에서 upstream 식별 정보 제거.
   - 마스킹: JSON Pointer 패턴 + `*` 와일드카드. 규칙 예시 — 이름 `홍*동`, 휴대폰 `010-****-5678`, 이메일 `ho***@example.com`, 주민번호 `900101-*******`, 계좌 `****-****-1234`. 적용한 필드 경로를 감사 기록 `maskedFields`에.
   - 감사 로그: append-only JSONL. `GET /audit`.
   - CORS: 5173, 5174만. `X-Toi-*` 헤더 허용.
3. **브라우저용 클라이언트 헬퍼**: `services/policy-proxy/client/toi-fetch.ts` — `toiFetch(apiId, path, init)`가 capability 토큰·project·reason 헤더를 붙이고, 403/428(사유 필요)을 타입 있는 에러로 변환. 에이전트가 생성 코드에서 import하게 할 것이므로 W2의 조합 빌드에 넣을 수 있게 **의존성 없는 ESM 단일 파일**로 만들고, npm 패키지 `@toi/fetch`로 Verdaccio에 publish하는 스크립트를 제공(`packages/fake-tds` publish 방식과 동일하게, 레지스트리 토큰은 `.env`에서).
4. **테스트** (vitest + supertest 또는 fetch)
   - 판정 표: 세션 없음 401 / 없는 API 404 / 역할 없음 403 / capability 서명 위조·만료·project 불일치 403 / read capability로 PATCH 403 / write capability인데 apiIds 밖 403 / 사유 없음 428 / 정상 200.
   - 마스킹 스냅샷, maskedFields 기록, 거부도 감사 기록.
   - upstream 토큰·주소가 응답·에러·감사 로그에 노출되지 않음.
   - 브라우저에서 mock-backend 직접 호출 401, 프록시 경유 200 + 마스킹.
5. **측정**: 프록시 오버헤드(직접 upstream vs 프록시 경유, 목록 20건) 3회 중앙값을 `bench/results.json`.

## Constraints
- `services/policy-proxy/**`, `services/mock-backend/**` 밖 수정 금지. `contracts/`는 읽기 전용(어긋나면 ask). 비밀은 `.env`에서 읽고 기본값은 개발용임을 README에 명시.
- 전역 설치 금지, git commit 금지. 포트 7200, 7300.

## Ownership
- 편집 가능: `services/policy-proxy/**`, `services/mock-backend/**`
- W4(agent-server)가 병렬로 `services/agent-server/**`를 만든다. W4는 이 서비스의 `GET /apis`, `GET /apis/:apiId`를 호출한다.

## Observable acceptance
- 두 서비스 `npm test`, `npm run typecheck` 통과. 요약을 README에.
- `curl`로 세션 발급 → capability 발급 → 프록시 조회(마스킹 확인) → PATCH 거부 → write capability로 PATCH 성공 → `/audit`에 4건 기록.
- `bench/results.json`, README(판정 순서, 마스킹 규칙, 보안 경계, 한계).
