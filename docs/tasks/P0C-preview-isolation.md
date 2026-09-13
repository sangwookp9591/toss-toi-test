# P0C: 프로젝트별 프리뷰 origin·CSP·서비스 env 격리 (P0-2)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`. 서비스는 떠 있다(`node scripts/dev-up.mjs`).
- 반드시 읽을 것:
  - `docs/P0-DESIGN.md`
  - `contracts/src/runtime.ts`(P0-2 절: `previewOriginForProject`, 프리뷰 서버·CSP 규칙)
  - `contracts/src/policy.ts`(P0-2 CORS)
  - `docs/compare/TOSS-GAP.md` P0-2
  - `packages/preview-runtime/src/{index,frame}.ts`, `apps/studio/scripts/dev.mjs`, `apps/studio/src/controller.ts`, `scripts/dev-up.mjs`
  - `evals/README.md`의 보안 발견(계산된 전역 fetch 별칭 + 상대 URL로 문자열 source policy 우회)
- 병렬 워커: P0B(다운로드·감사, `docs/tasks/P0B-downloads-audit.md`)가 policy-proxy를, P0D가 agent-server 드라이버와 evals를 동시에 작업한다.

## Change
1. **프리뷰 서버 분리** (`apps/studio/scripts/**`)
   - 5174는 Host가 `p-<uuid>.preview.localhost:5174`일 때만 frame 문서와 frame 스크립트를 제공한다. 그 밖의 Host는 421, 그 밖의 경로는 404.
   - 5173은 프리뷰 자산을 제공하지 않는다. 벤치 경로는 별도 플래그일 때만 연다.
   - frame 응답에 계약의 CSP를 헤더로 붙인다.
     - `'unsafe-eval'` 금지, script `'unsafe-inline'` 금지, `connect-src`에 `'self'` 금지.
     - 인라인 부트와 import map은 응답마다 새 nonce 등으로 허용한다. `document.open/write` 뒤에도 CSP가 유지되는지 실제 브라우저에서 확인한다. 유지되지 않으면 부트 구조를 바꾼다(예: 외부 부트 스크립트 + postMessage payload).
   - 스튜디오 응답에 `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`, 프리뷰 origin 패턴만 허용하는 `frame-src`를 붙인다.
2. **preview-runtime** (`packages/preview-runtime/**`)
   - `previewOrigin`은 프로젝트별 origin만 받는다.
   - frame의 허용 부모 origin은 스튜디오 하나로 줄인다.
   - 메시지 origin·source 검증은 유지한다.
   - CSP 위반(`securitypolicyviolation`)을 진단 이벤트로 올려 스튜디오가 "차단된 요청"으로 보여 줄 수 있게 한다. 기존 이벤트 형태는 깨지 않는다(필요하면 코디네이터에게 ask).
3. **스튜디오** (`apps/studio/src/controller.ts` 등, 단 `download-panel.tsx`·`main.tsx`는 P0B 소유)
   - `previewOriginForProject(projectId)`로 런타임을 만들고, 프로젝트가 바뀌면 런타임을 새로 만든다.
   - 프리뷰 세션·capability는 해당 프로젝트 것만 넘긴다.
4. **agent-server source policy** (`services/agent-server/src/source-policy.ts`와 테스트)
   - 문자열 규칙에 AST 검사를 더한다(파서는 버전 고정, 이미 있는 `typescript` 사용 가능).
   - 최소한 다음을 막는다.
     - 전역 객체(`globalThis`·`window`·`self`·`top`·`parent`·`frames`)의 계산된 멤버 접근과 구조 분해
     - `Reflect.get`/`Object.getOwnPropertyDescriptor`로 전역 접근
     - `eval`·`Function`·`import()` 동적 문자열
     - `new Worker`
   - P0D의 우회 사례를 회귀 테스트로 넣는다.
   - 이 검사는 보조 수단이다. 근본 차단은 CSP라는 점을 README에 적는다.
   - `src/drivers/**`·`main.ts`의 드라이버 선택은 P0D 소유이므로 건드리지 않는다.
5. **서비스별 env allowlist** (`scripts/dev-up.mjs`)
   - 자식 프로세스에 `process.env` 전체를 넘기지 않는다. 서비스마다 필요한 키만 넘긴다(PATH·HOME 등 실행 필수 포함).
   - 예: mock-backend는 서비스 토큰 둘만, studio에는 비밀값 없음.
   - allowlist를 단위 테스트한다.
6. **mock-backend**: 기본 토큰이나 폴백이 남아 있으면 제거한다. env가 없으면 시작을 거부한다.
7. **P0B 지원**
   - dev-up이 P0B가 요청하는 env를 무작위 생성해 `.env`에 쓰고 policy-proxy allowlist에 넣는다: `TOI_DOWNLOAD_KEK`, `TOI_DOWNLOAD_KEK_ID`, `TOI_DOWNLOAD_URL_SECRET` 등, 이름은 P0B와 합의한다.
   - MinIO 버킷(다운로드, 감사 세그먼트, 가능하면 object lock)을 infra/dev-up에 추가한다.
   - 서비스 재기동은 이 워커가 소유한다. 재기동 전에 P0B에 알린다.
8. **E2E**
   - 기존 스펙·헬퍼·설정을 새 origin에 맞게 고친다.
   - `e2e/tests/isolation.spec.ts`(신규)를 추가한다.
     - X: 프리뷰 iframe origin이 `p-<projectId>.preview.localhost:5174`. 두 프로젝트의 프리뷰 origin이 다르고 서로의 localStorage를 못 읽음
     - Y: frame 안에서 상대 URL fetch, 다른 origin fetch, 이미지 비콘, 계산된 전역 fetch 별칭이 CSP로 차단됨(요청이 서버에 도달하지 않음을 서버 측에서 확인). `@toi/fetch` 경로는 계속 동작
     - Z: 프로젝트 A의 프리뷰 세션을 프로젝트 B origin에서 쓰면 proxy 403 `PREVIEW_ORIGIN_MISMATCH`(P0B 구현과 합친 뒤)
     - AA: 5174에 잘못된 Host 421, 스튜디오 번들·esbuild.wasm·벤치 경로 404. 스튜디오 응답의 frame-ancestors·X-Frame-Options 확인
     - AB: AST 우회 사례 소스를 저장하면 거부됨
   - 테스트는 공유 Keycloak 설정을 바꾸면 반드시 명시적으로 복원하고 다시 읽어 확인한다.

## 조율
- policy-proxy CORS는 P0B가 구현한다. 프리뷰 서버 전환 시점을 P0B와 send로 맞춘다.
- `contracts/` 변경이 필요하면 코디네이터에게 ask.

## Constraints
- 수정 금지: `contracts/`, `services/policy-proxy/**`, `services/deps-builder/**`, `services/agent-server/src/drivers/**`, `services/agent-server/src/main.ts`, `evals/**`, `apps/studio/src/download-panel.tsx`, `apps/studio/src/main.tsx`, `e2e/tests/downloads.spec.ts`.
- 전역 설치 금지, `/etc/hosts` 등 시스템 설정 변경 금지, git commit 금지. 비밀값을 로그·문서·스크린샷에 남기지 않는다.
- 기존 보안 강화(revision guard, Origin, CAS, 인증 흐름)를 약화시키지 않는다.

## Ownership
- 편집 가능: `apps/studio/**`(위 두 파일 제외), `packages/preview-runtime/**`, `services/agent-server/src/source-policy.ts`와 관련 테스트, `services/mock-backend/**`, `scripts/**`, `infra/**`, `e2e/**`(`downloads.spec.ts` 제외), `.env.example`, 루트 `README.md` 실행 절

## Observable acceptance
- studio·preview-runtime·agent-server·mock-backend·scripts typecheck·test 통과.
- `node scripts/dev-up.mjs --e2e` 후 `npm --prefix e2e run test:repeat`에서 A~S와 X~AB(그리고 P0B의 T~W) 전부 3회 통과.
- 실제 Chromium에서 CSP 헤더가 `document.open` 뒤에도 적용됨을 증명한 기록(테스트 또는 보고서).
- README: 프리뷰 origin 구조, CSP 표, env allowlist 표, `*.localhost`가 동작하지 않는 환경의 한계.
