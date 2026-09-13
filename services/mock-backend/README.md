# 합성 고객 API

`node scripts/dev-up.mjs`가 포트 7300에 시작한다. 모든 경로는 서비스 인증이 필요하며 기본 토큰은 없다. `TOI_PREVIEW_SERVICE_TOKEN`과 `TOI_LIVE_SERVICE_TOKEN`은 서로 다른 값이어야 하고 dev-up이 무작위로 생성해 루트 `.env`에 저장한다.

`/preview/customers`, `/preview/customers/:id`, `/preview/customers/:id/orders`는 합성 샌드박스 데이터이고 `/live/` 아래 같은 경로는 별도 메모리 데이터셋이다. 목록 응답은 `dataset: "preview" | "live"` 표식을 갖고 live 고객의 grade는 `live-only`다. 한 환경의 상태 변경은 다른 환경에 영향을 주지 않는다. preview 서비스 토큰으로 live 경로를 호출하면 401이고 반대 방향도 동일하다. 환경 없는 `/customers`는 제공하지 않는다.

`GET /healthz`, `GET /openapi.json`은 preview 서비스 토큰을 요구한다. 고객은 200명이고 목록은 page/size/query를 받으며 size는 최대 100이다. `PATCH /{env}/customers/:id`는 `{status:"active"|"inactive"|"suspended"}`만 허용한다. OpenAPI는 환경 접두사를 뺀 경로를 기술하며 policy-proxy가 환경별 base URL을 붙인다. 원본 PII는 합성 데이터이고 실제 브라우저 호출은 policy-proxy를 경유해 마스킹된다.

```sh
npm --prefix services/mock-backend run typecheck
npm --prefix services/mock-backend test
```

서버는 loopback에 bind하며 브라우저의 직접 호출은 토큰 없이는 401이다. 데이터는 재시작하면 초기화된다.
