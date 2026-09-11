# Astra 독립 조사 — 토스 TOI, 2026-09-11

판정: 토스의 핵심 선택은 **의존성 준비를 화면 진입 경로에서 분리한 것**이다. esbuild-wasm은 이 작은 React/VFS 작업에 적합하지만 유일한 구현 수단은 아니다. 패키지별 ESM에 peer를 external로 남기고 일관된 import map을 적용하면 싱글톤을 보존할 수 있으므로, ‘개별 패키지 배포는 본질적으로 불가능하다’는 일반화는 성립하지 않는다. 다만 이 대안에도 CJS 변환·peer 호환성·원자적 manifest 관리가 필요하다.

조사일은 2026-09-11 KST. 확인은 공개 1차 자료 또는 이번 PoC에서 직접 관찰한 내용, 추정은 그 사실에서 도출한 해석, `unverifiable`은 공개 자료/실측으로 확정하지 못한 내용이다. `opus-analysis.md`는 읽지 않았다. 토스 운영 환경에는 접근하지 않았으므로 발표의 47초→1.3초를 재측정했다고 주장하지 않는다.

## 1. 1차 자료와 Backend 경계

주요 자료: [이현재, AI가 만든 코드가 어드민이 되기까지](https://toss.tech/article/52885) (2026-09-04), [전체 웨비나](https://youtube.com/live/xDVbTlFfu30) (release_date 2026-08-25), 제공받은 [편집 영상](https://www.youtube.com/watch?v=tcGKZANuUVE) 자막 (2026-09-10). 전체 메타데이터의 upload_date는 2026-08-26이며 release_date와 구분해야 한다. 87분 전체 자동자막·설명·메타데이터를 `poc/evidence/webinar.*`와 `webinar-transcript.txt`에 보존했다. 자막의 ‘수웨어’, ‘기 리포’, ‘로그인’ 같은 단어에는 ASR 오류가 있어 전문 용어의 정확한 철자는 별도 주의했다.

|영역|판정·확인된 범위|1차 근거|
|---|---|---|
|사용 흐름/에이전트|확인: API 등록 후 자연어 요청, 보충 질문, planning/code writing. 구체적 채팅↔에이전트 SSE/WebSocket/HTTP chunking, 이벤트 스키마, 재접속·취소 프로토콜은 `unverifiable`.|편집본 02:08–02:46; 전체 [04:26](https://www.youtube.com/watch?v=xDVbTlFfu30&t=266s) 이후|
|API/스키마|확인: 등록 API의 요청·응답 스키마를 코드 생성에 사용. API 부가 설명도 제공. Swagger 계열 문서라는 해석은 추정; OpenAPI 버전, JSON Schema dialect, 등록 payload/endpoint는 `unverifiable`.|기술 글 도입; 전체 [18:00](https://www.youtube.com/watch?v=xDVbTlFfu30&t=1080s)|
|정책 프록시|확인: 등록 API는 TOI 서버가 원 서버로 프록시하고 호출 기록·마스킹·조회 사유·다운로드 암호화 정책을 적용.|편집본 04분대; 기술 글 ‘정책과 화면’|
|인증|확인: 사내 registry는 인증 필요, 브라우저에 registry 인증정보를 노출하지 않으려 proxy를 검토. 사용자 로그인 SSO, API별 토큰 위임, RBAC/ABAC 구현, 쿠키·CSRF 방식은 `unverifiable`.|기술 글 Sandpack 절|
|저장|확인: VFS는 메모리용이며 실제 편집 코드는 S3에서 편집에 따라 갱신. DB 종류, 버전/동시편집 충돌·보존기간은 `unverifiable`.|전체 [17:21–17:34](https://www.youtube.com/watch?v=xDVbTlFfu30&t=1041s)|
|의존성 배포|확인: 엔트리+lock 해시 단위로 Yarn 설치→Vite→import map→S3. 앱 실서비스의 CDN·서버·배포 승인 파이프라인 전체는 `unverifiable`.|전체 [13:35–14:48](https://www.youtube.com/watch?v=xDVbTlFfu30&t=815s)|
|Git/리뷰|**확인: Git repo 연결, PR·컨펌·리뷰 기능을 제공한다.** 복잡한 정책은 팀 개발자가 이 과정으로 커버. 모든 변경에 리뷰가 강제되는지는 `unverifiable`.|전체 [1:20:13–1:20:42](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4813s)|
|추가 연동|확인: 큰 어드민 이동 지원을 위해 MCP와 Git 기반 관리/GitOps를 언급. tool 목록·transport·권한 scope는 `unverifiable`.|전체 [1:22:24–1:22:40](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4944s)|
|대상 사용자/맥락|확인: 서버 개발자가 주 대상이고 디자이너·PO의 가벼운 편집도 고려. TDS를 활용하도록 코드/디자인 맥락 제공.|전체 [1:21:23–1:22:10](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4883s)|
|규모|발표는 약 440 프로젝트·2400 페이지·120 라이브. 기술 글은 2026-02~08에 439 프로젝트·2418 페이지. 미릴리즈 프로젝트를 회수하지 않았다는 답변도 있다.|편집본 03:12–03:34; 전체 [1:19:28–1:19:47](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4768s)|

이미 공개한 구현을 누락으로 비판하지 않아야 한다. 네 레이어 VFS, worker 실행, 등록된 import map 키만 external 허용, 실패 시 정상 화면 유지, 문서 전체 교체, Git/리뷰는 이미 설명되어 있다. ‘안전한 실행’이라는 발표 표현만으로 CSP·별도 origin·브라우저 sandbox 속성·악성 코드 탈출 방어가 모두 입증되는 것은 아니다. 반대로 해당 세부 설정이 비공개라는 이유만으로 구현되지 않았다고 단정할 수도 없다.

원자료 명령은 `poc/README.md`에 있다. 검색은 발표자 이름/글 제목/TOI와 Backend 항목으로 좁혔으며, 별도의 공개 Backend 설계 문서는 찾지 못했다. 이는 비존재 증명이 아니다.

## 2. esbuild-wasm 선택 검증과 브라우저 격리

동일 입력은 `poc/fixtures.mjs`: `/index.tsx`, `/App.tsx`, `/Table.tsx`, `/data.ts`, 100개 데이터 행. 상대 경로/확장자 탐색은 메모리 Map의 `onResolve`/`onLoad`로 처리하고 React/JSX runtime/React DOM은 import map용 external로 남긴다. 생성된 앱만 번들링하며 dependencies를 내려받는 시간은 포함하지 않는다. CSS·assets·tsconfig paths·대형 TDS·SSR·타입체킹은 범위 밖이다.

**구분:** esbuild 및 Rolldown은 이 PoC에서 import graph를 묶는 번들러다. SWC, Sucrase, Babel standalone, Oxc transform은 여기서 파일별 변환기로 실행했고 graph resolve/link/package provisioning을 수행하지 않았다. Oxc native 결과는 Node 서버 환경 참고값이며 브라우저 WASM과 동일 조건이 아니다. SWC 계열의 다른 Node 번들링 제품이 존재하더라도 이번 `@swc/wasm(-web)` transform 호출과 혼동하지 않는다. [esbuild API](https://esbuild.github.io/api/), [SWC WASM](https://swc.rs/docs/usage/wasm), [Oxc transformer](https://oxc.rs/docs/guide/usage/transformer).

아래 모든 수치는 **중앙값 [1회, 2회, 3회] ms**다. 새 Node 프로세스 또는 새 브라우저 context를 사용하나 OS 캐시/Chrome 프로세스/WASM 컴파일 캐시는 강제로 비우지 않는다. 브라우저는 localhost, no-store, CPU/network throttling 없음이다. 사용자 브라우저 WAN cold start나 p95 성능으로 일반화하지 않는다. Node esbuild의 initialize는 실제 WASM 서비스 준비 완료를 보장하는 시간 측정점으로 쓰기 어려워 빈 `export {}` transform을 probe로 실행하고 준비 비용에 포함했다. 다른 도구의 module import도 lazy JIT까지 모두 완료한다는 뜻은 아니다.

macOS 26.6.2 (build 25G83), arm64; 환경: {"date": "2026-09-11T09:53:43.052Z", "os": "25.6.0", "cpu": "Apple M4", "node": "v22.14.0"}; Chrome 153.0.8010.36.

|패키지|측정 version|npm 게시일 UTC|
|---|---|---|
|[esbuild-wasm](https://registry.npmjs.org/esbuild-wasm)|0.28.2|2026-08-08T20:02:02.456Z|
|[@rolldown/browser](https://registry.npmjs.org/@rolldown/browser)|1.2.8|2026-09-09T09:42:29.805Z|
|[@swc/wasm](https://registry.npmjs.org/@swc/wasm)|1.16.2|2026-09-04T19:50:44.763Z|
|[@swc/wasm-web](https://registry.npmjs.org/@swc/wasm-web)|1.16.2|2026-09-04T19:47:44.426Z|
|[sucrase](https://registry.npmjs.org/sucrase)|3.35.1|2025-11-19T17:10:51.830Z|
|[@babel/standalone](https://registry.npmjs.org/@babel/standalone)|8.0.5|2026-09-10T21:14:27.575Z|
|[oxc-transform](https://registry.npmjs.org/oxc-transform)|0.149.0|2026-09-07T14:54:27.349Z|

Command: `node bench-node.mjs`

### Node readiness

Command: `node bench-node.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|Node / esbuild-wasm|js_initialize_ms|16.577 [17.740, 16.577, 16.345]|
|Node / esbuild-wasm|wasm_ready_probe_ms|180.557 [181.588, 180.328, 180.557]|
|Node / esbuild-wasm|module_ready_ms|196.909 [199.336, 196.909, 196.908]|
|Node / esbuild-full|js_initialize_ms|16.901 [16.901, 16.739, 17.113]|
|Node / esbuild-full|wasm_ready_probe_ms|180.086 [189.608, 180.086, 177.568]|
|Node / esbuild-full|module_ready_ms|196.832 [206.519, 196.832, 194.688]|
|Node / swc-wasm|module_ready_ms|32.532 [36.010, 32.175, 32.532]|
|Node / sucrase|module_ready_ms|32.356 [45.365, 32.356, 32.215]|
|Node / babel|module_ready_ms|167.737 [171.812, 167.299, 167.737]|
|Node / oxc-native|module_ready_ms|4.679 [8.027, 4.539, 4.679]|
|Node / oxc-wasm|module_ready_ms|40.816 [49.658, 40.674, 40.816]|
|Node / rolldown-browser|module_ready_ms|93.768 [95.538, 93.768, 91.539]|

### Node incremental bundler (esbuild)

Command: `node bench-node.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|Node / esbuild-wasm|context_first_bundle_ms|54.821 [56.137, 53.562, 54.821]|
|Node / esbuild-wasm|incremental_rebuild_ms|11.118 [12.665, 10.206, 11.118]|

### Node full rebundle (esbuild / Rolldown)

Command: `node bench-node.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|Node / esbuild-full|first_full_bundle_ms|51.067 [50.205, 51.067, 54.862]|
|Node / esbuild-full|second_full_bundle_ms|13.991 [13.102, 13.991, 22.223]|
|Node / rolldown-browser|first_full_bundle_ms|102.555 [103.686, 100.799, 102.555]|
|Node / rolldown-browser|second_full_bundle_ms|51.186 [51.211, 50.372, 51.186]|

### Node transformers only

Command: `node bench-node.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|Node / swc-wasm|first_transform_all_ms|53.565 [54.229, 53.565, 53.536]|
|Node / swc-wasm|second_transform_all_ms|1.832 [1.853, 1.832, 1.727]|
|Node / sucrase|first_transform_all_ms|17.231 [17.500, 17.231, 17.069]|
|Node / sucrase|second_transform_all_ms|6.810 [7.127, 6.810, 6.651]|
|Node / babel|first_transform_all_ms|56.815 [55.621, 56.815, 64.674]|
|Node / babel|second_transform_all_ms|21.645 [20.760, 21.645, 24.497]|
|Node / oxc-native|first_transform_all_ms|0.479 [3.983, 0.479, 0.478]|
|Node / oxc-native|second_transform_all_ms|0.172 [0.171, 0.173, 0.172]|
|Node / oxc-wasm|first_transform_all_ms|20.688 [20.688, 20.979, 20.626]|
|Node / oxc-wasm|second_transform_all_ms|1.609 [1.764, 1.580, 1.609]|

Command: `node bench-browser.mjs`

### Browser readiness

Command: `node bench-browser.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|plain / esbuild-wasm|js_import_ms|3.500 [3.500, 3.900, 2.900]|
|plain / esbuild-wasm|wasm_ready_ms|41.200 [42.600, 41.200, 40.900]|
|plain / esbuild-wasm|module_ready_ms|45.100 [46.100, 45.100, 43.800]|
|plain / esbuild-full|js_import_ms|2.900 [2.900, 2.900, 3.100]|
|plain / esbuild-full|wasm_ready_ms|39.600 [39.600, 41.200, 38.000]|
|plain / esbuild-full|module_ready_ms|42.500 [42.500, 44.100, 41.100]|
|plain / swc-wasm|js_import_ms|1.800 [1.600, 1.800, 1.800]|
|plain / swc-wasm|wasm_ready_ms|28.600 [28.600, 31.700, 27.500]|
|plain / swc-wasm|module_ready_ms|30.200 [30.200, 33.500, 29.300]|
|plain / sucrase|module_ready_ms|13.200 [13.600, 13.000, 13.200]|
|plain / babel|module_ready_ms|124.400 [121.900, 124.400, 124.700]|
|plain / oxc-wasm|module_ready_ms|37.700 [38.600, 37.400, 37.700]|
|plain / rolldown-browser|errors|3/3: DataCloneError: Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated.|
|iso / esbuild-wasm|js_import_ms|3.065 [3.125, 3.065, 3.040]|
|iso / esbuild-wasm|wasm_ready_ms|43.845 [40.530, 43.930, 43.845]|
|iso / esbuild-wasm|module_ready_ms|46.885 [43.660, 46.995, 46.885]|
|iso / esbuild-full|js_import_ms|3.330 [3.330, 3.125, 3.540]|
|iso / esbuild-full|wasm_ready_ms|43.985 [44.985, 43.985, 43.065]|
|iso / esbuild-full|module_ready_ms|47.115 [48.320, 47.115, 46.610]|
|iso / swc-wasm|js_import_ms|1.745 [1.920, 1.550, 1.745]|
|iso / swc-wasm|wasm_ready_ms|30.470 [30.820, 27.165, 30.470]|
|iso / swc-wasm|module_ready_ms|32.220 [32.750, 28.720, 32.220]|
|iso / sucrase|module_ready_ms|13.420 [13.420, 12.905, 13.840]|
|iso / babel|module_ready_ms|123.815 [122.770, 123.815, 126.410]|
|iso / oxc-wasm|module_ready_ms|37.945 [37.515, 37.945, 38.355]|
|iso / rolldown-browser|module_ready_ms|176.910 [176.910, 181.650, 175.145]|

### Browser incremental bundler (esbuild)

Command: `node bench-browser.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|plain / esbuild-wasm|context_first_bundle_ms|177.500 [177.500, 182.000, 176.400]|
|plain / esbuild-wasm|incremental_rebuild_ms|12.500 [12.500, 14.300, 9.900]|
|iso / esbuild-wasm|context_first_bundle_ms|187.875 [175.745, 209.745, 187.875]|
|iso / esbuild-wasm|incremental_rebuild_ms|11.380 [9.595, 12.370, 11.380]|

### Browser full rebundle (esbuild / Rolldown)

Command: `node bench-browser.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|plain / esbuild-full|first_full_bundle_ms|184.100 [180.900, 184.900, 184.100]|
|plain / esbuild-full|second_full_bundle_ms|13.000 [11.500, 13.000, 17.400]|
|plain / rolldown-browser|errors|3/3: DataCloneError: Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated.|
|iso / esbuild-full|first_full_bundle_ms|176.475 [176.340, 176.475, 183.910]|
|iso / esbuild-full|second_full_bundle_ms|14.380 [14.380, 16.440, 13.295]|
|iso / rolldown-browser|first_full_bundle_ms|88.340 [89.065, 88.290, 88.340]|
|iso / rolldown-browser|second_full_bundle_ms|10.985 [11.390, 10.985, 10.260]|

### Browser transformers only

Command: `node bench-browser.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|plain / swc-wasm|first_transform_all_ms|53.600 [53.900, 53.200, 53.600]|
|plain / swc-wasm|second_transform_all_ms|1.800 [1.800, 1.800, 1.900]|
|plain / sucrase|first_transform_all_ms|11.700 [11.700, 11.400, 11.700]|
|plain / sucrase|second_transform_all_ms|3.500 [3.700, 3.300, 3.500]|
|plain / babel|first_transform_all_ms|34.900 [34.900, 34.700, 35.700]|
|plain / babel|second_transform_all_ms|10.100 [10.500, 10.000, 10.100]|
|plain / oxc-wasm|first_transform_all_ms|19.900 [20.100, 19.900, 19.900]|
|plain / oxc-wasm|second_transform_all_ms|1.600 [1.500, 1.600, 1.700]|
|iso / swc-wasm|first_transform_all_ms|53.395 [53.075, 53.395, 53.430]|
|iso / swc-wasm|second_transform_all_ms|1.775 [1.695, 1.845, 1.775]|
|iso / sucrase|first_transform_all_ms|11.715 [11.715, 11.905, 11.570]|
|iso / sucrase|second_transform_all_ms|3.445 [3.445, 3.470, 3.280]|
|iso / babel|first_transform_all_ms|35.090 [35.090, 34.535, 35.160]|
|iso / babel|second_transform_all_ms|9.925 [10.415, 9.875, 9.925]|
|iso / oxc-wasm|first_transform_all_ms|19.700 [19.700, 19.910, 19.625]|
|iso / oxc-wasm|second_transform_all_ms|1.610 [1.580, 1.610, 1.660]|



### 준비 + 첫 full bundle (UI render 제외)

명령: `node bench-node.mjs`, `node bench-browser.mjs`; 각 trial의 module_ready_ms + first_full_bundle_ms에서 계산.

|환경|도구|중앙값 [원시 3회] ms|
|---|---|---|
|Node/Node|esbuild-full|249.549 [256.725, 247.900, 249.549]|
|Node/Node|rolldown-browser|194.567 [199.224, 194.567, 194.094]|
|Browser/plain|esbuild-full|225.200 [223.400, 229.000, 225.200]|
|Browser/iso|esbuild-full|224.660 [224.660, 223.590, 230.520]|
|Browser/iso|rolldown-browser|265.975 [265.975, 269.940, 263.485]|

브라우저 격리 조건에서 Rolldown은 module 준비 후 첫 full bundle과 두 번째 full bundle이 esbuild보다 짧았다. 그러나 준비+첫 full bundle을 합친 값은 esbuild가 더 짧았고, Node에서는 이 합산 순서가 반대였다. 준비 API가 반환된 뒤에도 최초 호출 JIT/런타임 비용이 남을 수 있으므로 한 구간만 보고 엔진을 선정하지 않아야 한다. 합산값은 각 trial의 합을 구한 뒤 중앙값을 냈으며 중앙값끼리 단순히 더한 값이 아니다.

앱 번들의 **전체 재번들끼리**는 위 별도 표에서 비교할 수 있다. esbuild context의 changed-input `rebuild()`는 별도 표이며, 두 번째 fresh Rolldown build를 ‘증분’이라고 부르지 않았다. 이번 입력/환경에서의 수치만으로 모든 프로젝트의 우열을 결론내리지 않는다. 토스가 실제 context/rebuild를 사용하는지는 공개 코드의 `build()` 예시만으로 확정할 수 없다.

### Rolldown browser 엔트리와 iframe

`@rolldown/browser`의 `exports.browser` 엔트리 `dist/index.browser.mjs`를 사용했다. npm 배포물의 WASM/Worker는 그대로 두고 브라우저에서 불러올 JS 어댑터만 사전 번들했다. 일반 페이지와 `COOP: same-origin` + `COEP: require-corp` 페이지 각각 3회 실행했다. Worker 응답에도 COEP를 제공하고 `cwd:'/'`를 명시했다. 그렇지 않으면 Worker 로드 실패 또는 Node 전용 `process.cwd()` fallback 오류가 발생하므로, 헤더 문제와 통합 문제를 구분했다.

**실측:** 비격리 페이지의 Rolldown은 3/3 `DataCloneError: SharedArrayBuffer transfer requires self.crossOriginIsolated`로 실패, 격리 페이지는 3/3 성공했다. Oxc WASI의 **transformSync 경로는 비격리 페이지에서도 3/3 동작했다**. shared memory를 사용하는 배포물이라는 이유만으로 모든 호출에 COI가 필수라고 추론하면 안 된다; Oxc의 async/thread 경로는 이번 실험에서 검증하지 않았다. esbuild-wasm·SWC·Sucrase·Babel도 이번 비격리 브라우저 조건에서 동작했다. 최신 브라우저 엔트리가 있다는 사실은 COOP/COEP 불필요를 의미하지 않는다.

### Cross-origin iframe
Command: `node bench-browser.mjs`

|Parent COEP|Child case|Loaded trials|Child isolated trials|
|---|---|---|---|
|iso|plain|[False, False, False]|[None, None, None]|
|iso|CORP-only|[False, False, False]|[None, None, None]|
|iso|COEP|[False, False, False]|[None, None, None]|
|iso|credentialless-iframe|[True, True, True]|[False, False, False]|
|iso|COEP-allow|[False, False, False]|[None, None, None]|
|iso|COEP+CORP|[True, True, True]|[False, False, False]|
|iso|COEP+CORP+allow|[True, True, True]|[True, True, True]|
|credentialless|plain|[False, False, False]|[None, None, None]|
|credentialless|CORP-only|[False, False, False]|[None, None, None]|
|credentialless|COEP|[False, False, False]|[None, None, None]|
|credentialless|credentialless-iframe|[True, True, True]|[False, False, False]|
|credentialless|COEP-allow|[False, False, False]|[None, None, None]|
|credentialless|COEP+CORP|[True, True, True]|[False, False, False]|
|credentialless|COEP+CORP+allow|[True, True, True]|[True, True, True]|



다른 port를 써 origin을 구분했다(둘 다 loopback이므로 cross-site 제3자 쿠키 규칙까지 실증한 것은 아니다). `CORP-only`는 문서 COEP 동의를 대체하지 못하고, 이 Chrome에서 자식 COEP+CORP 조합은 임베드를 허용한다. 자식에서 `crossOriginIsolated`가 필요한 경우 `allow="cross-origin-isolated"` 위임도 별개로 확인했다. `iframe credentialless`는 COEP 없는 프리뷰를 격리 부모에 넣을 수 있지만 기존 인증 쿠키/스토리지 전달에 의존하는 프리뷰와는 다른 실행 조건이다. 부모 COEP를 credentialless로 설정하는 것과 iframe의 credentialless 속성은 같은 조치가 아니다. CSP frame-ancestors, X-Frame-Options, sandbox 제한은 별도로 허용되어야 한다. [HTML 표준](https://html.spec.whatwg.org/multipage/browsers.html), [iframe credentialless](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/IFrame_credentialless), [WebContainers 헤더](https://webcontainers.io/guides/configuring-headers).

## 3. 패키지별 ESM + peer external 싱글톤 실증

`node singleton.mjs`는 React, JSX runtime, React DOM, React DOM client, React Query, 위젯 A/B를 독립 빌드한다. 각 위젯은 useState와 useQuery/useQueryClient를 사용하고, 단일 root의 QueryClientProvider 아래에서 같은 query key를 구독한다. 모든 공유 peer를 한 URL에 연결하며 A 버튼 클릭으로 실제 hook state 갱신을 검증했다. React 객체 참조 동일성뿐 아니라 두 위젯의 client가 root QueryClient와 같은지, queryFn 호출 횟수가 1인지 확인했다.

CJS 패키지는 ESM named export facade와 `require(peer)`→ESM import bridge가 필요했다. esbuild의 일반 `external:['react-dom']`는 하위 `react-dom/client`까지 매칭하므로 package entry를 자기 자신에 external시키지 않도록 exact-match resolver를 썼다. 단순한 ‘각 패키지에 bundle:true’와 구분되는 실제 구현 비용이다. 실패 대조군 B-bad는 React/Query를 자기 번들 안에 포함했다.

### Singleton
Command: `node singleton.mjs`

|Case|Trial|React equality app/A/B|Shared QueryClient|Hook click|fetches|JS requests|
|---|---|---|---|---|---|---|
|good|1|{'appA': True, 'appB': True, 'AB': True}|True|True|1|7|
|good|2|{'appA': True, 'appB': True, 'AB': True}|True|True|1|7|
|good|3|{'appA': True, 'appB': True, 'AB': True}|True|True|1|7|
|bad|1|{'appA': True, 'appB': False, 'AB': False}|False|False|0|7|
|bad|2|{'appA': True, 'appB': False, 'AB': False}|False|False|0|7|
|bad|3|{'appA': True, 'appB': False, 'AB': False}|False|False|0|7|


정상 구성의 통과는 **이 호환 버전 조합에서** 개별 ESM 전략이 성립함을 보인다. ‘peerDependencies만 자동으로 external 처리하면 모든 패키지가 안전하다’는 증명은 아니다. 공유 상태를 숨겨 갖는 non-peer dependency, exports 조건, CSS side effects, 버전 충돌, import map scopes 또는 URL query 차이로 분리되는 인스턴스도 관리해야 한다. QueryClient 클래스 동일성과 QueryClient **객체** 동일성도 다르므로 root에서 객체를 생성해 Provider로 공유했다. 창/iframe을 넘어 JS 객체를 하나로 만드는 전략도 아니다.

|비교 항목|조합 단위 준비/cache|패키지별 ESM + peer external|
|---|---|---|
|cache 단위|전체 resolved graph + public entries. 동일 조합끼리 재사용.|패키지 버전+build profile+필요 시 peer resolution context. 프로젝트 사이 겹치는 패키지 재사용 증가.|
|새 조합 cold miss|새 조합 설치·빌드·검증. 공유 캐시/사전 설치로 완화 가능.|기존 패키지를 재사용하고 새 artifact만 생성 가능. 그래프 호환성 검증은 여전히 필요.|
|싱글톤|한 build graph 안에서 shared chunk/dedupe로 관리하기 편함.|단일 URL과 peer external 정책을 강제해야 함. 이번 React/Query 3회 정상 동작.|
|원자적 rollback|해시 경로의 importmap manifest를 전환. 여러 산출물 업로드 완료 후 pointer publish.|immutable artifact + versioned import map snapshot을 한 번에 전환하면 가능. 패키지별 배포라는 이유만으로 rollback이 비원자적일 필요는 없음.|
|네트워크 요청|조합 번들도 여러 entry/shared chunks로 나뉠 수 있어 **항상 1개 요청이 아니다**.|이번 정상 예시의 JS 요청 수는 위 실측 참조. 더 많은 파일/깊은 graph면 waterfall 가능; modulepreload·압축·CDN cache로 완화.|
|무효화 범위|작은 변경도 조합 키 변경. 산출물 content hash 재사용을 함께 설계할 수 있음.|변한 패키지 위주 무효화. build 조건·peer ABI 변화까지 키에 넣지 않으면 잘못 재사용.|
|운영 난이도|단일 package manager 해석 결과를 신뢰하기 쉬움. 조합 수 증가/GC 필요.|CJS/ESM, public subpath, peer/multiple versions, 요청 최적화 정책 부담. esm.sh/JSPM 같은 도구를 재료로 활용 가능.|

이 표의 cache/rollback 항목은 구조적 분석(추정)이며 S3/CDN 부하를 측정한 수치는 아니다. 토스의 실패 사례는 ‘React까지 중복 포함한 개별 번들’의 문제로 설명되며, 이번 대조군도 그 문제를 재현한다.

## 4. Yarn 선택, 설치 결정성, 해시 키

정확히 고정한 작은 세트: react 19.3.0, react-dom 19.3.0, @tanstack/react-query 5.102.8, clsx 2.1.1. 매 도구마다 새 디렉터리에서 lock을 3번 만들었다. 그 후 node_modules와 전용 cache/store를 삭제하고 frozen/immutable/ci install(cold), 다시 node_modules만 삭제하고 install(warm)했다. Yarn Berry의 글로벌 mirror도 끄고 비웠다. registry는 공개 npm이며 lifecycle scripts는 모두 껐다. 각 매니저의 기본 linker·다운로드 전략은 같지 않다. cold는 **패키지 cache가 비었다**는 뜻이며 OS/DNS/TLS/CDN 캐시를 비웠다는 뜻이 아니다.

### Installs
Command: `node bench-install.mjs`; exact per-tool argv in install-results.json.

|Manager|Cold ms median [raw]|Warm ms median [raw]|Unique generated lock hashes /3|Frozen install changed lock?|
|---|---|---|---|---|
|yarn-classic 1.22.22|1089.016 [1089.016, 1128.108, 943.615]|336.378 [318.565, 357.293, 336.378]|1|[False, False, False]|
|yarn-berry 4.18.0|1012.450 [1012.450, 1000.214, 1201.992]|419.590 [419.590, 420.818, 411.266]|1|[False, False, False]|
|pnpm 12.3.4|440.108 [440.108, 432.465, 451.632]|60.209 [60.209, 63.184, 58.595]|1|[False, False, False]|
|npm 11.4.2|911.919 [911.919, 837.063, 973.666]|386.169 [381.156, 386.169, 389.728]|1|[False, False, False]|
|bun 1.3.6|4158.416 [4158.416, 3163.001, 4185.656]|21.777 [21.962, 21.777, 20.172]|1|[False, False, False]|



명령: `node bench-install.mjs`. 원시 lock hash (3회 각각 아래 동일 값):

|도구|3회 SHA256 (동일)|
|---|---|
|yarn-classic|`ed46c033c3262424725b8310155724f8f07cff79bfb7f741d91120a8f65f6634` ×3|
|yarn-berry|`2892edd5ce8dcc1a4fd2b4996385b9caf9a2800590d827c85c00f47672e97bdf` ×3|
|pnpm|`d311933aee656b18d59e948e86cea480a8d3f71d6cec80740d2d4dd3596a477c` ×3|
|npm|`564e41293897907338048d2ed23f55aa9e36b53c5e80246bc74743d44f8dcf2e` ×3|
|bun|`9bfef1b8eadb83a06e245fb17ed4d8a525b61854e527f8e94df2de538545d40b` ×3|

명령 상세는 `poc/evidence/install-results.json`의 각 sample `cold.command`/`warm.command`, 로그는 `poc/install-bench/<manager>-<trial>/{seed,cold,warm}.log`에 보존했다. seed install의 시간은 비교표에서 제외했다. 각 frozen install의 exit code는 0이고 lock byte hash도 유지됐다. 3회 동일 lock은 이 세트/플랫폼/버전에서의 반복성 증거이지, 레지스트리 미래 변경·다른 플랫폼 optional package·peer conflict까지 결정성을 증명하지 않는다.

**해석:** 이 실험에서 Yarn이 필수이거나 최속이라는 증거는 없다. pnpm의 cache 재사용과 Bun의 warm install은 작게 나왔고, Bun cold는 더 느렸다. Bun은 이미 설치된 1.3.6, npm은 11.4.2를 측정했다(2026-09-11 registry latest와 동일하다고 주장하지 않는다). 토스의 Yarn 세대/선택 이유는 `unverifiable`; 조직의 기존 Yarn 운영 경험을 활용했을 가능성은 추정이다. 설치 속도는 패키지 조합 cache miss 경로에 속하므로 이를 preview 매번의 critical path와 혼동해서는 안 된다.

|도구|사내 scope 설정|난이도/주의점 (문서 기반 판단)|
|---|---|---|
|Yarn classic|`.npmrc`: `@corp:registry=https://registry.example/` 및 host-scoped `_authToken=${NPM_TOKEN}`|기존 npm 설정 재사용이 쉬움. `--frozen-lockfile`과 버전 고정 필요.|
|Yarn Berry|`.yarnrc.yml`: `npmScopes.corp.npmRegistryServer`, `npmAuthToken`, 필요 시 `npmAlwaysAuth`|구조화 YAML; 설정 이주 및 nodeLinker(node-modules/PnP) 선택 필요.|
|pnpm|`.npmrc` scoped registry/token|npm과 유사. peer graph 및 content-addressed store 정책을 함께 고정.|
|npm|`.npmrc` scoped registry/token|가장 익숙한 설정; CI는 `npm ci`.|
|Bun|`.npmrc` 호환 또는 bunfig.toml `install.scopes`에 registry/token|설정은 짧음. 사용할 Bun 버전의 lock·script·호환성 정책 확인.|

사내 registry 접근권한은 사용하지 않았고 위 난이도는 실제 사내 인증 실험 결과가 아니다. [npm .npmrc](https://docs.npmjs.com/files/npmrc/), [Yarn Berry 설정](https://yarnpkg.com/configuration/yarnrc/), [pnpm registry 설정](https://pnpm.netlify.app/npmrc), [Bun 설정](https://bun.sh/docs/runtime/bunfig).

`node hash-cases.mjs`는 공개된 토스식 규칙을 재현한다: `SHA256(JSON.stringify({entries: [...entries].sort(), lockfileHash: SHA256(rawLockBytes)})).slice(0,16)`. 입력은 실제 classic lockfile이다.

|변화|키|baseline 대비 변경|
|---|---|---|
|baseline|`165bdc14048005a3`|False|
|entry-order|`165bdc14048005a3`|False|
|entry-added|`7bb65f7a368089c6`|True|
|duplicate-entry|`71b4405981398656`|True|
|lock-whitespace|`e595d8a19df88518`|True|
|lock-version-string|`d905ba726991970a`|True|
|build-tool-version-only|`165bdc14048005a3`|False|
|build-config-only|`165bdc14048005a3`|False|
|NODE_ENV-only|`165bdc14048005a3`|False|
|package-json-non-entry-metadata|`165bdc14048005a3`|False|
|registry-credentials-only|`165bdc14048005a3`|False|

추가 명령: `node hash-cases.mjs`는 동일 VFS를 native esbuild로 minify=false/true 각각 실제 빌드한다. 아래는 출력 byte SHA256이며 타이밍 측정이 아니다.

|Trial|동일 packageSetHash|minify=false 산출물 SHA256|minify=true 산출물 SHA256|출력 변경|
|---|---|---|---|---|
|1|`165bdc14048005a3`|`f0feb560c830efe8d596b80c72508f1d45f2d82b57222bef64d76d593a848d1a`|`679067d23ecbc3a0cb09f920b4abda95761e3adaecfaa0a992d0122303db328f`|True|
|2|`165bdc14048005a3`|`f0feb560c830efe8d596b80c72508f1d45f2d82b57222bef64d76d593a848d1a`|`679067d23ecbc3a0cb09f920b4abda95761e3adaecfaa0a992d0122303db328f`|True|
|3|`165bdc14048005a3`|`f0feb560c830efe8d596b80c72508f1d45f2d82b57222bef64d76d593a848d1a`|`679067d23ecbc3a0cb09f920b4abda95761e3adaecfaa0a992d0122303db328f`|True|

설정/빌드 도구 버전은 이 함수의 입력이 아니므로 lock/entry가 그대로면 키도 그대로다. 이는 공개된 **함수**의 한계이며 토스가 별도의 namespace/build revision으로 보완하지 않았다는 증거는 아니다. package.json dependency spec을 바꿔도 실제 public entries와 설치 lock이 동일하다면 이 함수는 변화를 감지하지 않는다. 반대로 의미 없는 lock 공백도 캐시 miss를 만든다. raw hash를 정규화 hash로 바꾸려면 lock parser·semantic normalization 자체의 버전 관리가 필요하다.

개선안(추정): resolved dependency identity와 build artifact identity를 분리하고 후자에는 bundler/plugin/runtime template 버전, target/conditions/NODE_ENV, CSS/asset pipeline, 설정 digest, registry/patch identity를 포함한다. immutable manifest에는 전체 digest·artifact integrity와 작성 시각을 저장하고, 짧은 16 hex ID는 표시/lookup 보조로 사용한다. 여러 변경이 동시에 들어오면 revision 번호로 늦게 도착한 이전 빌드의 commit을 거부한다.

## 5. 2026-09-11 대안 재료

아래 npm 버전/게시일은 그날 registry dist-tags.latest/time을 직접 조회했다. 전체 원문 URL·조회 시각은 `poc/evidence/alternatives-versions.json`, 도구 버전은 `registry-versions.json`. SaaS는 공개 semantic version이 없으면 **문서 스냅샷 2026-09-11, 내부 버전 unverifiable**로 기록했다. 원격 서비스를 실행/과금하지 않았으므로 vendor의 startup 주장은 측정값이 아니다.

|대안 package|npm latest|게시일 UTC|
|---|---|---|
|[@codesandbox/sandpack-react](https://registry.npmjs.org/@codesandbox/sandpack-react)|2.20.0|2025-02-14T13:15:11.639Z|
|[@vercel/sandbox](https://registry.npmjs.org/@vercel/sandbox)|3.2.2|2026-09-08T12:49:05.584Z|
|[@codesandbox/nodebox](https://registry.npmjs.org/@codesandbox/nodebox)|0.1.9|2023-11-29T19:20:48.669Z|
|[@webcontainer/api](https://registry.npmjs.org/@webcontainer/api)|1.6.4|2026-04-14T11:25:38.980Z|
|[bun](https://registry.npmjs.org/bun)|1.4.2|2026-09-05T06:01:35.854Z|
|[@jspm/generator](https://registry.npmjs.org/@jspm/generator)|2.16.3|2026-06-29T05:20:03.825Z|
|[@codesandbox/sdk](https://registry.npmjs.org/@codesandbox/sdk)|2.4.2|2025-12-04T12:03:40.014Z|
|[rolldown](https://registry.npmjs.org/rolldown)|1.2.8|2026-09-09T09:47:21.057Z|
|[jspm](https://registry.npmjs.org/jspm)|4.6.1|2026-06-21T01:05:28.919Z|
|[@cloudflare/sandbox](https://registry.npmjs.org/@cloudflare/sandbox)|0.12.9|2026-08-27T07:28:15.531Z|
|[vite](https://registry.npmjs.org/vite)|8.3.0|2026-09-10T11:30:26.283Z|

|재료|확인한 아키텍처·출처|토스 요구에 대한 판단(추정)|
|---|---|---|
|WebContainers|브라우저 Node 환경, SharedArrayBuffer/cross-origin isolation 요구. [headers](https://webcontainers.io/guides/configuring-headers), [browser support](https://webcontainers.io/guides/browser-support).|Vite/Node toolchain과 package install까지 필요하면 강함. 컴파일만 필요한 TOI는 runtime·브라우저 호환·iframe 인증 부담이 추가됨. 사내 credentials는 서버 broker 경계 필요.|
|Sandpack 최신|React editor/client+브라우저 실행. 현재 private packages 문서는 Enterprise internal proxy, registry token 서버 보관, sandbox 제한 key, trusted-domain frame-ancestors를 설명. [문서](https://sandpack.codesandbox.io/docs/getting-started/private-packages).|‘사내 패키지 미지원’은 부정확. 사내망 인증·tarball URL·CORS/PNA 연결, hosting 정책, prewarm/cache를 검토해야 함. 토스 47초를 모든 최신 Sandpack의 기본 성능으로 일반화 금지.|
|Nodebox|브라우저 Node module runtime와 별도 preview iframe. [공식 repo](https://github.com/Sandpack/nodebox-runtime), [Sandpack 2 발표](https://codesandbox.io/blog/announcing-sandpack-2).|문서/예제 runtime 재료. npm latest 0.1.9 및 공개 repo 최신 commit 2023-11-29라는 관측은 현재 유지보수/현대 Node 호환성 검토를 요구하며, 폐기 선언은 아님.|
|CodeSandbox SDK|microVM 생성·snapshot/restore·clone·Dockerfile·source control. [SDK package README](https://www.npmjs.com/package/@codesandbox/sdk).|사용자별 VM으로 Next dev server 격리 문제를 해결할 수 있음. 실제 사내 registry·네트워크 및 secrets를 server 쪽에서 취급. 매 사용자 비용·네트워크·snapshot cache·idle lifecycle 관리 필요.|
|Cloudflare Sandbox|Workers API→Durable Objects/Containers→Linux 실행·파일·preview URL·outbound 처리. 문서 갱신 2026-08-13, 1.0은 preview 별도 채널. [공식](https://developers.cloudflare.com/sandbox/).|full backend/테스트가 필요할 때 후보. 사내 egress와 정책 프록시를 연결해야 하며 컨테이너가 TOI의 마스킹 정책을 자동 제공하지는 않음.|
|Vercel Sandbox|Firecracker microVM, 실제 FS/프로세스, custom images, snapshot/persistence. [공식](https://vercel.com/docs/sandbox), [2026-06-29 persistence 설명](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence).|Next/SSR/native dependency가 필요한 프리뷰에 적합. dependency가 깔린 snapshot을 재사용. 금융 데이터 egress·auth·region·비용은 별도 설계 대상.|
|esm.sh self-host|Go 서버로 npm→ESM, private registry/token·S3 storage 설정. `?external`/`*`로 import map에 peer 해석 위임. [repo](https://github.com/esm-dev/esm.sh), [hosting](https://github.com/esm-dev/esm.sh/blob/main/HOSTING.md). 2026-09-10 commit `67fbd653ee2a5a435606c840e4714b5573f49638`.|패키지별 ESM 공급 계층 후보. 공개 CDN에 private credentials/소스를 보내는 구조 대신 사내 구축. cold build·URL 조건·peer 호환성을 own manifest와 함께 통제.|
|JSPM|import map 생성·resolution locking·integrity·preload·다운로드/local node_modules provider. [CLI](https://jspm.org/docs/cli/).|map resolver/자산 공급 재료. local provider는 ESM dependency만 브라우저에서 바로 가능. ‘JSPM CDN 전체 private self-host 제공’을 확인한 것은 아님; generator+download/self-host artifact와 구분.|
|Vite 8/Rolldown|2026-03-12 Vite 8 stable 발표: Rolldown으로 기존 esbuild/Rollup 경로 통합. [발표](https://vite.dev/blog/announcing-vite8). 브라우저용 Rolldown은 별도 npm package.|서버의 패키지 사전 build를 현대화할 후보. Vite 8 도입이 Vite dev server 전체의 브라우저 실행을 의미하지 않음. browser 번들러는 §2 격리 실측을 함께 판단.|

|AI 앱/어드민 빌더|2026-09-11 확인 범위·버전|아키텍처·TOI 적합도 (해석은 추정)|
|---|---|---|
|v0|SaaS 내부 version `unverifiable`; 현재 [Sandbox](https://v0.app/docs/sandbox), [Git import](https://v0.app/docs/git-import) 문서.|채팅별 Vercel Sandbox VM, 실제 dev server/filesystem, Git branch/PR 흐름. full-stack 범용 생성에 유리; TOI 정책 프록시/TDS·사내망 통합은 추가 필요.|
|Bolt|SaaS 내부 version `unverifiable`; [현재 문제해결 문서](https://support.bolt.new/troubleshooting/issues), [공개 repo](https://github.com/stackblitz/bolt.new).|WebContainers 기반 브라우저 개발 환경과 AI의 FS/terminal/package manager 조작. 공개 repo snapshot은 2024-12-17이라 현 상용 backend 전모와 동일하다고 볼 수 없음. 사내 패키지 credential broker/COI 검토 필요.|
|Lovable|SaaS 내부 version `unverifiable`; [hosting/ownership](https://docs.lovable.dev/tips-tricks/deployment-hosting-ownership) 문서 스냅샷.|Vite+React 앱, managed preview/cloud, GitHub sync·앱 export/self-host 가능. editor/AI 플랫폼 자체는 customer VPC self-host 불가라고 명시. 정확한 preview sandbox engine은 `unverifiable`.|
|Retool|[공식 문서](https://docs.retool.com/) self-host stable 4.34.2/4.0.15, 2026-09-09 release. SaaS new app 내부 version `unverifiable`.|현재 AI React app 생성·resource 연결·권한/감사·승인 및 branch publish. [공식 가이드](https://retool.com/resources/how-to-build-an-app-in-retool)는 **new apps의 private npm 미지원**도 명시. TOI와 정책 통합 지향은 가깝지만 TDS private package 조건이 핵심 장애일 수 있음; classic custom components와 새 builder의 지원 범위를 섞지 말 것.|

‘빠른 브라우저 UI 프리뷰’와 ‘임의 full-stack 코드를 실행하는 개발 VM’은 서로 다른 제품 경계다. 전자라면 TOI 방식에 package 공급/manifest 도구를 보완하는 선택이 가볍고, 후자가 필요할 때만 VM/snapshot runtime으로 확장하는 것이 자연스럽다. SaaS 인증/감사가 존재한다는 사실만으로 토스의 데이터 정책과 동일한 컴플라이언스를 충족한다고 판정하지 않았다.

## 6. Astra 의견 — 개선 우선순위

1. **우선 유지할 것:** 정책 집행을 생성 UI에서 분리하고, dependency 준비를 edit/preview hot path에서 제외하며, 성공한 revision만 표시하는 경계. 47→1.3초는 이 아키텍처 전체의 발표 수치이며 esbuild 하나의 속도 차이로 설명하면 안 된다.
2. **측정/관측부터 보강:** browser WASM 준비, dependency manifest hit/miss, 새 package-set build, app bundle, iframe boot/paint, API fetch, LLM generation을 분리해 p50/p95와 cold/warm 분포로 측정. 이번 3회 microbench로 1.3초나 실제 사용자 p95는 검증되지 않는다.
3. **artifact key를 완전하게:** §4에서 build 설정/도구 변경이 공개 hash 함수의 키를 바꾸지 않는 것을 확인했다. 별도 build namespace가 없다면 stale artifact 위험이 있으므로 revisioned build profile, immutable manifest, 업로드 완료 후 pointer publish, integrity 검증을 우선 고려한다. 이미 토스에 없는 기능이라고 단정하지 않는다.
4. **패키지 단위 ESM은 제한된 승인 catalog로 실험:** §3은 대안 가능성을 증명하지만 CJS facade/require bridge, exact entry external 규칙 등 추가 비용도 드러냈다. React/Query/TDS 등 singleton contract가 명확한 catalog에서 hybrid cache를 시험하고, 복잡한 조합은 기존 set cache 유지. 요청 수·cache hit·새 조합 준비 시간을 실제로 비교한 뒤 확대한다.
5. **Rolldown 교체는 header/iframe 인증 비용까지 계산:** 최신 package에서 비격리 실패가 재현됐다. 작은 TSX graph에서 esbuild-wasm을 즉시 대체해야 할 실측 근거는 부족하다. 서버의 Vite 8 사전 번들과 browser Rolldown 교체는 별도 결정으로 진행한다.
6. **Yarn 교체는 낮은 우선순위:** 같은 작은 graph에서는 다섯 도구 모두 반복 lock이 같았다. pnpm/Bun warm 성능 이점은 cache miss build worker 효율에 관한 것이지 모든 preview latency 절감이 아니다. 사내 peer/patch/workspace/native dependency 호환성이 검증되지 않았다.
7. **안전성은 추가 확인할 계약:** iframe origin/sandbox/CSP, API별 사용자 권한·조회/변경 capability, agent tool 권한, stale revision 취소, preview에서 실제 데이터 변경 허용 범위를 문서화·검증한다. 프로세스/브라우저 간 오류 격리와 악성 코드/데이터 권한 격리는 서로 다른 검증이다. 이는 공개 정보의 공백을 메우자는 제안이며 토스가 보안·Git 리뷰를 누락했다는 비판이 아니다.

남은 `unverifiable`: 내부 agent 모델/stream protocol, API 등록 payload·OpenAPI 버전, SSO/token/RBAC 구현, 원본 코드 version/동시편집 정책, 실서비스 배포 topology·승인 강제 여부, 실제 47s/1.3s 측정 하드웨어/네트워크/표본수/분포, 대형 사내 package graph에서의 대안 성능. 원격 runtime·상용 builder의 사내망 연결과 비용은 이번 범위에서 실증하지 않았다.
