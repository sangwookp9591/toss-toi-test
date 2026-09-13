# 정책 프록시와 API 레지스트리

포트 7200. Keycloak 액세스 토큰을 `jose@6.1.3`의 JWKS RS256 검증으로 확인한다. issuer는 `http://localhost:8080/realms/toi`, audience는 `toi-api`이며 서명·만료·필수 클레임을 검사한다. `/dev/session`은 제거되어 항상 404다.

## 실행과 로그인

저장소 루트에서 `node scripts/dev-up.mjs`를 실행하고 [스튜디오](http://localhost:5173)에 로그인한다. 사용자 alice/bob/carol/dana/root의 비밀번호는 무작위 생성된 루트 `.env`의 `TOI_PASSWORD_ALICE` 등에서 확인한다. realm import에는 비밀번호와 client secret을 넣지 않는다. dev-up은 Keycloak admin API로 비밀번호·서비스 client secret을 설정하고 파일 권한을 0600으로 제한한다.

```sh
npm --prefix services/policy-proxy run typecheck
npm --prefix services/policy-proxy test
node scripts/dev-up.mjs --check
```

Keycloak 그룹은 alice/bob `/team-a`, carol `/team-b`, dana `/risk`, root `/platform`이다. 조직 역할은 builder(alice/bob/carol), api-owner(dana), platform-admin(root)이다. 조직 역할은 프로젝트 멤버십을 자동 부여하지 않는다. API 등록은 platform-admin만, customers live 쓰기 승인은 등록된 `owners`에 포함된 dana만 가능하다.

## 프로젝트 권한

| 프로젝트 역할 | 허용 동작 |
|---|---|
| viewer | 프로젝트 열기, preview read, 자기 감사 기록 조회 |
| editor | viewer + 생성·답변·취소·소스 저장, preview write |
| owner | editor + 멤버 관리, live capability·쓰기 승인 요청, 프로젝트 감사 조회 |

비멤버는 프로젝트 존재를 노출하지 않도록 404를 받는다. 모든 capability 발급 및 proxy 요청에서 agent-server `/internal/projects/:id/membership`을 조회한다. 캐시가 없으므로 멤버 제거·강등은 다음 요청에 적용된다. 내부 조회에는 `toi-policy-proxy` client credentials 토큰을 쓰고, 장애 시 요청을 거부한다. 계정 비활성화 시 Keycloak 갱신이 실패하며 이미 발급된 액세스 토큰은 최대 5분 후 만료된다. 프리뷰 세션·capability도 원본 액세스 토큰 만료를 넘을 수 없다.

## HTTP

- `GET /apis`, `GET /apis/:apiId`: 사용자 또는 `toi-agent-server` 서비스 계정. 공개 응답에는 `environments`와 OpenAPI 내부 서버·인증 정보가 없다.
- `POST /apis`: platform-admin. 환경별 upstream은 `TOI_UPSTREAM_ALLOWLIST`에 정확히 일치해야 한다.
- `POST /preview-sessions`: 정확한 스튜디오 Origin과 사용자 액세스 토큰 필요. `{projectId, write?:{apiIds,ttlSec}}`를 받아 `{sessionToken,sessionClaims,capabilityToken,capability}`를 반환한다. write는 editor 이상, 최대 120초다. 프리뷰 세션은 `aud=toi-preview`, `roles=["viewer"]`, projectId에 제한되며 `/proxy/*`에서만 쓸 수 있다. Keycloak 토큰은 프리뷰에 전달하지 않는다.
- `POST /capabilities`: `{projectId,mode,env,apiIds?,ttlSec}`. preview write는 editor 이상, live는 owner가 필요하다. live write는 현재 유효한 승인이 추가로 필요하다.
- `POST /approvals`: owner가 `{projectId,apiId,scope:"live-write",justification}`로 요청한다. 사유는 5~500자다.
- `POST /approvals/:id/decision`: `{decision:"approved"|"rejected"}`. 요청자 본인의 승인은 금지한다. 해당 API `owners`에 속하며 realm role api-owner를 가진 다른 사용자만 결정한다. 요청자도 여전히 프로젝트 owner여야 한다.
- `GET /approvals?projectId=`: 프로젝트 멤버 또는 해당 API 승인자. 승인자는 자신이 소유한 API 승인만 본다.
- `ANY /proxy/:apiId/*`: Authorization, X-Toi-Project, X-Toi-Capability, 필요하면 URL 인코딩한 X-Toi-Reason을 사용한다.
- `GET /audit?projectId=&limit=`: viewer/editor는 자기 기록, owner는 프로젝트 기록, platform-admin은 전체 기록.
- `GET /healthz`.

승인은 기본 300초 동안 유효하며 만료 후 발급과 기존 live write capability 사용이 모두 거부된다. 승인 상태는 `data/approvals.json`에 원자적으로 저장되어 재시작 후에도 유지된다. `TOI_APPROVAL_TTL_SEC`는 테스트에서 짧게 설정할 수 있고 최대 3600초다. `node scripts/dev-up.mjs --e2e`는 TTL 8초를 관리 중인 프록시에 적용하고 일반 dev-up은 기본 300초로 복원한다. 승인 후 API 소유자 제거와 프로젝트 역할 변경도 요청마다 다시 확인한다.

## preview/live 분리와 기존 보안 경계

등록 API는 `environments.preview.upstreamBaseUrl`과 `environments.live.upstreamBaseUrl`, `owners`를 보관한다. customers seed는 각각 `http://localhost:7300/preview`, `http://localhost:7300/live`를 사용한다. 프록시는 서명된 capability.env로만 upstream과 서비스 토큰을 선택한다. preview 토큰은 live에서 401이고, 프리뷰 세션과 live capability를 조합해도 403이다. 목록 응답의 `dataset` 표식으로 데이터 경계를 검증할 수 있다.

판정 순서는 인증 → 멤버십 → API 존재 → capability 검증 → 환경 → 역할·메서드 → 조회 사유 → 정규화한 등록 경로 → upstream → 마스킹 → 감사다. Origin은 서버에서 검사하며 프리뷰 Origin(5174)은 `/proxy/*`만 허용한다. CORS preflight도 같은 경계를 따른다. 경로 중첩 인코딩·dot segment·구분자·등록되지 않은 메서드와 redirect는 거부한다. 내부 주소·서비스 토큰·서명 키는 응답·감사에서 제거한다. 이름·전화·이메일·주민번호·계좌 마스킹, 등록되지 않은 PII 탐지와 스키마 드리프트 경고를 유지한다.

감사는 현재 프로세스 내 직렬 append-only JSONL이고 append 실패 시 성공 응답을 보내지 않는다. fsync·해시 체인·암호화 다운로드는 별도 P0-3 작업이다. 이미 완료된 upstream 변경을 감사 저장 실패가 되돌리지는 못한다. 기존 익명 프로젝트는 자동으로 임의 사용자에게 귀속시키지 않으며, 로그인 후 새 프로젝트를 만든다.

## 설정과 검증

루트 `.env`: `TOI_SESSION_SECRET`, `TOI_CAPABILITY_SECRET`, `TOI_PREVIEW_SERVICE_TOKEN`, `TOI_LIVE_SERVICE_TOKEN`, `TOI_POLICY_CLIENT_SECRET`, `TOI_IDENTITY_ISSUER`, `TOI_SUB_DANA`. 키와 환경 토큰은 서로 다른 무작위 값이다. `TOI_AGENT_URL`은 멤버십 원천 주소다. Keycloak 운영 배포에는 TLS·외부 DB·IdP 연동과 별도 네트워크 경계가 필요하다.

단위·통합 테스트는 실제 RS256 키와 HTTP JWKS fixture, 서비스 계정 인증을 사용하는 멤버십 HTTP 원천, 실제 mock upstream을 사용한다. 잘못된 issuer/audience/서명/만료, 비멤버·강등·제거, 4-eyes·중복 결정·만료, preview/live 데이터·토큰 경계와 기존 Origin·경로·마스킹 테스트를 포함한다. 실제 Keycloak UI 로그인과 A~S 반복 검증은 `e2e/`가 담당한다. `bench/`의 기존 수치는 P0 이전 기록이며 새 인증 흐름의 측정치가 아니다.
