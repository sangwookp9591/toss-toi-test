# 고객 관리 mock-backend

Node 22 + TypeScript 업무 API이며 기본 포트는 **7300**이다. 실제 개인정보가 아닌 결정적 합성 고객 200명과 고객당 주문 3건을 제공한다. 시드에는 이름·휴대폰·이메일·주민번호 형식 값·계좌번호 형식 값·등급·상태가 들어간다.

```sh
cd services/mock-backend
npm ci
npm run typecheck
npm test
npm start
```

모든 경로는 `X-Service-Token` 헤더가 없거나 다르면 401이다. 토큰은 루트 `.env`의 `TOI_UPSTREAM_SERVICE_TOKEN`에서 읽으며, **`toi-dev-upstream-secret` 기본값은 로컬 개발 전용**이다. `NODE_ENV=production`에서는 명시적 토큰이 없으면 시작하지 않는다. 서버는 loopback에 bind한다.

| 경로 | 동작 |
|---|---|
| `GET /customers?query=&page=1&size=20` | 이름·휴대폰·이메일·ID 부분 검색, 1부터 시작하는 페이지, size 1–100 |
| `GET /customers/C001` | 고객 상세 |
| `PATCH /customers/C001` | `{ "status": "active" \| "inactive" \| "suspended" }`만 허용 |
| `GET /customers/C001/orders` | 고객 주문 3건 |
| `GET /openapi.json` | OpenAPI 3.1 문서 |
| `GET /healthz` | 인증된 health 조회 |

OpenAPI에는 upstream 주소를 넣지 않는다. 프록시가 서버 토큰으로 문서를 읽어 `customers` 레지스트리를 seed한다. 브라우저의 무인증 직접 조회가 401임을 관측할 수 있도록 CORS 응답은 스튜디오·프리뷰 origin에만 열지만 서비스 토큰 인증은 항상 검사한다.

2026-09-13 검증: **Vitest 4/4 통과**, `npm run typecheck` 통과. 인증, 결정적 200명 시드, 페이지/검색, 상세/주문, 상태 변경 검증과 OpenAPI를 검사했다. policy-proxy의 실제 Chrome 통합 테스트에서도 직접 호출 401을 확인했다.

상태 변경은 프로세스 메모리에만 저장되어 재시작하면 시드로 돌아간다. 실제 업무 DB, SSO, 환경별 데이터 분리와 장애 복구를 구현하는 서비스는 아니다. 공개 저장소에 적힌 개발 기본 토큰은 비밀이 아니므로 운영 자격증명으로 쓰면 안 된다.
