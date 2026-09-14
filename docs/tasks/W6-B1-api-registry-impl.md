# W6-B1: API 등록·선택·스키마 버전 구현 (TOSS-GAP P1-3, A4/A5)

공통 제약: [`W6-common.md`](W6-common.md). 설계 근거: [`W6-B0-api-registry-spec.md`](W6-B0-api-registry-spec.md), [INTENT](../../intent/INTENT.md) 열린 질문 #5.
계약: [`contracts/src/registry.ts`](../../contracts/src/registry.ts)(W6-B0가 추가함). 이 명세와 계약이 다르면 계약을 따르고 코디네이터에게 알린다.

## Target

| 영역 | 지금 | 바꾼 뒤 |
|---|---|---|
| 등록 | `POST /apis`(platform-admin)와 `seed.ts`만. 버전은 `schemaVersion` 숫자 하나, 덮어쓰기 | api-owner가 스튜디오에서 제출 → platform-admin 승인(4-eyes) → 버전 이력 보관 |
| 선택 | 스튜디오가 `apiIds: ['customers']` 고정(`apps/studio/src/controller.ts:149`) | 프로젝트 생성·편집 때 등록 API 여러 개 선택, 버전 pin |
| 에이전트 | `list_registered_apis`가 전체 레지스트리를 반환 | 프로젝트가 선택한 API의 pin 버전만 반환 |
| 프록시 | 프로젝트가 선택하지 않은 API도 호출 가능, 항상 최신 스키마로 경로 판정 | 선택한 API만, pin 버전 경로로 판정. 마스킹은 더 엄격한 쪽 |
| 변경 영향 | 없음 | 새 버전마다 호환성 보고서와 영향 프로젝트 목록 |

## 1. 스키마 형식과 등록 권한

### 1.1 형식 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 형식 | **OpenAPI 3.1.x JSON**만 | `validateApi`가 이미 `3.1.`을 요구하고 mock-backend·eval fixture가 3.1.0이다. 3.1은 JSON Schema 2020-12와 맞아 diff·필드 pointer 계산을 한 규칙으로 할 수 있다 |
| 3.0·Swagger 2.0·YAML | 400 `UNSUPPORTED_SCHEMA_FORMAT` | 변환기는 범위 밖(7절). 사내 API가 3.0이면 등록자가 변환해서 올린다 |
| `$ref` | 문서 내부(`#/components/...`)만. 외부·상대 경로 ref는 400 `EXTERNAL_REF_FORBIDDEN` | 서버가 ref를 따라 fetch하면 SSRF 경로가 된다 |
| 크기·구조 | 본문 256KiB(현 `body()` 한도), 깊이 64, paths 200, operation 500, ref 해석 깊이 32(순환이면 400 `SCHEMA_REF_CYCLE`) | 비교·영향 분석 비용 상한 |
| `servers`, `security`, `components.securitySchemes` | 저장 전에 제거(현 `publicApi` 동작을 저장 시점으로 앞당김) | upstream 주소·서비스 토큰 방식 비노출 |
| 응답 | 200/201 `application/json` 스키마만 영향 분석 대상 | 프록시가 JSON 외 응답을 이미 거부한다 |
| 확장 | 스키마 속성에 `x-toi-pii: "name"\|"phone"\|"email"\|"rrn"\|"account"\|"none"` | 마스킹 규칙과 필드를 스키마에서 직접 연결(5절) |

### 1.2 권한

realm role(`contracts/src/auth.ts` `RealmRole`)과 프로젝트 역할(`ProjectRole`)을 그대로 쓴다. 새 역할은 만들지 않는다.

| 동작 | 허용 | 비고 |
|---|---|---|
| 등록 API 목록·검색, active/deprecated 버전 조회 | 인증된 사용자 전원, 서비스 client `toi-agent-server` | 지금 `GET /apis`와 같다 |
| draft·rejected 버전 조회, lint | 그 API의 owner(`api-owner` + `owners`에 포함), `platform-admin` | |
| 새 API 제출(apiId 신규) | `api-owner`(요청 본문 `owners`에 자기 sub 포함 필수), `platform-admin` | `builder`는 403 `API_OWNER_REQUIRED` |
| 기존 API 새 버전 제출 | 그 API의 owner, `platform-admin` | |
| 버전 승인·반려 | `platform-admin`, **제출자 본인 금지** → 403 `FOUR_EYES_REQUIRED` | `policyLoosened`면 승인 화면에 경고와 확인 체크 필수 |
| 버전 retire | 그 API의 owner, `platform-admin` | pin한 프로젝트가 있으면 409 `VERSION_IN_USE` |
| 영향 보고서 조회 | 그 API의 owner, `platform-admin` | 프로젝트 소스는 담지 않는다 |
| 프로젝트 API 선택·버전 변경 | 프로젝트 `owner` | editor·viewer는 조회만(403 `PROJECT_ROLE_FORBIDDEN`), 비멤버 404 |
| owners·upstream 변경 | `platform-admin`만, 기존 `POST /apis` 호환 경로 | 스튜디오 UI는 만들지 않는다(7절) |

개발 realm 매핑: `dana`(api-owner) 제출 → `root`(platform-admin) 승인 → `alice`(builder, 프로젝트 owner) 선택. `root`가 직접 제출한 버전은 다른 platform-admin이 없으면 승인할 수 없다(의도). seed와 `POST /apis`만 예외적으로 즉시 active이며 감사에 `method: "SEED"` 또는 `"ADMIN_PUT"`으로 남긴다.

## 2. 스키마 버전 모델

### 2.1 저장

| 파일(policy-proxy `dataDir`) | 내용 |
|---|---|
| `apis.json`(기존) | `RegisteredApi[]`. 값은 **최신 active 버전**의 투영. `schemaVersion` = 그 버전 번호. 기존 코드 경로(`storage.apis`)는 그대로 둔다 |
| `api-versions.json`(신규) | `ApiVersion[]`(계약). `(apiId, version)` 유일, append 후 상태만 전이. 원자적 temp+rename(현 `save`와 같은 큐) |

기동 시 이관: `apis.json`에 있고 `api-versions.json`에 없는 API는 `version = schemaVersion`, `status: "active"`, `submittedBy: "migration"`, `compatibility.fromVersion: null`로 한 건 만든다.

### 2.2 상태 전이

| 전이 | 누가 | 효과 |
|---|---|---|
| (없음) → `draft` | 제출 | `version = max(version)+1`. 서버가 `compatibility`(직전 active 대비)와 `schemaDigest` 계산. 직전 active와 digest가 같으면 409 `SCHEMA_UNCHANGED` |
| `draft` → `active` | 승인 | 직전 active → `deprecated`. `apis.json` 투영 갱신. **기존 pin은 바꾸지 않는다** |
| `draft` → `rejected` | 반려 | 끝 |
| `active`/`deprecated` → `retired` | retire | pin 0개일 때만. retired 버전은 새 pin 불가 |
| draft 보관 | — | 한 API에 draft는 동시에 1개. 두 번째 제출은 409 `DRAFT_PENDING` |

### 2.3 프로젝트 pin

- `Project.apiBindings: ProjectApiBinding[]`(계약에 선택 필드로 추가). `Project.apiIds`는 호환을 위해 유지하고 항상 `apiBindings.map(b => b.apiId)`와 같게 저장한다.
- `POST /projects { name, apiIds }`(기존 계약): agent-server가 policy-proxy `GET /apis/:apiId`(서비스 토큰)로 존재를 확인하고 최신 active `schemaVersion`으로 pin. 없는 apiId는 400 `API_NOT_FOUND`. 1~5개, 중복 금지(400 `INVALID_API_SELECTION`). 빈 배열은 기존 호환을 위해 허용하지만 스튜디오는 1개 이상을 요구한다.
- 기존 프로젝트 이관: agent-server 로드 시 `apiBindings`가 없으면 `apiIds`마다 `version: 1, pinnedBy: "migration"`.
- `PUT /projects/:id/apis`: 추가·제거·버전 변경을 한 번에. 각 `(apiId, version)`이 `active|deprecated`인지 policy-proxy `GET /apis/:apiId/versions/:version`으로 확인. 그다음 policy-proxy `POST /internal/audit/project-apis`가 성공해야 저장한다(감사 실패 → 503, 저장 안 함).
- pin 판정 기준: **프록시가 요청마다** agent-server `GET /internal/projects/:id/api-context`로 읽는다(현 membership 조회처럼 캐시 없음). 두 호출은 `Promise.all`로 병렬.

### 2.4 프록시가 쓰는 스키마·정책

pin 버전 `P`, 최신 active `A`에 대해 요청마다 합성한다.

| 판정 | 규칙 | 이유 |
|---|---|---|
| 호출 가능 API | `apiId ∈ apiBindings` 아니면 403 `API_NOT_SELECTED` | 멤버 확인 뒤라 존재 노출 없음 |
| 경로·메서드(`allowedPath`) | `P.openapi` | 프로젝트 코드가 쓰는 계약 |
| retired | `P.status === "retired"`면 409 `API_VERSION_RETIRED` | |
| `mask` | `P.mask ∪ A.mask`. 같은 pointer면 `A` 우선, 단 `A`가 `none`이면 `P` 값 | 새 마스킹은 pin과 무관하게 즉시 적용, 약화는 pin 업그레이드 전까지 적용 안 됨 |
| `requireReason` | `P || A` | 엄격한 쪽 |
| `allowWrite` | `P && A` | 엄격한 쪽 |
| `allowedRoles` | `P ∩ A` | 엄격한 쪽 |
| upstream | API 단위 `environments`(버전 무관) | 스키마와 upstream 분리 |

판정 순서는 `contracts/src/policy.ts` 주석의 "API 존재" 다음에 "선택·pin" 단계를 넣는 것으로 갱신한다(주석 한 줄 수정 허용). capability 발급(`POST /capabilities`, `POST /preview-sessions`)의 `write.apiIds`도 `apiBindings`의 부분집합이어야 한다(아니면 403 `API_NOT_SELECTED`).

### 2.5 호환성 판정 규칙 (`CompatibilityReport`)

비교 전에 `$ref`를 전부 풀고, operation 키는 `"METHOD /path"`(path 파라미터 이름은 `{}`로 정규화: `/a/{id}` ≡ `/a/{x}`).

| rule | severity | 조건 |
|---|---|---|
| `operation-removed` | breaking | 이전에 있던 operation이 없음 |
| `request-required-added` | breaking | 필수 query/path/header 파라미터나 필수 body 속성 추가 |
| `request-param-removed` | breaking | 파라미터·body 속성 제거(서버가 거부할 수 있음) |
| `request-constraint-narrowed` | breaking | 타입 변경, enum 값 제거, `pattern` 추가·변경, `maximum`/`maxLength` 감소, `minimum`/`minLength` 증가 |
| `response-property-removed` | breaking | 응답 속성 제거 |
| `response-type-changed` | breaking | 응답 속성 타입·format 변경 |
| `response-required-removed` | caution | `required`에서 빠짐 또는 nullable이 됨 |
| `response-enum-added` | caution | 응답 enum 값 추가 |
| `policy-require-reason-added` | caution | `requireReason` false→true(모든 사용 operation에 해당) |
| `policy-write-removed` | breaking | `allowWrite` true→false(쓰기 operation에 해당) |
| `policy-roles-narrowed` | breaking | `allowedRoles` 축소 |
| `mask-added` | safe | 마스킹 추가·강화 |
| `mask-weakened` | caution, `policyLoosened=true` | 규칙 제거 또는 `none`으로 변경 |
| `policy-loosened` | caution, `policyLoosened=true` | `requireReason` 해제, `allowWrite` 허용, `allowedRoles` 확대 |
| `operation-added`, `request-optional-added`, `response-property-added` | safe | |

`breaking = changes.some(c => c.severity === "breaking")`. `SchemaChange.pointer`는 응답 필드일 때 마스킹과 같은 형식(`/items/*/department`)으로 쓴다.

### 2.6 프로젝트 사용 흔적과 영향 판정

**사용 흔적(`ProjectApiUsage`)**: agent-server가 revision 저장(PUT source, revision_ready)과 pin 변경 때 계산해 `usage/<projectId>.json`에 보관.

| 출처 | 방법 |
|---|---|
| static operation | 프로젝트 `.ts/.tsx` 파일에서 `toiFetch('<apiId>', '<path>'[, { method }])`와 문자열 `/proxy/<apiId>/<path>`를 정규식으로 찾는다. path는 문자열 리터럴, 템플릿 리터럴(`${}`는 한 세그먼트 와일드카드), `'<prefix>' + x` 형태를 지원하고 pin 버전 operation 패턴에 매칭. apiId나 path가 변수면 `dynamicCalls = true` |
| static field | 사용 operation의 응답 스키마 속성 이름이 소스에 `.name`, `['name']`, `{ name }`, `name:` 형태로 등장하면 `static-match`. 사용 operation이 없고 이름만 겹치면 `name-only` |
| audit operation | policy-proxy가 영향 보고서 계산 시 최근 30일 `action: "proxy", decision: "allowed"` 기록의 `(apiId, method, path)`를 pin 버전 패턴에 매칭 |

**영향 판정(`ProjectImpact.level`)**: 새 버전의 `changes` 중 breaking·caution만 본다.

| level | 조건 |
|---|---|
| `breaking` | breaking 변경의 operation을 프로젝트가 쓰고(static 또는 audit), 그 변경에 pointer가 없거나 pointer 필드를 `static-match`로 씀 |
| `unknown` | `dynamicCalls = true`, 또는 operation은 쓰지만 필드 사용을 `name-only`로만 확인, 또는 사용 흔적 파일이 없음 |
| `safe` | 위에 해당 없음. caution만 닿으면 `safe`이되 `changes`에 caution을 담아 표시 |

`unknown`은 화면에서 breaking과 같은 경고색으로 보이고 "직접 확인 필요"라고 쓴다(보수적). 영향 대상은 `P.version < 새 version`인 pin 전부. 보고서 계산은 policy-proxy가 agent-server `GET /internal/api-usage?apiId=`를 호출해 합친다.

## 3. 스튜디오 UX

### 3.1 화면

| 화면 | 누구에게 | 구성 |
|---|---|---|
| 시작 배너(기존 `main.tsx` start-banner) | 로그인 사용자 | 프로젝트 이름 + **사용할 API** 목록(검색 입력, 체크박스, 1~5개). 행: 이름, apiId, 설명 1줄, `v{schemaVersion}`, 배지 `조회 사유 필요`·`쓰기 가능`·`마스킹 필드 N개`. 0개 선택이면 `프로젝트 만들기` 비활성 + "API를 하나 이상 선택해 주세요" |
| 프로젝트 `API` 패널(신규 `api-panel.tsx`, DownloadPanel 옆) | 멤버 | 선택 API와 pin 버전. 새 active 버전이 있으면 `v2 사용 가능` 배지. owner에게만 `API 추가`·`제거`·`v2로 올리기`. 올리기 누르면 이 프로젝트의 `ProjectImpact`(level·변경 목록) 확인 후 적용 |
| `API 등록` 화면(신규 `registry-panel.tsx`, 헤더 버튼) | `api-owner`·`platform-admin`에게만 버튼 노출 | apiId·이름·설명, upstream 선택(`GET /upstream-targets` 라벨), OpenAPI JSON 파일 선택 또는 붙여넣기, 정책 폼(requireReason·allowWrite·allowedRoles), 마스킹 표. `검사` → `lint` 결과로 PII 후보(`PiiFieldHint`)를 마스킹 표에 미리 채우고 `covered=false`는 빨간 행. `제출` → draft |
| `버전 승인` 탭 | `platform-admin` | draft 목록, `CompatibilityReport` 표, `ImpactReport` 프로젝트 표(level별 정렬), `policyLoosened`면 경고 + "정책 완화를 확인했습니다" 체크 후에만 승인 버튼 활성. 제출자 본인이면 버튼 없이 "다른 관리자의 승인이 필요해요" |
| 내 API 버전 이력 | API owner | 버전 목록·상태·영향 보고서, retire 버튼 |

검색은 `GET /apis?query=`(서버, 부분 일치, 대소문자 무시). 목록이 50개 이하이면 클라이언트 필터도 허용.

### 3.2 컨트롤러

- `controller.open(projectId?, name, apiIds)`: 새 인자 `apiIds: string[]`. 기존 호출부·E2E의 기본값은 `['customers']`로 유지해 회귀를 막는다.
- `window.studio` 스냅샷에 `registry: PublicApi[]`, `project.apiBindings`를 노출(E2E 검증용).
- 프리뷰 세션 `write.apiIds`와 `validateBrokerRequest`의 허용 목록은 `project.apiIds`(= bindings)를 그대로 쓴다(이미 그렇게 동작).

### 3.3 에이전트 컨텍스트 경로

```
스튜디오 선택 → agent-server Project.apiBindings
  → 생성 시작 시 engine이 record에 bindings 스냅샷 보관
  → list_registered_apis: bindings마다 policy-proxy GET /apis/:apiId/versions/:version
       → PublicApi 형태 { apiId, name, description, owners, openapi, policy, schemaVersion: version }만 반환
  → get_api_schema(apiId): apiId ∉ bindings면 ToolError "api not selected for this project"
  → 결과는 기존처럼 { untrusted_api_registry_data: ... }로 감싼다
```

- 시스템 프롬프트(`system-prompt.ts`)에 "이 프로젝트가 선택한 API: `employees`(v1), `customers`(v1). 이 목록 밖 apiId는 호출하지 않는다" 한 줄을 생성 요청마다 붙인다. apiId·버전만 넣고 설명은 넣지 않는다(설명은 untrusted라 도구 결과로만).
- mock 생성기(`mock.ts`)와 `templateFiles`: 지금 `/customers` 경로가 하드코딩이다. 첫 선택 API의 `get_api_schema`를 실제로 호출하고, 그 스키마의 첫 `GET` 목록 operation(`items` 배열 응답)과 `GET .../{id}` 상세로 **범용 표 화면**을 만든다. 열은 item 스키마 속성 순서, `requireReason`이면 조회 사유 입력, `allowWrite`이고 `PATCH .../{id}`에 `status` enum이 있으면 상태 변경. customers 선택 시 기존 E2E 문구(`조회 사유`, `조회`)가 유지되어야 한다.

## 4. `contracts/` 변경안 (W6-B0에서 반영 완료)

모두 추가만 한다. 기존 필드 제거·타입 축소 없음.

```diff
+ contracts/src/registry.ts  (신규)
+   ApiVersionStatus, UpstreamTarget, SchemaChangeSeverity, SchemaChange, CompatibilityReport,
+   ApiVersion, ApiVersionSubmission, ApiVersionDecision, PiiFieldHint,
+   ProjectApiBinding, ProjectApiSelection, InternalProjectContext,
+   ApiOperationUsage, ApiFieldUsage, ProjectApiUsage, ProjectImpactLevel, ProjectImpact, ImpactReport
+   HTTP API 추가분 주석(policy-proxy·agent-server 엔드포인트와 권한)

  contracts/src/index.ts
+ export * from "./registry.ts";

  contracts/src/generation.ts  interface Project
    apiIds: string[];
+   apiBindings?: ProjectApiBinding[];

  contracts/src/policy.ts  interface AuditRecord
-   action: "proxy" | ... | "membership-denied";
+   action: "proxy" | ... | "membership-denied" | "api-registry" | "project-apis";
```

구현 작업자가 계약을 더 바꿔야 하면 추가만 하고, 4개 패키지 typecheck(`contracts`, `services/policy-proxy`, `services/agent-server`, `apps/studio`)를 모두 통과시킨다. `RegisteredApi`·`PublicApi`는 바꾸지 않는다(`schemaVersion`이 곧 최신 active 버전).

## 5. 보안

| 위협 | 규칙 | 오류 코드 |
|---|---|---|
| 등록자가 임의 upstream 지정(SSRF) | 제출 본문에 URL 필드가 없다. `upstreamId`만 받고 서버 설정 `TOI_UPSTREAM_TARGETS`(JSON `{ id: { label, preview, live } }`, 없으면 기존 `upstreamUrl/preview`·`/live`를 `mock-backend`로)에서 찾는다. 찾은 URL은 기존 `validateApi`의 `upstreamAllowlist` 정확 일치 검사를 **다시** 통과해야 한다 | 400 `UPSTREAM_NOT_ALLOWED` |
| 스키마 안 URL로 fetch 유도 | 서버는 제출된 스키마의 어떤 URL도 요청하지 않는다. 외부 `$ref` 거부, `servers` 제거. seed의 `openapi.json` fetch만 서버 설정 주소로 유지 | 400 `EXTERNAL_REF_FORBIDDEN` |
| redirect·DNS | 프록시 fetch는 기존 `redirect: 'error'`, allowlist 정확 일치 유지. 새 upstream 등록 UI는 없음 | |
| 스키마 설명을 통한 프롬프트 주입 | `name` 200자, `description`·`summary`·`changeSummary` 2000자, 제어문자 제거. 에이전트에는 `untrusted_api_registry_data`로만 전달(eval `11-injection-*` 유지) | 400 `INVALID_API` |
| PII 필드 마스킹 누락 | 제출·lint 때 응답 스키마 전 속성을 훑어 `x-toi-pii`(값이 `none` 아님) 또는 이름이 `mask.ts`의 `piiKey`(+ `name`, `이름`)와 맞는 필드를 `PiiFieldHint`로 만든다. `policy.mask`가 그 pointer(`/field`, `/items/*/field` 둘 다)를 덮지 않으면 제출 거부. `x-toi-pii: "none"`으로 명시하면 통과하되 `policyLoosened=true`로 표시 | 400 `PII_MASK_MISSING`(body에 pointer 목록, 값은 없음) |
| 마스킹 약화 전파 | 2.4의 합성 규칙: 약화는 승인 + 프로젝트별 pin 업그레이드 둘 다 있어야 효과. 잔여 PII 검사(`scanPii`)는 그대로 | |
| 비멤버 존재 노출 | `/projects/:id/apis`는 기존 멤버십 404. `api-context`·`api-usage`는 서비스 토큰(client id 확인)만, 사용자 토큰은 404. 영향 보고서는 API owner·platform-admin에게만, 소스 없이 projectId·이름·teamId·owner username·level·변경만 | 404 `PROJECT_NOT_FOUND` |
| draft 노출 | draft·rejected 버전은 권한 없는 사용자에게 404 `API_VERSION_NOT_FOUND`(403 아님) | |
| 자기 승인 | 제출자 ≠ 결정자(서버). 승인 시점에 결정자가 여전히 `platform-admin`인지 토큰 역할로 확인 | 403 `FOUR_EYES_REQUIRED` |
| 기존 경계 | 프록시 강제, 프리뷰 origin 직접 호출 금지, 프리뷰 토큰에 Keycloak 토큰 없음, live 쓰기 4-eyes는 그대로. 새 코드가 이 판정 앞에서 성공 응답을 내지 않는다 | |
| 감사 | `api-registry`: 제출·결정·retire·`POST /apis`(lint는 기록하지 않음), `projectId: "system"`, `apiId`, `path`는 `/apis/:apiId/versions/:version/decision` 형식, 거부도 기록. `project-apis`: 선택 변경, `path`는 `/projects/:id/apis`, `reason`에 `"employees@1,customers@1"` 형식 요약. 둘 다 응답 전에 append(실패 시 성공 응답 금지). 스키마 본문·upstream URL은 감사에 넣지 않는다 | 503 `AUDIT_CHAIN_BROKEN` |
| 비밀 | 오류·보고서·감사에 upstream URL/host, 서비스 토큰을 넣지 않는다. 기존 `sanitize(secrets())`에 `TOI_UPSTREAM_TARGETS`의 URL·host를 추가 | |

## 6. 수용 기준

### 6.1 구현 범위와 Ownership(구현 작업자)

`services/policy-proxy/**`, `services/agent-server/**`, `services/mock-backend/**`, `apps/studio/**`, `e2e/tests/**`, `contracts/src/**`(추가만). 다른 디렉터리는 수정하지 않는다.

mock-backend: `employees` 업무 API를 추가한다. 데이터는 `evals/fixtures.mjs`의 `employees` 행 형식(합성 3행, preview·live 데이터 구분), 경로 `/{preview|live}/employees`, `/{preview|live}/employees/{id}`, 스키마 `GET /openapi/employees.json`(서비스 토큰). 스키마의 `name/phone/email/rrn/account`에 `x-toi-pii`를 단다. E2E 등록용 사본을 `e2e/tests/fixtures/employees.v1.openapi.json`, 호환 깨짐 버전을 `employees.v2.openapi.json`(`department` 제거, `team` 추가)으로 둔다. upstream은 기존 `mock-backend` target을 재사용하므로 allowlist 변경이 없다.

### 6.2 단위 테스트 (vitest/node test, loopback·fake만)

| 패키지 | 테스트 |
|---|---|
| policy-proxy | 2.5 표의 rule마다 최소 1케이스(→ severity), `$ref` 풀기와 path 파라미터 이름 정규화 |
| policy-proxy | 제출 권한: builder 403, api-owner가 owners에 자신 없음 403, 타 API owner 403, 새 버전 409 `DRAFT_PENDING`·`SCHEMA_UNCHANGED` |
| policy-proxy | 승인: 제출자 본인 403 `FOUR_EYES_REQUIRED`, 승인 후 이전 active → deprecated, `apis.json` 투영 갱신, draft는 비권한자 404 |
| policy-proxy | 보안: 외부 `$ref` 400, 알 수 없는 `upstreamId` 400, PII 필드 무마스킹 400(응답에 pointer만, 원문 값 없음), 스키마에 upstream URL 문자열이 있어도 공개 응답에서 제거 |
| policy-proxy | 프록시: 선택 안 한 API 403 `API_NOT_SELECTED`, pin v1 경로는 v2에서 없어져도 허용, v2에서 추가된 경로는 v1 pin에 404 `OPERATION_NOT_REGISTERED`, 마스킹 합성(v2 추가 마스킹이 v1 pin에 적용, v2 `none`은 미적용), retired 409, preview-session write apiIds 부분집합 검사 |
| policy-proxy | 감사: `api-registry`·`project-apis` 기록이 체인에 들어가고 `/audit/verify` ok, append 실패 시 성공 응답 없음 |
| policy-proxy | 영향: fake agent-server usage로 `breaking`/`unknown`/`safe` 판정, 최신 pin 프로젝트 제외 |
| agent-server | 사용 흔적 추출: 리터럴·템플릿·`+` 연결·변수(dynamic) 케이스, 필드 `static-match`/`name-only` |
| agent-server | `POST /projects` pin 생성, 없는 apiId 400, 기존 프로젝트 이관, `PUT /projects/:id/apis` owner만·editor 403·비멤버 404·감사 실패 시 저장 안 됨, internal 엔드포인트 사용자 토큰 404 |
| agent-server | `list_registered_apis`가 선택 API만 반환, 미선택 `get_api_schema` ToolError, mock 생성기가 employees 스키마로 표 화면 생성 |
| studio | 컨트롤러: `open(undefined, name, ['employees'])`가 `apiIds`를 보냄, 0개 선택 시 생성 비활성 |

기존 테스트(policy-proxy·agent-server·studio unit, `evals/scorer.test.mjs`)는 모두 통과해야 한다.

### 6.3 E2E (`e2e/tests/registry.spec.ts`, 기존 Keycloak 테스트 사용자)

**R1 등록 → 선택 → 생성 → 커밋 → 마스킹**
1. `dana` 로그인 → `API 등록` → apiId `employees`, upstream `mock-backend`, `employees.v1.openapi.json` 업로드 → `검사` → PII 후보 5개가 마스킹 표에 채워짐 → 마스킹 한 행을 지우고 `제출` → `PII_MASK_MISSING` 안내 → 되돌리고 `제출` → draft v1.
2. `dana`에게 승인 버튼이 없음을 확인. `root` 로그인 → `버전 승인`에서 employees v1 승인.
3. `alice` 로그인 → 시작 배너 검색에 `emp` 입력 → `employees`만 보임 → 체크 → `프로젝트 만들기` → 스냅샷 `project.apiBindings`가 `[{ apiId: "employees", version: 1 }]`.
4. `직원 목록 화면 만들어줘` 생성(mock) → `revision_ready` → 프리뷰 커밋(`lastCommit.token.revision === 2`).
5. 프리뷰에서 조회 사유 입력 후 `조회` → `010-****-1234`, `박*원` 표시, 원문 `010-9999-1234`·`900101-1234567`이 frame 텍스트에 없음.
6. 활동 기록에 `apiId: "employees"`, `decision: "allowed"`, `maskedFields`에 `/items/0/phone` 포함.
7. 같은 프로젝트에서 broker로 `customers` 호출 시 403(`API_NOT_SELECTED` 또는 기존 broker 거부)이고 원문 없음.

**R2 새 버전 → 영향 프로젝트 표시**
1. `alice`가 customers만 선택한 프로젝트 P2를 하나 더 만든다(R1 프로젝트는 P1).
2. `dana`가 employees v2(`employees.v2.openapi.json`) 제출 → 호환성 표에 `response-property-removed … /items/*/department` breaking.
3. `root`의 승인 화면 영향 표에 P1이 `breaking`(또는 `unknown`)으로 있고 P2는 없음. 승인.
4. `alice`의 P1 API 패널에 `v2 사용 가능`, 올리기 확인 창에 같은 변경 표시. 올리기 전 P1 프리뷰는 v1 계약으로 계속 조회됨.
5. `bob`(P1 비멤버)이 `/projects/<P1>/apis` 요청 → 404.
6. `root`의 `/audit/verify` ok, `api-registry` 기록 3건 이상(v1 제출·승인, v2 제출·승인), `project-apis` 1건 이상.

기존 E2E(`studio.spec.ts` A~M, identity·isolation·downloads)는 customers 기본값으로 모두 통과해야 한다.

### 6.4 실행 확인(보고서에 통과 수)

```sh
npm --prefix contracts run typecheck
npm --prefix services/policy-proxy run typecheck && npm --prefix services/policy-proxy test
npm --prefix services/agent-server run typecheck && npm --prefix services/agent-server test
npm --prefix services/mock-backend run typecheck && npm --prefix services/mock-backend test
npm --prefix apps/studio run typecheck
# E2E는 코디네이터가 포트를 배정한 뒤 실행(W6-common: 1차 웨이브 dev-up 금지)
```

## 7. 의도적 제외

| 제외 | 이유 |
|---|---|
| OpenAPI 3.0·Swagger 2.0·YAML·GraphQL·gRPC 입력과 자동 변환 | 형식 하나로 diff·마스킹 규칙을 고정 |
| 스키마 URL 가져오기(서버가 원격 스키마 fetch) | SSRF. 파일 업로드·붙여넣기만 |
| upstream·owners를 UI에서 추가·변경 | 서버 설정과 platform-admin 호환 경로로만 |
| 런타임 필드 단위 사용 추적(응답 필드 접근 계측) | 프리뷰 런타임 계측이 필요. static + audit operation으로 대신 |
| pin 자동 업그레이드, breaking 변경에 맞춘 코드 자동 수정 | 사람이 영향 확인 후 올린다 |
| API 삭제 | retire만. 감사·이력 보존 |
| 환경별(preview/live) 스키마 분기 | 한 버전은 두 환경에 같은 스키마 |
| 역할별 필드 마스킹, 행 단위 권한 | 기존 `ApiPolicy` 모델 유지 |
| 알림(메일·Slack), draft 만료·승인 SLA | 스튜디오 화면 표시로 충분 |
| live 쓰기 승인 흐름 변경 | P0-1 계약 그대로 |
