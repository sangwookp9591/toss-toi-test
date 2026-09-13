# F1: 정책 경계 강화 — R1의 C1·H1·H2·M1 수정 (services/policy-proxy, e2e, scripts)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 수정할 곳: `services/policy-proxy/`, `e2e/tests/`, `scripts/dev-up.mjs`, 루트·서비스 `.env.example`
- 반드시 읽을 것: `docs/review/REVIEW.md`(C1, H1, H2, M1, 수정 우선순위), `docs/review/repro/01~03`, `contracts/src/policy.ts`, `contracts/src/runtime.ts`(PreviewHostConfig 보안 주석), `intent/INTENT.md` Constraints

## Change
### C1 (critical) 프리뷰가 세션·capability를 스스로 발급하지 못하게
1. origin별 엔드포인트 허용을 분리한다.
   - 프리뷰 origin(5174): `/proxy/*`만 허용. `/dev/session`, `/capabilities`, `/apis*`, `/audit`는 **서버 측에서 `Origin` 헤더로 403 거부**(CORS 헤더 미부여만으로는 부족: 단순 요청은 서버에서 실행된다).
   - 스튜디오 origin(5173)과 Origin 헤더 없는 서버 간 호출만 발급 엔드포인트 허용.
2. `POST /dev/session`, `POST /capabilities`는 `Content-Type: application/json`이 아니면 415로 거부한다(프리플라이트 강제).
3. `/dev/session`의 역할 발급 제한: 브라우저(Origin 있음) 요청은 `viewer`, `editor`까지만. `platform-admin`은 `Authorization: Bearer <TOI_DEV_ADMIN_TOKEN>`(서버 env) 헤더가 있을 때만(시드·운영 스크립트용).
4. `GET /audit`: `platform-admin`이 아니면 `projectId` 필터 필수 + 요청자 subject의 기록만. platform-admin만 전체 조회.
5. 계약 주석과 동작이 맞도록 README에 판정표 갱신. 계약 파일은 수정하지 말고 필요 시 ask.

### H1 (high) 운영 기본값
6. 기동 가드: `NODE_ENV==='production'`이면 (i) session/capability/upstream 시크릿이 저장소에 적힌 알려진 기본값(현재 코드·`.env.example`의 값)과 같거나 32바이트 미만이면 기동 거부, (ii) `TOI_DEV_AUTH_ENABLED`가 `false`가 아니면 거부, (iii) `TOI_DEV_ADMIN_TOKEN`이 설정돼 있어도 거부.
7. `NODE_ENV` 미설정은 development로 명시 취급하되 기본 시크릿 대신 **프로세스 시작 시 무작위 시크릿**을 쓰거나, `scripts/dev-up.mjs`가 루트 `.env`에 없으면 무작위 시크릿을 생성해 저장(gitignore 확인)하고 서비스에 전달한다. 저장소에 적힌 기본 시크릿으로 위조한 세션이 **실행 중 서비스에서 거부**되어야 한다.
8. 서비스 `.env.example`의 `TOI_DEV_AUTH_ENABLED=true`는 주석과 함께 dev 전용임을 명시하고 운영 경고를 README에.

### H2 (high) 경로 우회
9. 프록시 경로 처리: 디코딩을 고정점까지 반복(최대 3회)하고, 결과에 `%`가 남거나 `.`/`..` 세그먼트·백슬래시·인코딩된 `/`(`%2f`)가 있으면 400. upstream URL은 `new URL(normalizedPath, upstreamBaseUrl)`로 만들고 결과 pathname이 **등록 템플릿에 매칭된 정규화 경로와 정확히 같을 때만** 호출한다. 템플릿 변수 세그먼트에는 `.`만으로 된 값 금지.

### M1 (medium) 마스킹 견고화
10. 규칙 매칭을 필드명 대소문자 무시로. 규칙의 마지막 키가 객체/배열 값을 가리키면 하위 문자열 전부 같은 MaskKind로 마스킹.
11. 잔여 PII 스캔: 마스킹 후 응답 전체의 문자열 값을 휴대폰·주민번호·계좌·이메일 정규식으로 검사해 발견 시 해당 kind로 마스킹하고 감사에 `maskedFields`(`/경로 (detected)`)와 `policyWarnings: ["unregistered_pii_field"]`를 남긴다. JSON이 아닌 응답에 PII 패턴이 있으면 차단(502)하고 감사.
12. 등록 규칙이 응답에서 하나도 매칭되지 않으면 감사에 `policyWarnings: ["mask_rules_unmatched"]`. (AuditRecord 확장 필드는 선택 필드로 추가 — 계약 타입과 충돌하면 ask)

### 테스트
13. `services/policy-proxy` 테스트 추가: repro 01·02·03의 각 공격이 **막히는지** 단언(프리뷰 Origin으로 dev/session·capabilities·audit 403, text/plain 415, 브라우저 요청의 platform-admin 거부, 운영 가드 기동 거부 케이스 표, 이중·삼중 인코딩 경로 400, 대소문자/중첩/배열/객체 phone 마스킹 + 경고).
14. E2E D 보강(`e2e/tests/studio.spec.ts`): 프리뷰 iframe 안에서 생성 코드가 `fetch('http://localhost:7200/dev/session', {method:'POST', body: ...})`(Content-Type 미지정)과 `/capabilities`를 호출해도 **토큰을 얻지 못함**을 실제 Chrome에서 검증.
15. `docs/review/repro/01~03`을 수정 후 서비스에 다시 실행해 결과를 `docs/review/repro/after/`에 저장(원래 repro 파일은 보존).

## Constraints
- 편집 범위 밖(`contracts/`, `packages/`, `services/agent-server`, `services/deps-builder`, `apps/studio` 코드) 수정 금지. 스튜디오가 새 규칙(Content-Type, Origin) 때문에 깨지면 재현 절차와 함께 ask.
- 전역 설치 금지, git commit 금지. 실행 중 7200은 수정 후 재시작해도 된다.
- 기존 policy 12케이스 판정표·E2E A~F가 계속 통과해야 한다.

## Ownership
- 편집 가능: `services/policy-proxy/**`, `e2e/tests/**`, `scripts/dev-up.mjs`, `scripts/dev-down.mjs`, `.env.example`, `services/policy-proxy/.env.example`, `docs/review/repro/after/**`
- F2가 병렬로 `services/deps-builder/**`, `services/agent-server/**`, `bench/README.md`를 수정한다.

## Observable acceptance
- `cd services/policy-proxy && npm run typecheck && npm test` 통과(추가 테스트 포함).
- `npm --prefix e2e run test:repeat` 18/18 이상 통과(보강된 D 포함).
- `docs/review/repro/after/`에서 C1·H1·H2·M1 공격이 전부 차단된 출력.
- README 판정표·운영 경고 갱신.
