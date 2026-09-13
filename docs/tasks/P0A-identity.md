# P0A: 실제 identity·프로젝트 멤버십·승인·preview/live 분리 (P0-1)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 반드시 읽을 것: `docs/P0-DESIGN.md`, `contracts/src/auth.ts`, `contracts/src/policy.ts`(환경별 upstream, 판정 순서), `contracts/src/generation.ts`, `docs/compare/TOSS-GAP.md` §4·§5 P0-1, 기존 `services/policy-proxy/README.md`, `apps/studio/README.md`
- 서비스는 떠 있다. 이 작업 중 재시작·재구성해도 된다.

## Change
1. **Keycloak** (`infra/`)
   - `quay.io/keycloak/keycloak:26.3.3`을 compose에 추가한다(포트 8080, dev 모드 가능, 데이터는 볼륨).
   - `infra/keycloak/realm-toi.json` import: realm `toi`, groups `/team-a /team-b /risk /platform`, realm roles `builder api-owner platform-admin`, `docs/P0-DESIGN.md` 사용자 5명.
   - 클라이언트:
     - `toi-studio`: public, PKCE S256, redirect `http://localhost:5173/*`, web origin 5173
     - `toi-agent-server`, `toi-policy-proxy`: confidential, service account 사용
     - audience mapper `toi-api`, groups claim mapper
   - 액세스 토큰 5분, 리프레시 30분.
   - 비밀번호·client secret은 import 파일에 평문으로 넣지 않는다. `scripts/dev-up.mjs`가 무작위로 생성해 `.env`에 저장하고, Keycloak admin API로 설정한다.
2. **policy-proxy**
   - JWKS(`jose` 등 검증된 라이브러리, 버전 고정)로 Keycloak 토큰을 검증한다(iss·aud·exp·서명).
   - `/dev/session`을 제거한다.
   - `POST /preview-sessions`: 스튜디오 origin만, 멤버십·역할 판정 후 하향 세션과 capability를 발급한다.
   - 멤버십은 agent-server internal API(서비스 토큰)로 조회하고 캐시는 5초 이하로 둔다.
   - 승인 API와 live capability 승인 검사(4-eyes, 승인 만료)를 구현한다.
   - `environments` 기반 upstream 선택: capability.env의 upstream만 호출한다.
   - seed를 `environments`·`owners`로 이전한다.
   - 기존 판정·마스킹·Origin·경로 강화는 전부 유지한다.
3. **mock-backend**: `/preview/*`(합성 데이터)와 `/live/*`(별도 데이터셋)를 분리하고, 환경별 서비스 토큰을 따로 둔다. preview 토큰으로 live를 호출하면 401.
4. **agent-server**
   - 모든 사용자 엔드포인트에 Keycloak 토큰 검증을 적용한다.
   - 멤버십 저장·API(`contracts/src/auth.ts`), 역할표 판정, 비멤버 404.
   - `/internal/projects/:id/membership`은 `toi-policy-proxy` 서비스 토큰만 허용한다.
   - policy-proxy 레지스트리 조회는 자신의 서비스 토큰으로 한다.
   - 기존 Origin·JSON 규칙은 유지한다.
5. **studio**
   - OIDC Authorization Code + PKCE 로그인·로그아웃·토큰 갱신(`oidc-client-ts` 등, 버전 고정).
   - 토큰은 메모리 보관을 우선하고, localStorage 사용 여부와 근거를 README에 적는다.
   - 프로젝트 멤버 관리 UI(owner: 추가·역할 변경·제거)와 승인 요청·상태 표시.
   - 프리뷰에는 `/preview-sessions` 결과만 전달한다(Keycloak 토큰 전달 금지).
   - 로그인하지 않았거나 비멤버일 때의 안내 문구.
6. **scripts/dev-up**: Keycloak 기동, realm import, 무작위 사용자 비밀번호·client secret 생성과 `.env` 기록, health 대기, 서비스에 필요한 env 전달. `--check` 유지.
7. **E2E** (`e2e/tests/`)
   - 헬퍼로 Keycloak 실제 로그인을 한다(UI 로그인 1회 + storageState 재사용 허용).
   - 기존 A~M을 인증 흐름으로 이전한다.
   - 추가 시나리오:
     - N: carol(비멤버)은 alice 프로젝트 404, 프리뷰 세션·capability·proxy 거부
     - O: bob을 viewer로 추가 → 생성·저장 403, 프리뷰 read 가능 → editor 승격 → 생성 가능 → 제거 후 5초 안에 proxy 거부
     - P: alice live write capability 요청 → 승인 전 거부 → alice 본인 승인 시도 거부 → dana 승인 → 발급 → 만료 후 거부
     - Q: preview capability로 live upstream 데이터가 절대 나오지 않음(데이터셋 표식으로 확인)
     - R: Keycloak에서 bob 계정 비활성화 → 토큰 갱신 실패 → 5분 이내(테스트는 액세스 토큰 TTL을 짧게 설정 가능) 거부
     - S: 프리뷰 iframe 안에서 Keycloak 토큰이 어떤 전역·storage에도 없음

## Constraints
- 수정 금지: `contracts/`(부족하면 ask), `packages/preview-runtime/`, `services/deps-builder/`, `services/agent-server/src/drivers/**`, `evals/**`. P0D가 병렬로 로컬 모델 드라이버와 평가 하네스를 만든다. agent-server의 `engine.ts`·`main.ts`에서 드라이버 선택 부분이 겹치면 P0D와 충돌하지 않게 인증·라우팅 코드만 수정하고, 필요하면 ask로 조율한다.
- 전역 설치 금지(Docker 이미지 사용은 허용), git commit 금지. 비밀값을 로그·문서·스크린샷에 남기지 않는다.
- 기존 보안 강화(R1·R2·F3, Origin, 경로, 마스킹, CAS, revision guard)를 약화시키지 않는다.

## Ownership
- 편집 가능: `infra/**`, `services/policy-proxy/**`, `services/mock-backend/**`, `services/agent-server/**`(단 `src/drivers/**` 제외), `apps/studio/**`, `scripts/**`, `e2e/**`, 루트 `README.md` 「TOI-lite 실행」 절, `.env.example`

## Observable acceptance
- 각 패키지 typecheck·test 통과(추가 포함). policy-proxy·agent-server에 인증·멤버십·승인·환경 분리 테스트가 있어야 한다.
- `node scripts/dev-up.mjs` 한 줄로 Keycloak 포함 전체 기동.
- `npm --prefix e2e run test:repeat`에서 기존 시나리오(인증 이전) + N~S 전부 3회 통과.
- README: 로그인 방법(테스트 사용자는 `.env`의 비밀번호), 역할표, 승인 흐름, preview/live 분리, 제거된 dev session.
