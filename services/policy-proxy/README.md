# 정책 프록시와 API 레지스트리

[`contracts/src/policy.ts`](../../contracts/src/policy.ts)의 HTTP API를 구현하는 Node 22 + TypeScript 서비스다. 기본 포트는 **7200**이며, mock-backend **7300** 앞에서 매 요청마다 세션·역할·capability·쓰기 범위·조회 사유를 검사하고 JSON 마스킹과 append-only 감사를 수행한다.

## 실행

```sh
# 저장소 루트: 무작위 공유 키를 .env에 저장하고 mock-backend와 proxy에 전달
node scripts/dev-up.mjs

# 이미 공유 키를 구성한 경우 서비스만 실행
npm --prefix services/policy-proxy start
```

시작 시 `customers`가 없으면 mock-backend의 `/openapi.json`을 서비스 토큰으로 읽어 자동 등록한다. `npm run seed`는 해당 API를 현재 schema/policy로 다시 seed한다. 등록 정보는 `data/apis.json`, 감사는 `data/audit.jsonl`에 저장되며 [`.gitignore`](.gitignore)에서 `data/`를 제외한다. registry는 임시 파일+rename으로 교체하고 감사는 직렬 append한다. 다른 서비스를 종료하지 않고 각 서버를 별도 터미널에서 실행할 수 있다.

설정은 루트 `.env`에서 읽는다. `NODE_ENV` 미설정은 development로 취급한다. `scripts/dev-up.mjs`는 누락·빈 값·저장소의 과거 기본값인 세 키를 각각 32바이트 난수로 생성해 gitignore된 `.env`에 권한 0600으로 저장한다. 같은 `TOI_UPSTREAM_SERVICE_TOKEN`을 mock-backend와 proxy에 전달하며 다음 실행에는 저장된 값을 재사용한다. 키를 바꾸면 두 서비스를 함께 재시작해야 한다. proxy를 직접 실행할 때 누락되거나 알려진 기본값인 키는 프로세스 시작 시 무작위 값으로 대체하므로, 별도 실행 시 upstream 토큰을 양쪽에 명시적으로 맞춰야 한다. 세션·capability 키를 재생성하면 기존 토큰은 무효화된다. 서버는 loopback에 bind한다.

**운영 경고:** `.env.example`을 그대로 운영에 복사하면 기동이 거부된다. `NODE_ENV=production`에서는 `TOI_SESSION_SECRET`, `TOI_CAPABILITY_SECRET`, `TOI_UPSTREAM_SERVICE_TOKEN`이 모두 명시적으로 설정되어야 하고 각각 UTF-8 기준 32바이트 이상이며 과거 저장소 기본값이 아니어야 한다. `TOI_DEV_AUTH_ENABLED=false`를 반드시 명시하고 `TOI_DEV_ADMIN_TOKEN`은 빈 문자열도 남기지 말고 제거한다. 조건을 하나라도 위반하면 listen/seed 전에 종료 코드 1로 실패한다. 세 키는 독립적인 안전한 난수로 관리한다.

## API와 판정 순서

`/healthz`, 로컬 `/dev/session`과 CORS preflight를 제외하면 Bearer 세션이 필요하다. 먼저 Origin 경계를 검사하며, 거부 요청은 CORS 헤더 없이 **서버에서 403**으로 종료한다. 단순 요청도 실행되지 않는다.

| 요청 Origin | `/proxy/*` | `/dev/session`, `/capabilities`, `/apis*`, `/audit` 및 기타 경로 |
|---|---|---|
| 스튜디오 `http://localhost:5173` | 허용 후 정책 검사 | 허용 후 각 엔드포인트 권한 검사 |
| 프리뷰 `http://localhost:5174` | 허용 후 정책 검사 | **403**, OPTIONS도 거부 |
| Origin 없음(서버 간 호출) | 허용 후 정책 검사 | 허용 후 각 엔드포인트 권한 검사 |
| 그 외 (`null` 포함) | **403** | **403** |

`POST /dev/session`, `POST /capabilities`는 `Content-Type: application/json`만 허용하며(매개변수 허용), 누락·text/plain·form 요청은 **415**다. 브라우저의 JSON 요청은 preflight를 거쳐야 한다.

| 경로 | 응답과 권한 |
|---|---|
| `POST /dev/session {user, roles}` | `{token, claims}`; 개발 모드만, 브라우저는 viewer/editor만. platform-admin은 Origin 없는 요청 + `Authorization: Bearer <TOI_DEV_ADMIN_TOKEN>` 필요(없거나 잘못되면 403) |
| `GET /apis`, `GET /apis/:apiId` | upstream 주소와 내부 서비스 인증 정보가 제거된 PublicApi |
| `POST /apis` | RegisteredApi 등록, platform-admin만 201 |
| `POST /capabilities` | `{token, claims}`; 생략 시 read/preview/300초, write는 editor와 apiIds 필요 |
| `ANY /proxy/:apiId/*` | 아래 판정 후 마스킹된 upstream JSON |
| `GET /audit?projectId=&limit=` | 기본 100, 최대 1000; 일반 세션은 유효한 projectId 필수(없으면 400) + 해당 프로젝트의 자신의 기록만; 필터 후 limit 적용. platform-admin만 필터 없이 전체 조회 |

프록시 판정은 다음 순서로 고정한다.

1. 세션의 HS256 서명·issuer/audience·만료 확인 → 없거나 잘못되면 **401**.
2. API 존재 확인 → **404**.
3. API allowedRoles와 세션 역할 교집합 확인 → **403**.
4. capability 서명·만료·project·세션 sub 일치 확인 → **403**. env는 서명된 preview/live 값이며 `X-Toi-Env`가 주어지면 일치해야 한다.
5. 쓰기 메서드는 **mode=write + apiIds 포함 + allowWrite** 모두 필요 → **403**.
6. requireReason이면 공백 제거 후 최소 5자 필요 → **428**. 사유는 최대 500자이며 읽기와 쓰기 모두 적용한다.
7. 경로를 최대 3회 고정점까지 디코딩한다. 어느 단계든 인코딩된 `/`, 잔여 `%`, 백슬래시, `.`/`..` 세그먼트, 제어문자를 발견하면 **400**. 템플릿 변수의 점으로만 된 값은 매칭하지 않는다. 등록 OpenAPI path/method와 매칭한 정규화 경로로 `new URL(path, upstreamBaseUrl)`을 만들고 pathname이 정확히 같을 때만 upstream을 호출한다. 미등록 경로는 **404**다.
8. JSON 등록 규칙 마스킹 → 전체 문자열 잔여 PII 스캔 → 허용·거부 모두 감사 append → 응답. 비 JSON 응답은 **502**로 차단하며 PII 탐지가 있으면 감사 경고도 남긴다. upstream 오류는 일반 오류 코드로 바꾼다.

기존 12개 거부 판정은 그대로 검증한다(각 요청 감사 포함).

| 케이스 | 기대 응답 |
|---|---|
| 세션 없음 + API 없음 | 401 SESSION_REQUIRED |
| API 없음 + 역할 없음 | 404 API_NOT_FOUND |
| 역할 없음 + 위조 capability | 403 ROLE_FORBIDDEN |
| 위조 capability | 403 CAPABILITY_INVALID |
| 만료 capability | 403 CAPABILITY_INVALID |
| project 불일치 | 403 CAPABILITY_INVALID |
| subject 불일치 | 403 CAPABILITY_INVALID |
| env 불일치 | 403 ENV_MISMATCH |
| viewer/read로 PATCH + 사유 없음 | 403 WRITE_FORBIDDEN |
| editor/read로 PATCH | 403 WRITE_FORBIDDEN |
| write capability의 apiIds 밖 PATCH | 403 WRITE_FORBIDDEN |
| 조회 사유 없음 | 428 REASON_REQUIRED |

`X-Toi-Project`, `X-Toi-Capability`, `[X-Toi-Reason]`을 사용한다. 한글 사유는 HTTP 헤더의 byte-string 제약 때문에 `encodeURIComponent(reason)`로 보내고 서버에서 디코딩한다. 영어 ASCII 사유도 그대로 사용 가능하다. JWT는 `alg=HS256`, `typ=JWT`만 수락하며 Node crypto의 [HMAC과 timingSafeEqual](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptotimingsafeequala-b)을 사용한다. capability TTL은 1–3600초이고 세션 만료를 넘지 않는다.

## 마스킹과 감사

JSON Pointer의 `~0`, `~1` 이스케이프를 처리하고 `*`는 배열 인덱스에만 매칭한다. 필드명은 대소문자를 무시하고, 마지막 키가 객체·배열이면 하위 문자열·숫자에 같은 MaskKind를 재귀 적용한다. seed 정책은 상세 `/<field>`와 목록 `/items/*/<field>`에 모두 적용한다. `none`은 등록 규칙 단계에서 값을 변경하지 않지만 잔여 PII 스캔을 면제하지 않는다.

마스킹 후 응답 전체의 문자열 값(루트 문자열·배열 포함)에서 한국 휴대폰, 주민번호, 계좌번호, 이메일 패턴을 탐지해 일치 부분을 해당 종류로 마스킹한다. 규칙은 전화번호 01x/국제 +82 10, 주민번호 13자리, 계좌번호 10–16자리 또는 하이픈으로 구분한 숫자, 이메일 형식을 보수적으로 탐지한다. 정규식은 PII의 의미를 완전히 판별하지 못하므로 오탐 가능성이 있으며 등록 정책과 스키마 검토도 필요하다.

계약 파일을 변경하지 않고 서비스 내부 `PolicyAuditRecord extends AuditRecord`에 선택 필드 `policyWarnings?: ('unregistered_pii_field' | 'mask_rules_unmatched')[]`를 추가했다. 보조 탐지가 발생하면 `maskedFields`에 `/items/0/contact/phone (detected)`처럼 실제 경로를 기록하고 `unregistered_pii_field`를 남긴다. 등록 규칙이 존재하지만 하나도 매칭되지 않으면 `mask_rules_unmatched`를 남긴다. 경고가 없으면 필드를 생략한다. 비 JSON PII는 원문을 반환·기록하지 않고 502 `UPSTREAM_PII_RESPONSE`, 루트 `/ (detected)`, 탐지 경고를 감사한다.

| 종류 | 결과 예 |
|---|---|
| name | `홍*동` |
| phone | `010-****-5678` |
| email | `ho***@example.com` |
| rrn | `900101-*******` |
| account | `****-****-1234` |

감사는 계약의 `AuditRecord`이며 `maskedFields`는 `/items/0/phone` 같은 실제 경로다. 원본 응답은 기록하지 않고 query string도 감사 path에 저장하지 않는다. 검증할 수 없는 capability는 `jti: "unverified"`로 기록한다. 토큰 원문, upstream 자격증명·주소는 응답·감사 문자열에서 제거한다. upstream의 Server/Location/서비스 토큰 등 응답 헤더는 전달하지 않는다. PublicApi OpenAPI의 servers와 내부 서비스 인증 scheme도 제거한다.

## 브라우저 클라이언트

`client/toi-fetch.ts`는 런타임 의존성이 없는 단일 ESM 소스다. `npm run build:client`는 JS 한 파일과 `.d.ts`를 만들고, `npm run publish:client`는 루트 `.env`의 `TOI_REGISTRY_TOKEN`으로 **`@toi/fetch@1.0.0`**을 Verdaccio에 publish한다. 토큰은 npm 환경변수로만 전달하며 응답·출력에 남기지 않는다. 기존 버전은 재사용한다.

```ts
import { configureToiFetch, toiFetch, ToiReasonRequiredError } from '@toi/fetch';

// 신뢰하는 host가 앱 실행 전에 초기화한다.
configureToiFetch({
  sessionToken: previewViewerSession,
  capabilityToken: tokenReceivedFromParent,
  projectId: 'customer-admin',
  proxyBaseUrl: 'http://localhost:7200',
  env: 'preview',
});

try {
  const response = await toiFetch('customers', '/customers?size=20', {
    reason: '고객 문의 응대',
  });
  const customers = await response.json();
} catch (error) {
  if (error instanceof ToiReasonRequiredError) {
    // 조회 목적 입력 UI를 표시한다.
  }
}
```

helper는 fetch `Response`를 반환하고 403은 `ToiForbiddenError`, 428은 `ToiReasonRequiredError`, 나머지 실패는 `ToiFetchError(status, code)`로 바꾼다. 현재 capability 교체는 `configureToiFetch`를 다시 호출하고, 해제는 `clearToiFetch()`로 한다. `ParentToFrame.capabilityToken`을 받은 신뢰 host가 초기화해야 하며 세션/project는 별도 host 상태다. 이 helper 자체는 검증되지 않은 `window.message`를 자동으로 신뢰하지 않는다.

read preview에는 **viewer 역할 세션**을 전달한다. 프리뷰 Origin은 editor 세션을 알아도 `/capabilities`를 호출할 수 없다. 추가 방어로 계약의 PreviewHostConfig 주석대로 editor 세션은 호스트에만 둔다. host는 editor 세션을 따로 보유하고, 명시적으로 승인한 경우 같은 sub의 write capability만 전달하는 식으로 통합해야 한다. 이것은 클라이언트 표시 플래그로 쓰기를 막는 방식과 별개의 토큰 전달 경계다.

## curl 시나리오

```sh
TOI_SESSION=$(curl -s http://localhost:7200/dev/session -X POST \
  -H 'Content-Type: application/json' \
  -d '{"user":"demo-user","roles":["viewer","editor"]}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')
TOI_READ=$(curl -s http://localhost:7200/capabilities -X POST \
  -H "Authorization: Bearer $TOI_SESSION" -H 'Content-Type: application/json' \
  -d '{"projectId":"demo-project","mode":"read","env":"preview","ttlSec":300}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')

# 1, 2: 마스킹된 목록과 상세
curl -s 'http://localhost:7200/proxy/customers/customers?size=20' \
  -H "Authorization: Bearer $TOI_SESSION" -H "X-Toi-Capability: $TOI_READ" \
  -H 'X-Toi-Project: demo-project' -H 'X-Toi-Reason: customer support'
curl -s http://localhost:7200/proxy/customers/customers/C001 \
  -H "Authorization: Bearer $TOI_SESSION" -H "X-Toi-Capability: $TOI_READ" \
  -H 'X-Toi-Project: demo-project' -H 'X-Toi-Reason: customer support'

# 3: read capability PATCH → 403
curl -i http://localhost:7200/proxy/customers/customers/C001 -X PATCH \
  -H "Authorization: Bearer $TOI_SESSION" -H "X-Toi-Capability: $TOI_READ" \
  -H 'X-Toi-Project: demo-project' -H 'X-Toi-Reason: customer support' \
  -H 'Content-Type: application/json' -d '{"status":"active"}'

TOI_WRITE=$(curl -s http://localhost:7200/capabilities -X POST \
  -H "Authorization: Bearer $TOI_SESSION" -H 'Content-Type: application/json' \
  -d '{"projectId":"demo-project","mode":"write","env":"preview","apiIds":["customers"],"ttlSec":300}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')
# 4: write capability PATCH → 200
curl -s http://localhost:7200/proxy/customers/customers/C001 -X PATCH \
  -H "Authorization: Bearer $TOI_SESSION" -H "X-Toi-Capability: $TOI_WRITE" \
  -H 'X-Toi-Project: demo-project' -H 'X-Toi-Reason: customer support' \
  -H 'Content-Type: application/json' -d '{"status":"active"}'
curl -s 'http://localhost:7200/audit?projectId=demo-project' -H "Authorization: Bearer $TOI_SESSION"
```

실제 curl 실행 증거는 [`bench/curl-results.json`](bench/curl-results.json)에 있다. 위 시나리오를 새 프로젝트로 재현하는 `npm run smoke`는 **200, 200, 403, 200 / 감사 4건**을 검증하고 `bench/smoke-results.json`에 토큰 없는 증거를 저장한다.

## 검증 결과와 측정

2026-09-13 기준:

- `npm test`: **67/67 통과**. 판정 순서·12개 거부 조합, 마스킹 스냅샷과 concrete maskedFields, 허용·거부 감사, write 재판정, registry 권한, upstream 정보 제거, CORS, typed client errors, 실제 Chrome 경로와 C1/H1/H2/M1 공격 차단을 검사했다. 강화 후 재현 출력은 [`docs/review/repro/after`](../../docs/review/repro/after/)에 있다.
- 강화된 E2E D를 포함한 `npm --prefix e2e run test:repeat`: **18/18 통과**(실제 Chrome, A~F 각 3회).
- `npm run typecheck`, `npm run build:client`: 통과. mock-backend의 test **4/4**와 typecheck도 통과.
- Chrome **153.0.8010.36**: 직접 upstream **401**, 프록시 **200**, 휴대폰·주민번호 마스킹 확인. [`bench/browser-results.json`](bench/browser-results.json).
- 게시된 `@toi/fetch@1.0.0`을 :7100 조합 빌더로 준비해 **ready / ESM 자산 1개 / HTTP 200** 확인. [`bench/client-package-results.json`](bench/client-package-results.json).

`npm run bench`는 목록 20건을 대상으로 직접 upstream과 프록시를 각 1회 warm-up 후 3회 비교한다. 요청 순서를 번갈아 바꾸며 본문 수신·JSON 파싱까지 측정하고, 프록시에는 HMAC·정책·마스킹·JSONL append가 포함된다. 세션/capability 발급은 제외한다. 원시값과 중앙값은 [`bench/results.json`](bench/results.json)에 있다.

| 측정 | 3회 중앙값 |
|---|---:|
| 직접 upstream | 1.900 ms |
| 프록시 경유 | 6.827 ms |
| 동일 회차 차이인 오버헤드 | 4.927 ms |

Apple M4, macOS arm64, Node 22.14.0의 로컬 HTTP 소표본이다. 파일시스템 fsync·부하 격리·WAN/CDN 환경을 포함하지 않으며 사용자 p95를 뜻하지 않는다.

## 보안 경계와 한계

- `/dev/session`은 스튜디오·서버 간 호출에 한정된 **개발 bootstrap**이며 브라우저는 viewer/editor만 선택할 수 있다. platform-admin 발급에는 별도의 서버용 dev admin 토큰이 필요하다. 운영 SSO, 사용자별 프로젝트 membership, 승인 UI를 대신하지 않는다. 운영에서는 개발 발급 경로를 끄고 검증된 identity를 연결해야 한다.
- Origin에 따른 서버 거부를 CORS와 함께 적용한다. 프리뷰 5174는 `/proxy/*`만 허용하며 `X-Toi-*` 요청 헤더를 지원한다. CORS는 인증을 대체하지 않는다. mock-backend 직접 접근은 서비스 토큰으로 거부한다.
- API 등록 upstream은 `TOI_UPSTREAM_ALLOWLIST`에 지정된 URL만 허용한다. redirect는 따라가지 않으며 사용자 auth/header를 upstream에 전달하지 않는다. 운영의 DNS/egress 통제는 별도다.
- preview/live는 capability의 서명된 구분값이다. 이 로컬 실험은 두 env 모두 같은 mock 데이터에 연결한다. 환경별 upstream과 실제 운영 데이터는 분리하지 않았다.
- 감사는 프로세스 내 직렬 append-only JSONL이다. 파일 권한은 0600, data 디렉터리는 0700이며 API로 삭제/수정할 수 없다. 외부 변조 방지·fsync·로그 회전·다중 replica 분산 저장은 없다. 감사 append 실패 시 성공 응답을 보내지 않지만 이미 일어난 upstream 변경을 되돌릴 수는 없다.
- browser 테스트는 W1의 5174 서버를 점유하지 않고 Playwright route fulfillment로 HTML을 제공한다. 합성 페이지의 address-space 특성 때문에 해당 임시 Context에만 loopback-network 권한을 부여한다. 실제 API 네트워크와 CORS 검사는 유지한다.
- 토큰 폐기 목록과 refresh flow는 없으며 TTL 만료로 제한한다. 정책 변경은 다음 요청에서 즉시 반영된다. 대형 JSON 스트리밍 마스킹, rate limit 및 운영용 스토리지 관리도 후속 작업이다.
