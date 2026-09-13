# P0C — 프로젝트 프리뷰·CSP·서비스 환경 격리

2026-09-13. 작업 대상은 실제 로컬 Chrome, localhost 서비스, Keycloak과 MinIO다. 비밀값·토큰·다운로드 비밀번호는 이 보고서에 포함하지 않는다.

## 구현

- 5174의 Host는 계약 UUID 프로젝트 origin만 받는다. `/frame.html`, `/frame.js` 외에는 404, 잘못된 Host는 421이다. 스튜디오는 frame 자산을 제공하지 않으며 벤치 경로는 명시적 플래그 뒤에 있다.
- 프리뷰 응답마다 새 nonce를 생성하여 호스트 설정·import map·부트에 전달한다. CSP는 응답 헤더이며 script unsafe-inline/unsafe-eval과 connect self를 허용하지 않는다.
- 프리뷰 부모 origin은 localhost:5173 하나다. 런타임이 origin·token·hostConfig 프로젝트를 맞추고 origin/source 메시지 검증을 유지한다. 프로젝트 전환은 새 런타임을 생성하며 이전 스트림·쓰기 상태·늦은 요청 결과를 분리한다.
- CSP 위반은 기존 runtime_failed 형태의 `CSP_BLOCKED` 진단이다. 커밋 후에도 인증된 프레임 메시지 리스너를 유지하고 교체·dispose 때 제거한다.
- 스튜디오 frame-src는 프로젝트 프리뷰 패턴만 허용한다. Keycloak SSO 복원은 최상위 prompt=none PKCE 리다이렉트로 바꾸었으며 익명 실패는 로그인 버튼으로 종료한다. sessionStorage에는 시도 플래그·기존 PKCE 트랜잭션만 두고 토큰은 계속 메모리에 유지한다. 갱신에는 refresh-token grant만 쓰며 iframe fallback은 거부한다.
- TypeScript 7 설치본에는 기존 compiler AST API가 없으므로 런타임 의존성 `typescript-ast = npm:typescript@5.9.3`을 고정했다. 문자열 규칙과 함께 계산된 전역 접근, 전역 구조 분해, 리플렉션, 동적 코드 평가/import, Worker를 HTTP 저장·생성 finish 양쪽에서 거부한다. AST는 보조 수단이며 네트워크 차단은 CSP가 담당한다.
- dev-up 자식 env는 allowlist를 사용한다. runtime, npm registry setup/publish, Docker bootstrap의 목록을 분리했다. 관리 서비스와 publication helper는 루트 dotenv 재로딩을 건너뛴다.
- mock-backend의 파생 live 토큰 기본값을 제거하고 두 토큰의 누락·동일 값을 거부한다.
- 다운로드 KEK/서명 키와 policy MinIO 비밀번호를 무작위 생성·0600 저장한다. MinIO의 번들 mc로 두 버킷과 별도 policy 사용자를 만들고, policy 자격증명은 dependencies 버킷에 접근할 수 없다. audit 버킷 object lock을 실제 API로 확인하며 켜져 있지 않으면 dev-up이 실패한다.

코디네이터가 허용한 소유권 예외: deps-builder `src/config.ts`, `scripts/setup-registry.mjs`의 관리 dotenv guard; `src/server.ts`의 GET/HEAD `/assets/**` 전용 프로젝트 CORS와 관련 `test/cors.test.ts`. 관리 API는 studio origin만 허용하며 credentials CORS를 허용하지 않는다. contracts, policy-proxy, agent driver, evals는 이 워커가 수정하지 않았다.

## 실제 CSP 증거

`tests/isolation.spec.ts` Y는 서비스가 발급한 실제 프리뷰에서 초기 meta가 사라지고 nonce 스크립트가 남아 있음을 확인하여 document.open/write 후 문서에서 실행됐음을 확인한다. Playwright route로 요청을 차단하거나 CSP 헤더를 합성하지 않는다.

| probe | Chromium 위반 | 서버 관측 |
|---|---|---|
| 상대 URL fetch | connect-src | 5174 probe 수신 카운터 증가 0 |
| 계산된 `globalThis['fet'+'ch']` 별칭 | connect-src | 5174 probe 수신 카운터 증가 0 |
| 다른 origin localhost:7351 fetch | connect-src | 별도 HTTP 수신 서버 요청 0 |
| localhost:7351 이미지 비콘 | img-src | 별도 HTTP 수신 서버 요청 0 |
| 같은 프로젝트의 @toi/fetch 조회 | 허용 | 실제 policy 응답의 마스킹된 전화번호 DOM 표시 |

X는 다른 프로젝트의 localStorage에 같은 키가 없음을 확인하고, 같은 부모에 붙인 다른 프로젝트 iframe의 localStorage 직접 접근이 SecurityError임을 확인한다. 동일 컨트롤러에서 프로젝트 변경 후 iframe origin과 런타임도 교체된다. Z는 A의 세션·capability를 B origin에서 보내 403 PREVIEW_ORIGIN_MISMATCH를 확인한다. AA는 Host/경로/nonce/임베딩 헤더를, AB는 저장 API의 AST 우회 거부와 revision 미변경을 확인한다.

## 검증

- studio: typecheck, 13 tests pass.
- preview-runtime: typecheck, 36 unit tests, 24 browser tests pass.
- agent-server: typecheck, 119 tests pass / 1 external-credential test skip (P0D 후속 변경에 따라 최종 총수는 달라질 수 있음).
- mock-backend: typecheck, 6 tests pass.
- scripts: 9 node tests pass, 변경 mjs 문법 검사 pass.
- deps-builder: typecheck, 자산/관리 CORS 회귀 테스트 pass.
- 실제 MinIO: audit objectLockEnabled=Enabled, policy 계정의 dependencies 버킷 접근 AccessDenied.
- 표적 E2E: X–AB 5/5, 이어서 R을 제외한 identity/studio/isolation 27/27 pass.
- 전체 3회 E2E: **99 passed, 0 skipped, 0 unexpected, 0 flaky** (33개 시나리오 × 3회, 454.5초 / 7.6분). 최종 시작 시각 2026-09-13 12:12:48 UTC, Chrome 153.0.8010.36 / Node 22.14.0.
  - 명령: `npm --prefix e2e run test:repeat`
  - 원본 JSON: [artifacts/results.json](artifacts/results.json)
  - 실행 로그: [artifacts/p0c-repeat-final.log](artifacts/p0c-repeat-final.log)
  - 시나리오별 3회 통과·복원 readback·코드 SHA-256: [artifacts/p0c-validation.json](artifacts/p0c-validation.json)
  - 마지막 실행 뒤 bob enabled=true와 client 임시 TTL override 없음(null)을 다시 읽어 확인했다.

첫 통합 시도는 새 다운로드 패널로 중복된 CSS 선택자와 최상위 SSO 리다이렉트 중 DOM 평가라는 기존 테스트 가정을 드러냈다. 해당 선택자와 인증 완료 대기를 수정했다. 공유 Keycloak을 바꾸는 R이 통과·복원된 뒤에만 시도를 중단했으며, 실제 readback에서 bob enabled=true, toi-studio access.token.lifespan 임시 override 없음(null)을 확인했다. 최종 R 테스트에는 사용자 enabled와 client TTL 모두 복원 후 readback 검증을 넣었다.

관리 밖에 남아 있던 deps-builder는 cwd와 process group을 확인하고 코디네이터 확인 후 해당 그룹만 종료했다. 현재 서비스는 모두 dev-up의 processes.json으로 관리된다. 각 정책 재기동은 P0B에 사전 통보했고 최종 E2E 중에는 서비스·Keycloak 설정을 임의로 변경하지 않는다.

## 환경 키

정확한 전체 allowlist는 `scripts/service-env.mjs`다. registry setup/publish 자식은 공통 실행 키와 TOI_MANAGED_ENV, TOI_REGISTRY_URL, TOI_REGISTRY_TOKEN만 받는다. Docker bootstrap만 MinIO 관리자와 Keycloak bootstrap 비밀을 받고, 정책 runtime의 MINIO_ROOT_USER/PASSWORD에는 별도 TOI_POLICY_MINIO_USER/PASSWORD 값이 매핑된다. `TOI_E2E=true`일 때만 probe 수신 카운터 경로가 열리며 토큰·본문·일반 요청은 기록하지 않는다.

`*.localhost`를 지원하지 않는 환경에 대한 공유 origin fallback이나 hosts 변경은 하지 않았다. 운영 TLS·DNS는 배포 환경에서 별도 구성해야 한다. audit bucket object lock 활성화는 기본 retention 자동 적용과 다르며, 실제 세그먼트 보존은 policy-proxy의 업로드 retention 설정을 따른다.

## 합의된 후속 과제: 기존 비교 벤치

코디네이터 메시지 `bench 호환성 결정`(2026-09-13 12:13:30 UTC)으로 root bench와 runtime package bench 이행은 이번 범위에서 제외했다. `npm --prefix packages/preview-runtime run bench`는 브라우저 origin 5273/5274를 가정하고, `bench/toi.js`는 localhost:5174와 UUID가 아닌 projectId=bench를 사용한다. 따라서 새 엄격한 런타임에서 실행할 수 없고, 명시적 벤치 플래그는 자산 경로를 여는 역할만 한다. 필요한 후속 변경은 `previewOriginForProject`를 쓰는 UUID fixture와 브라우저 테스트처럼 논리 origin을 보존하는 fixture HTTP 라우팅이다. CSP를 완화하거나 과거 벤치 숫자를 새 격리 구성의 성능 근거로 사용하지 않았다.

루트 비교 벤치의 재현 명령은 `npm --prefix bench run run`이다(스튜디오 벤치 플래그 필요). 레거시 origin 외에도 임시 builder 포트와 Sandpack 외부 frame이 새 고정 CSP 범위 밖이다. 후속 벤치는 허용된 자산 origin과 별도 fixture 부모 구조를 사용해야 하며 제품 CSP를 넓히는 방식으로 복구하지 않는다.

최종 보고서·텍스트 로그에서 설정 비밀값 및 JWT 패턴이 검출되지 않았고 `.env` 모드는 0600이다. 환경변수 allowlist는 프로세스 파일시스템 권한 격리를 대신하지 않는다.
