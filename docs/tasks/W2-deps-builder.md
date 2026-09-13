# W2: 의존성 빌더 + 사내 레지스트리 (services/deps-builder, packages/fake-tds)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 만들 곳: `services/deps-builder/`, `packages/fake-tds/`
- 반드시 읽을 것: `docs/ARCHITECTURE.md`, `contracts/src/package-set.ts`, `infra/docker-compose.yml`, `infra/verdaccio/config.yaml`, `intent/INTENT.md`
- 참고 근거: `astra-report.md` §3~4(싱글톤 실증, 토스 해시 재현), `poc/hash-cases.mjs`, `poc/singleton.mjs`

## Change
1. **사내 레지스트리 재현**: `docker compose -f infra/docker-compose.yml up -d`로 Verdaccio·MinIO 기동. 스크립트(`services/deps-builder/scripts/setup-registry.mjs`)로 사용자 생성 → 토큰 발급 → `.env`(gitignore)에 `TOI_REGISTRY_TOKEN` 기록. **인증 없이 `@toi/tds` 조회가 401/404로 막히는 것**을 확인하는 검사 포함.
2. **`packages/fake-tds` → `@toi/tds@1.0.0` publish**: React 19를 `peerDependencies`로 갖는 작은 디자인시스템(Button, Table, Badge, TextField, `useToast` 같은 공유 상태 1개 — Context 기반이라 React 인스턴스가 둘이면 깨지게). 빌드는 ESM + d.ts. 1.1.0도 publish해 버전 변경 시나리오에 쓴다.
3. **`contracts/src/package-set.ts` HTTP API 구현** (Node 22 + TypeScript, 포트 7100)
   - 조합 파이프라인: 임시 workspace 생성 → `package.json`(dependencies) + `.yarnrc.yml`(`npmScopes.toi` → Verdaccio, `npmAuthToken`은 환경변수에서) → **Yarn Berry**(버전 고정, nodeLinker node-modules, 로컬 캐시) `yarn install` → lockfile 확보 → **조합 전체를 한 번에 빌드**(Vite 8 library/멀티 엔트리 또는 esbuild — 선택 근거 README) → entries마다 import map 엔트리 생성, 공유 청크로 React 등 단일 인스턴스 보장 → 파일 sha256 → MinIO 업로드 → **마지막에 manifest 업로드**.
   - 키: `tossPackageSetHash`(토스 원형 16 hex)와 `artifactKey`(buildProfile 포함) 둘 다 계산해 manifest에 기록. 조회·저장은 `artifactKey` 기준.
   - single-flight: 같은 artifactKey 동시 POST는 빌드 1회. 실패 시 status failed, 재요청 시 재시도.
   - `/assets/:artifactKey/*`: MinIO에서 스트리밍, `Cache-Control: public, max-age=31536000, immutable`, CORS는 5173·5174만.
   - 서버 시작 시 manifest 캐시 적중이면 즉시 200.
   - 레지스트리 토큰은 응답·manifest·로그에 절대 남기지 않는다(로그 마스킹 테스트 포함).
4. **테스트**
   - 해시: 토스 원형 재현(엔트리 순서 무관, lock 공백 → 변경), artifactKey는 builderVersion/configDigest/nodeEnv 변화에 **변경**됨.
   - 통합: 인증 없는 설치 실패 → 토큰으로 성공, 캐시 miss → 202 → ready, 두 번째는 200 적중, 동시 5요청 빌드 1회, 파일 sha256 검증, manifest가 파일보다 먼저 보이지 않음(업로드 중 조회 시 building).
   - **싱글톤 브라우저 검증**(Playwright, 시스템 Chrome): 산출 import map으로 `react`, `react-dom/client`, `@toi/tds`를 로드한 페이지에서 `@toi/tds`의 Context/`useToast`가 앱과 같은 React로 동작(hooks 정상, 에러 0).
5. **측정**(3회 중앙값): cold 조합 빌드(install+build+upload), warm 적중 응답, manifest+전체 자산 다운로드 시간을 `services/deps-builder/bench/results.json`에.

## Constraints
- `services/deps-builder/**`, `packages/fake-tds/**` 밖 수정 금지. `infra/`·`contracts/`는 읽기 전용(설정이 틀리면 ask로 질문). `.env`는 gitignore 대상.
- 전역 설치 금지(Yarn은 패키지 로컬/corepack 고정 버전), git commit 금지.
- 포트 7100. W1이 5173/5174를 쓴다.

## Ownership
- 편집 가능: `services/deps-builder/**`, `packages/fake-tds/**`, 루트 `.env`(생성만)
- W1(preview-runtime)이 병렬로 `packages/preview-runtime/**`를 만든다.

## Observable acceptance
- `cd services/deps-builder && npm test` 전부 통과, 요약을 README에.
- `npm run typecheck` 통과.
- `curl -X POST localhost:7100/package-sets -d '{"entries":["react","react/jsx-runtime","react-dom/client","@toi/tds"],"dependencies":{"react":"19.3.0","react-dom":"19.3.0","@toi/tds":"1.0.0"}}'` → 202 후 ready, 재요청 200.
- `bench/results.json` 원시 3회 + 중앙값. README: 파이프라인, 빌더 선택 근거, 키 설계, 보안 경계, 실행 방법, 한계.
