# 의존성 조합 빌더

Node 22 + TypeScript 서비스이며 [`package-set.ts`](../../contracts/src/package-set.ts)의 API를 포트 **7100**에서 구현한다. `@toi/tds`를 포함한 전체 의존성 그래프를 하나의 esbuild 호출로 번들하고, 검증이 끝난 immutable 산출물만 브라우저에 공개한다.

## 실행

저장소 루트에서:

```sh
docker compose -f infra/docker-compose.yml up -d
npm --prefix packages/fake-tds ci
npm --prefix services/deps-builder ci
npm --prefix services/deps-builder run setup-registry
npm --prefix services/deps-builder start
```

`setup-registry`는 인증 없는 `@toi/tds` 조회가 401/404인지 먼저 확인하고, 로컬 사용자를 생성해 발급받은 토큰을 루트 `.env`에 0600 권한으로 기록한다. 이어 ESM + `.d.ts` 패키지 `@toi/tds@1.0.0`, `1.1.0`을 publish하고 인증 차단을 다시 확인한다. 재실행 시 기존 토큰과 버전을 재사용한다. 토큰 원문은 출력하지 않는다. 잘못된 기존 토큰은 자동 덮어쓰지 않는다.

환경변수 예시는 [`.env.example`](.env.example). MinIO 기본 접속값은 compose와 동일하다. 브라우저는 MinIO와 Verdaccio에 직접 접근하지 않는다.

```sh
curl -i -X POST http://localhost:7100/package-sets \
  -H 'Content-Type: application/json' \
  -d '{"entries":["react","react/jsx-runtime","react-dom/client","@toi/tds"],"dependencies":{"react":"19.3.0","react-dom":"19.3.0","@toi/tds":"1.0.0"}}'
# 첫 응답의 artifactKey로 조회:
curl 'http://localhost:7100/package-sets/ARTIFACT_KEY/wait?timeoutMs=30000'
```

첫 POST는 실제 lockfile을 얻는 설치 단계까지 기다린 후 `202 building`을 반환한다. 따라서 202 자체가 즉시 반환되는 job 접수 API는 아니다. 이후 GET/wait는 `ready` 또는 `failed`를 반환하며, 같은 POST는 `200 ready`로 적중한다. `GET /healthz`도 제공한다.

## 파이프라인과 키

1. 입력은 npm 패키지명, semver 범위와 해당 dependencies에 속한 공개 entry만 허용한다. 파일·Git·tarball URL은 허용하지 않는다.
2. 서비스 `.cache`에 임시 workspace를 만들고 `package.json`, `.yarnrc.yml`을 쓴다. **Yarn Berry 4.18.0**은 로컬 `@yarnpkg/cli-dist`에 고정한다. `nodeLinker: node-modules`, 로컬 tarball·metadata cache(`globalFolder`도 서비스 안으로 격리), 글로벌 mirror 비활성화, lifecycle scripts 비활성화로 설치한다. 게시 직후 테스트해야 하는 로컬 fixture `@toi/tds`만 Yarn age gate의 사전 승인 목록에 넣고, 나머지 패키지는 1440분 gate를 유지한다. `npmScopes.toi.npmAuthToken`은 `${TOI_REGISTRY_TOKEN-}` 환경변수 참조만 기록한다.
3. raw lockfile bytes를 확보한 후 두 키를 계산한다. `tossPackageSetHash`는 원형 `sha256(JSON.stringify({entries: sorted, lockfileHash: sha256(rawLock)})).slice(0,16)`이다. 저장 키 `artifactKey`는 `{entries, lockfileSha256, buildProfile}`을 모든 객체 키가 정렬된 JSON으로 직렬화한 SHA256 전체 64 hex이다.
4. buildProfile에는 esbuild/Yarn 버전, target, NODE_ENV, conditions, 설정 digest, registry 정책 namespace가 들어간다. 코드의 번들 정책을 바꾸면 `buildConfig.revision` 또는 해당 설정도 함께 변경해야 한다. 토큰은 입력에 포함하지 않는다.
5. 전체 entries를 **한 번의 esbuild ESM code splitting 빌드**에 전달한다. CommonJS 공개 API는 소스를 실행하지 않는 `cjs-module-lexer` 기반 facade로 named/default exports를 제공한다. 공유 React 코드는 shared chunk가 되며, nested React 설치가 여러 개 탐지되면 실패한다.
6. 파일별 SHA256·bytes를 기록하고 MinIO에 업로드한 뒤 **객체를 다시 읽어 SHA256을 검증**한다. 모든 파일 검증 후 `manifest.json`을 마지막에 업로드한다. HTTP 자산 경로도 ready manifest에 등록된 파일만 반환한다.

실제 산출물은 `<artifactKey>/<file>`에만 저장한다. `requests/<requestDigest>.json`은 요청에서 이미 해석한 artifactKey를 찾기 위한 보조 색인이다. 재시작 후 색인→manifest 적중이면 설치 없이 200을 반환한다. 정확한 버전 조합은 색인을 계속 재사용하며 범위 버전은 5분마다 다시 해석한다. 진행 중 요청은 요청 digest로 설치를 합치고, 빌드는 artifactKey로 단일 소유권을 가진다. 실패하면 failed 상태로 전환하고 다음 POST에서 다시 설치·빌드한다.

R1 M3 보강: install 전 후보 키는 `{entries: 정렬, dependencies: 키 정렬, buildProfile}`의 정규화 JSON SHA256이다. entries·dependency 키 순서만 다른 요청은 설치부터 1회로 합친다. install 후에는 계산된 artifactKey로 예약을 먼저 잡고 진행 중 빌드와 저장소 manifest를 재확인한다. 저장소 조회의 비동기 구간에도 예약을 유지하므로 서로 다른 후보가 같은 raw lockfile로 수렴하면 빌드·자산 업로드·최종 manifest 게시는 1회다.

서로 다른 range(`react: "^19.0.0"` / `"19.3.0"`)는 lockfile 전에는 동일 artifact인지 알 수 없어 **install이 2회 발생할 수 있다**. 완전한 사전 병합을 보장하지 않는다. 또한 같은 resolved version이어도 Yarn lockfile에 range descriptor가 달리 남으면 raw bytes와 artifactKey도 다르다. 회귀 테스트는 install fixture가 동일 raw lock bytes를 반환하도록 보장해 수렴 경계를 결정적으로 검사하며, 실제 Yarn이 위 두 요청에 늘 동일 lockfile을 만든다고 주장하지 않는다.

## esbuild 선택과 싱글톤

서버에서 필요한 것은 HTML/dev server가 아니라 ESM library entry와 shared chunk다. esbuild는 이 경로를 작은 API로 제공하며 [공식 code splitting 설명](https://esbuild.github.io/api/#splitting)처럼 공유 모듈을 청크로 추출한다. Vite 8의 앱/CSS 파이프라인은 이 PoC의 JS 중심 승인 카탈로그에는 추가 계층이다. Yarn 설정은 [공식 yarnrc 문서](https://yarnpkg.com/configuration/yarnrc)를 따른다.

`@toi/tds`는 React 19 peer dependency만 두며 React를 자체 번들하지 않는다. `ToastProvider`, `useToast`를 통한 Context 공유와 앱의 useState 클릭 갱신을 실제 Chrome에서 검증한다. `react`, `react-dom/client`, `@toi/tds`는 같은 산출 import map에서 로드한다. W1의 프리뷰 포트를 점유하지 않도록 테스트 HTML은 Playwright route fulfillment로 공급한다. 이 합성 페이지는 Chrome의 address-space 판정을 실제 HTTP 페이지와 다르게 받으므로 테스트의 임시 browser Context에만 `loopback-network` 권한을 부여한다. 실제 자산 HTTP와 CORS 검사는 유지한다. 관련 동작은 [Chrome Local Network Access 설명](https://developer.chrome.com/blog/local-network-access)을 참고한다.

## 보안 경계와 한계

- 레지스트리 자격증명은 설치 subprocess의 환경변수로만 전달하고 `.yarnrc`에는 참조만 둔다. 설치 subprocess에는 MinIO·upstream API 자격증명을 전달하지 않는다. 토큰·URI 인코딩·base64 형태 및 auth 필드를 로그 sink에서 마스킹하고, HTTP 오류는 일반 메시지로 응답한다.
- 산출물은 공개 브라우저 실행용 코드다. 토큰 차단과 패키지 코드 접근 제어는 별개다. 자산 CORS는 `http://localhost:5173`, `http://localhost:5174`만 허용하며 CORS 자체가 인증은 아니다. 이 로컬 PoC API에는 SSO·요청 권한·quota가 없다.
- single-flight는 **프로세스 하나** 범위다. 여러 replica를 운영하려면 분산 lease/lock과 publish 조건부 쓰기가 필요하다. 임시 workspace는 정리하지만 Yarn cache와 MinIO artifact의 GC 정책은 아직 없다.
- lifecycle scripts와 임의 URL 설치는 막지만 이 프로세스는 악성 패키지용 OS sandbox가 아니다. 운영에서는 승인 카탈로그, egress 제한, 격리된 워커가 필요하다.
- 임의 CSS·이미지·native/browser 비호환 패키지를 처리하는 일반 CDN은 아니다. import-only exports 조건에만 존재하는 일부 공개 subpath는 Node의 정적 require.resolve 단계에서 거절될 수 있다. React singleton은 한 window/module graph 안의 보장이다.
- exact 버전의 레지스트리 overwrite는 허용되지 않는다는 전제다. registry 해석 정책이 바뀌면 registryNamespace를 변경한다. 공개 base URL을 변경할 때 기존 manifest의 절대 URL에 주의하고 새 namespace를 사용한다.
- wait의 최대 대기는 30초다. 설치는 120초 timeout을 가진다. 처음 202까지의 설치 지연, 실패 상태의 재시작 후 유지, 대형 그래프 부하 제어는 후속 운영 과제다.

## 검증과 측정

```sh
cd services/deps-builder
npm run typecheck
npm test
npm run bench
```

통합 테스트는 실제 Verdaccio·MinIO와 시스템 Chrome이 필요하다. `CHROME_PATH`로 실행 파일을 지정할 수 있다. 인증 실패→성공, miss→202→ready→200, 동시 5요청 빌드 1회, 업로드 중 building/manifest 미공개, 파일 SHA256, 재시작 캐시, 버전 변경, 실패 재시도, 로그 마스킹 및 Context 공유를 검사한다. 테스트별 임시 MinIO bucket은 종료 시 제거한다.

측정 원시 3회와 중앙값은 [`bench/results.json`](bench/results.json), Chrome 증거는 [`bench/singleton-results.json`](bench/singleton-results.json)에 기록한다. cold는 매회 빈 Yarn cache/workspace/MinIO bucket에서 HTTP 요청 시작부터 ready까지이며 Verdaccio upstream·OS cache는 비우지 않는다. warm은 같은 POST의 전체 응답, download는 manifest 후 전체 파일 병렬 다운로드와 hash 검증이다. 로컬 무압축 HTTP 소표본이며 사용자 p95나 WAN/CDN 성능을 뜻하지 않는다.

### 확인된 결과 (2026-09-13)

- R1 수정 후 `npm run typecheck && npm test`: **12/12 통과**, skipped 0. 기존 10개 유지 + 후보 키 정규화와 range 수렴 single-flight 2개 추가. install·bundle 호출 카운터, 객체별 put 카운터, manifest 개수로 단일 빌드·업로드를 단언하며 진행 중 빌드 재진입과 저장소 적중도 확인했다.
- 시스템 Chrome **153.0.8010.36**: React 객체 동일, hooks 클릭 갱신 정상, Context 공유 정상, page/console error **0**.
- 레지스트리 setup 재실행: 두 버전 재사용 성공, 인증 없는 metadata **401** 유지.
- 기본 포트 **7100** 실요청: 최초 **202 → ready**, 재요청 **200**, 자산 **7개**. 서비스와 compose 컨테이너는 실행 중인 상태로 인계.

| 측정 | 3회 중앙값 |
|---|---:|
| Cold 조합 준비 | 1852.524 ms |
| Warm POST | 3.405 ms |
| Manifest + 전체 자산 다운로드 | 12.537 ms |

최종 cold 측정은 tarball뿐 아니라 Yarn metadata/globalFolder cache도 매회 비운 결과다. 앞서 metadata cache를 재사용한 탐색 측정과 구분한다. 실행 환경은 Apple M4 / macOS arm64 / Node 22.14.0이며 원시값과 정확한 정의는 results.json에 있다.


## QA2: 실패 코드와 재시도

HTTP 오류 및 artifact `failed` 상태에는 `PackageSetFailureCode`의 `code`를 기록한다. 입력 검증이나 정상 레지스트리가 확인한 패키지/버전 부재는 `input` (HTTP 400), 연결 거부·DNS·타임아웃·HTTP 5xx·레지스트리 health 실패는 `registry_unavailable` (503), MinIO 읽기/쓰기/연결 실패는 `storage_unavailable` (503), 나머지는 `internal` (500)이다. GET 상태/long poll은 정상 조회된 `failed` 객체와 코드를 반환한다. 설치 전에 실패하면 lockfile 기반 artifactKey가 아직 없으므로 HTTP 오류로 반환한다.

Yarn 출력의 명확한 네트워크 오류를 먼저 분류한다. 그 외에는 `GET <registry>/-/ping`을 3초 제한으로 확인하며, 정상 응답일 때만 명확한 패키지 404/버전 부재를 input으로 판정한다. 건강한 레지스트리에서 원인을 알 수 없는 Yarn 실패는 internal이다. Yarn HTTP 요청은 10초 제한, 자동 재시도 0회이고 설치 전체 상한은 120초다. 로그는 토큰을 마스킹하고 HTTP 오류는 원문 로그를 반환하지 않는다.

실패 요청은 single-flight 완료 시 제거하고 failed artifact는 다음 POST에서 다시 설치/빌드한다. 실패 산출물을 ready 캐시로 게시하지 않는다. 스튜디오는 코드로 레지스트리·구성 요소 저장소·패키지 입력을 구분하고 같은 revision의 “다시 시도”를 제공한다.

`test/failure.test.ts`는 실제 Yarn과 연결 거부 서버, 정상 ping+패키지 404 서버, DNS/타임아웃/5xx, 모호한 오류의 health 검사, HTTP 코드, 비동기 failed 코드와 같은 요청 재시도를 검증한다. E2E M의 `test/registry-fixture.ts`는 별도 프로세스와 임시 포트의 레지스트리 프록시에서 503을 주입하고 복구한다. 공용 서비스나 캐시를 중단·삭제하지 않으며 private IPC로만 제어한다.
