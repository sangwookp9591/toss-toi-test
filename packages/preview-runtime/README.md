# Browser preview runtime

`contracts/src/runtime.ts`의 `PreviewRuntime` 구현입니다. user → project → template → runtime 순으로 소스를 선택하고, 브라우저 Worker의 esbuild-wasm으로 앱 코드만 번들합니다. 새 iframe에서 실행이 성공하고 현재 desired 토큰의 **모든 필드**가 일치해야 화면을 교체합니다. 빌드 오류·초기 실행 오류·취소·오래된 결과는 마지막 정상 iframe을 유지합니다.

## 실행

Node 22와 시스템 Google Chrome이 필요합니다. 전역 설치는 하지 않습니다.

```sh
cd packages/preview-runtime
npm ci
npm run dev
# studio: http://localhost:5273
# preview document: http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5274/frame.html
```

`npm test`와 `npm run bench`는 패키지 전용 **5273·5274** 서버를 사용하며 통합 서비스 포트를 점유하지 않습니다. `STUDIO_PORT=5273 PREVIEW_PORT=5274 npm run dev`로 직접 실행할 수도 있습니다.

`dev`는 두 서버를 함께 시작하고 라이브러리 소스 변경을 watch합니다. 소스를 바꾼 뒤 브라우저를 새로고침합니다. 두 포트가 비어 있어야 합니다. 서버는 COOP/COEP를 설정하지 않습니다.

기본 데모는 실제 공개 esm.sh URL의 React **19.3.0**, `react-dom/client`, `react/jsx-runtime`을 사용합니다. React를 peer external로 통일합니다. `demo/fixture.ts`의 해시·buildProfile은 **가짜 manifest fixture 표시용 값**이며 deps-builder 산출물이나 파일 무결성 보장을 뜻하지 않습니다. 데모/브라우저 테스트/기록된 벤치는 실제 CDN 요청을 사용하므로 인터넷 연결이 필요합니다.

실제 deps-builder가 만든 manifest로 연결할 때:

```text
http://localhost:5273/?manifestUrl=http%3A%2F%2Flocalhost%3A7100%2Fassets%2FARTIFACT_KEY%2Fmanifest.json
```

`manifestUrl`은 manifest 본문 또는 `{status:"ready", manifest: ...}` 응답을 지원합니다. 해당 서버는 5273의 manifest fetch와 5274의 ESM import에 CORS를 허용해야 합니다. `?manual`은 자동 첫 빌드를 끕니다. 개발 origin이 바뀌면 `STUDIO_ORIGIN=https://studio.example npm run dev`처럼 iframe 문서의 허용 부모 origin을 **서버에서** 지정하고 런타임 옵션도 함께 바꿉니다.

실행 화면: [`bench/demo.png`](bench/demo.png).

## 라이브러리 사용

```sh
npm run build
```

패키지 export는 `dist/runtime.js`, 타입은 `src/index.ts`입니다. 소비 앱이 번들링할 때 `dist/worker.js`도 Worker 자산으로 처리해야 합니다. 정적 배포라면 `dist/runtime.js`, `dist/worker.js`를 나란히 두고 WASM을 제공하면 됩니다. preview origin에는 `public/frame.html`과 `dist/frame.js`를 배치합니다. 이 패키지의 dev 서버는 같은 배치를 직접 제공합니다.

```ts
import { createPreviewRuntime, digestJson, mergeVfs, sourceDigest } from '@toi/preview-runtime';
import type { BuildInput } from '@toi/preview-runtime';

const runtime = createPreviewRuntime({
  container: document.querySelector<HTMLElement>('#preview')!,
  previewOrigin: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5274',
  frameUrl: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5274/frame.html',
  esbuildWasmUrl: 'http://localhost:5273/esbuild.wasm',
  entry: '/src/main.tsx',
  bootTimeoutMs: 5000,
});
const layers = { user: { '/src/main.tsx': "document.getElementById('root')!.textContent = 'Hello';" } };
const input: BuildInput = {
  layers, manifest,
  token: {
    projectId: 'my-project', revision: 10, attemptId: crypto.randomUUID(),
    sourceDigest: await sourceDigest(mergeVfs(layers)),
    manifestDigest: await digestJson(manifest),
  },
};
runtime.on(event => console.log(event));
runtime.setDesiredRevision(input.token);
await runtime.build(input);
// runtime.cancel(input.token); // 취소는 해당 전체 토큰에 대해 유지됩니다.
// runtime.dispose();          // iframe, Worker, 대기 Promise, 이벤트 리스너 해제
```

`manifest`는 fetch한 `PackageSetManifest`입니다. 프리뷰 컨테이너에는 `position: relative`와 원하는 높이를 지정합니다. caller가 최신 의도를 `setDesiredRevision()`으로 먼저 설정해야 하며, 실패한 최신 의도를 과거 성공 결과로 자동 되돌리지 않습니다. 재시도는 새 `attemptId`를 사용합니다. `hostConfig`만 교체하는 빌드는 같은 revision 토큰으로도 커밋할 수 있습니다. hostConfig는 sourceDigest와 revision guard 입력에 포함하지 않습니다. `sourceDigest()` 인자는 **병합된 VFS**입니다. 경로는 POSIX 절대 경로로 정규화하고 JSON object key를 재귀 정렬해 SHA-256을 계산합니다. 배열 순서는 보존합니다. 런타임이 실제 소스·manifest digest를 재검증하고 입력/토큰을 복제하므로 caller의 사후 mutation이 진행 중 작업을 바꾸지 않습니다.

## 구조와 실행 경계

| 파일 | 역할 |
| --- | --- |
| `src/vfs.ts` | 4계층 병합, 경로·확장자·index 탐색, 정규화 JSON/SHA-256, exact external 판정 |
| `src/worker.ts` | Worker 내부 initialize → context 1개 유지 → 직렬 rebuild |
| `src/index.ts` | 계약 구현, Worker 요청 매핑, 독립 후보 iframe, 트랜잭션 커밋·취소·dispose |
| `src/guard.ts` | projectId/revision/attemptId/sourceDigest/manifestDigest 전체 비교 |
| `src/frame.ts` | 부모 메시지 검증, 새 문서와 import map 구성, 실행 오류·stack 전달, 2 rAF 보고 |
| `src/runtime-diagnostic.ts` | 후보별 sourceURL·source map으로 가장 가까운 사용자 VFS 위치 복원 |
| `demo/` | textarea studio, esm.sh fixture, 실제 manifest 연결 |
| `scripts/bench.mjs` | 실제 Chrome 3회 실행 및 원시값·중앙값 저장 |

esbuild-wasm은 npm registry의 최신 안정 버전을 확인한 **0.28.2**로 lockfile까지 고정했습니다(2026-09-13). 전용 Worker 안에서 `initialize({worker:false})`를 호출하므로 중첩 Worker를 만들지 않으며 메인 스레드에서 WASM을 실행하지 않습니다. Worker JS/WASM 로드는 첫 build 시점까지 미룹니다. 같은 런타임의 번들 요청만 직렬화하여 플러그인의 현재 VFS가 다른 요청과 섞이지 않게 하고, iframe 실행은 서로 독립적이므로 r11 실행이 r10보다 먼저 끝날 수 있습니다. context는 실패 뒤에도 재사용하며 manifest allowlist 변경은 다음 rebuild의 플러그인에서 읽습니다.

VFS의 상대 경로와 `.tsx .ts .jsx .js`, `index.*`를 순서대로 찾습니다. 명시적 `.json`도 지원합니다. `jsx:automatic`, `format:esm`, `sourcemap:external`, `sourcesContent:false`, `target:es2022`로 번들합니다. `onResolve`에서 import-map own key와 **정확히** 일치할 때만 external로 보냅니다. 그 밖의 bare import와 직접 URL import는 `package not in package set: <specifier>` Diagnostic으로 실패합니다. esbuild의 하위 경로까지 확장되는 `external` 배열은 사용하지 않습니다. [esbuild browser API](https://esbuild.github.io/api/#browser), [plugin resolution API](https://esbuild.github.io/plugins/#on-resolve).

## frame 문서 구성 방식과 근거

iframe은 항상 preview origin의 실제 HTTP `frame.html`로 탐색합니다. 최초 loader가 `frame_ready`를 보내고 부모가 `load`를 보냅니다. 부모는 **event.origin + 후보 iframe.contentWindow**, frame은 **서버 설정의 부모 origin + event.source === parent**를 확인합니다. 토큰이 다른 응답도 무시합니다. `postMessage`의 targetOrigin은 양방향 모두 명시하며 `*`를 쓰지 않습니다. iframe은 `sandbox="allow-scripts allow-same-origin"`이고 studio와 다른 origin을 강제합니다.

`load`를 받으면 `document.open/write/close`로 새 HTML 문서를 구성합니다. `BuildInput.hostConfig`는 입력 스냅샷에서 그대로 `ParentToFrame.load.hostConfig`로 전달합니다. `hostConfig.toiFetch`가 있으면 문서의 첫 스크립트에서 `globalThis.__TOI_FETCH_CONFIG__ = Object.freeze({ ...hostConfig.toiFetch })`를 설정하고, 그 뒤에 `<script type="importmap">`, 실행 bootstrap, 앱 모듈 순서로 진행합니다. hostConfig 또는 toiFetch 설정이 없으면 전역을 만들지 않습니다. 따라서 앱의 최초 모듈 평가 시점부터 설정을 읽을 수 있고, bare import가 해석되기 전에 import map도 파싱됩니다. iframe 문서에 blob URL이나 srcdoc을 사용하지 않으므로 실제 preview origin이 유지되어 양방향 origin 검증이 가능합니다.

설정 전역은 `{ projectId, env, transport: "broker" }`만 포함합니다. 프리뷰 세션·capability는 스튜디오 메모리에만 두며 frame은 토큰 필드가 포함된 부팅 설정을 거부합니다. 별도 동결된 브로커 채널에는 부팅 시 검증한 부모 origin과 revision·attemptId만 있습니다. `createPreviewRuntime(options, broker)`의 콜백은 스튜디오가 제공하며 런타임은 frame별 source·origin·token, 동시 8건·초당 50건을 검사합니다. 교체·취소·내비게이션·dispose 시 진행 중 브로커 작업을 abort하고 늦은 응답을 버립니다.

앱 번들은 nonce가 붙은 인라인 module의 `textContent`로 실행합니다. HTML 파서를 거치지 않아 `</script>`·Unicode가 안전하고, 부트 인자·import map은 기존 JSON escape를 유지합니다. 완료 콜백과 2 rAF 뒤 오류가 없을 때만 커밋합니다. CSP는 `connect-src 'none'`이며 `script-src`는 data:·blob:·unsafe-eval을 허용하지 않습니다.

커밋 뒤 추가 load는 내비게이션으로 처리해 frame을 제거하고 `runtime_failed("preview navigated away")`를 냅니다. 이전 정상 payload를 새 frame으로 복구하며 1분 내 3회 이동이면 복구를 중단합니다. 화면에 렌더링된 마스킹 데이터의 내비게이션 쿼리 유출은 남지만 토큰은 frame에 존재하지 않습니다.

## 런타임 오류 위치 (QA-04)

Worker는 코드와 external source map을 별도 응답으로 반환합니다. map은 `sourcesContent:false`로 VFS 원문을 담지 않으며 코드에도 `sourceMappingURL`을 넣지 않습니다. 부모는 각 build 호출의 독립 후보 closure에 해당 revision 전체 토큰, map, VFS 파일 목록을 보관합니다. 매번 무작위 studio-origin `sourceURL`을 코드 끝에 붙여 data URL의 긴 코드 대신 식별자만 stack에 남깁니다. 이 URL은 실행 위치 이름이고 네트워크로 요청하지 않습니다. 후보가 성공·실패·취소·dispose로 종료되면 listener와 보관 참조도 해제됩니다.

frame의 동기 throw/import 실패, React 초기 render 오류, `unhandledrejection`은 메시지와 stack을 studio 부모로 보냅니다. 패키지 내부 메시지에만 선택적 `stack` 필드를 사용하고 공개 `FrameToParent.error: Diagnostic`과 `runtime_failed.error: Diagnostic` 계약 파일은 변경하지 않습니다. 부모는 기존 origin·contentWindow·전체 revision 토큰 검증 후 해당 후보 map으로 stack을 순서대로 읽습니다. 정확한 sourceURL에서 `vfs:/` 소스로 매핑되고 해당 빌드의 VFS에 실제 존재하는 첫 프레임만 선택합니다. React/외부 모듈·다른 후보 URL·생성 전용 위치는 건너뛰고 사용자 프레임, stack 또는 유효한 map이 없으면 `message`만 반환합니다. build 오류도 `vfs:` 접두사를 제거하여 둘 다 `/src/App.tsx` 형태로 표시합니다. 행은 1부터, 열은 기존 esbuild build 진단과 같이 0부터입니다.

매핑 라이브러리는 **`@jridgewell/trace-mapping` 0.3.31**을 package.json과 lockfile에 고정했습니다. map 생성은 기존 inline 방식과 같이 rebuild 시 수행하지만 JSON/VLQ 해석은 오류가 발생할 때만 합니다. 라이브러리는 부모 runtime에만 포함되어 추가 네트워크/WASM 요청이 없습니다. 동일 비압축 ESM 빌드의 `dist/runtime.js`는 **9,146 → 26,299 bytes (+17,153 bytes)**, frame은 **2,247 → 2,339 bytes**, Worker는 **153,142 → 153,311 bytes**입니다. runtime 증가에는 mapper와 후보 연결 코드가 포함되며, 소비 앱에서 데모를 사용하지 않으면 `dist/demo.js`는 배포 대상이 아닙니다.

소스맵과 VFS 원문은 studio-origin Worker/부모 메모리 안에만 남고 preview iframe에는 실행 번들만 전달합니다. 양방향 `postMessage`의 고정 `targetOrigin`, origin/source/token 검증을 유지합니다. 브라우저 검증은 원문 주석 sentinel이 frame load payload와 네트워크에 없고, load에 map이나 sourceMappingURL이 없으며, 오류 stack에는 data URL 대신 studio 식별자만 있는지 확인합니다. 오류 fixture의 모든 실제 HTTP 요청은 5273·5274였으며 map 또는 가상 sourceURL 요청은 없었습니다. 이는 런타임의 매핑 경로 검증이며 사용자 앱이 임의로 수행하는 네트워크 요청을 차단한다는 뜻은 아닙니다.

후보는 컨테이너 안에서 `opacity:0; pointer-events:none`으로 숨기고 `aria-hidden`과 `inert`를 붙여 키보드 포커스도 차단합니다. 화면 밖 배치 또는 `visibility:hidden`은 Chrome이 cross-origin iframe의 rAF를 억제해 timeout을 유발하는 것을 실제 테스트에서 확인했습니다. 후보의 layout과 rAF는 살아 있어야 합니다. 성공한 후보만 표시하고 기존 iframe을 제거합니다. `rendered`가 와도 취소 또는 desired 전체 토큰 불일치면 후보를 버립니다.

## 검증

```sh
npm run typecheck
npm test
npm run bench
```

2026-09-13, Node 22.14.0 / 시스템 Chrome 153.0.8010.36 / Apple M4에서 실행한 요약:

```text
npm run typecheck: tsc --noEmit — exit 0
vitest: Test Files 4 passed (4), Tests 40 passed (40)
Playwright: 26 passed (32.0s), system channel: chrome
```

hostConfig 검증 시 기존 단위 22개·브라우저 12개를 유지했고, hostConfig load 메시지 전달/입력 스냅샷 단위 테스트 1개와 브라우저 테스트 3개를 추가했습니다. 추가 브라우저 검증은 초기 실행 전 projectId 렌더, frozen 객체 변경 차단, 번들의 closing-script/Unicode 보존과 토큰 필드 부팅 거부, 설정 미제공 시 전역 부재, 동일 revision 토큰의 설정만 교체한 재커밋을 확인합니다.

QA-04는 기존 단위 23개·브라우저 15개를 모두 유지하고 단위 12개·브라우저 9개를 추가했습니다. App 동기 throw, React App/Table render, await 뒤 미처리 rejection, 외부 모듈만 있는 stack, 원시값 rejection, LF/CRLF·앞쪽 공백과 주석, 연속 revision의 서로 다른 오류 행, build 경로 정규화 및 원문/map 전송 부재를 확인합니다. 단위 검증은 외부·생성 전용 프레임 건너뛰기, 다른 후보 URL, 잘못된 위치·map과 실제 esbuild map의 행/열도 확인합니다.

브라우저 검증은 첫 React 커밋/수정, 문법·모듈 throw·React render throw 시 동일 정상 화면 유지, r10→r11→r11 성공→r10 성공 경합, 최신 실패 뒤 과거 성공 폐기, 취소 뒤 늦은 성공, exact import 거부, digest 불일치, 상대/index 경로 및 계층 병합, allowlist 변경 뒤 context 재사용, closing-script/Unicode 보존, timeout/dispose, 잘못된 origin/source 메시지 무시를 포함합니다. COOP/COEP 헤더 부재와 `crossOriginIsolated=false`에서도 첫 커밋이 성공함을 확인합니다. 경합 테스트는 실제 번들 내부 top-level await로 이전 후보의 **실행 완료**를 지연시킵니다. 런타임의 성공 결과를 모킹하지 않습니다.

## 3회 측정

변경 후 원시값과 환경·측정 경계, 변경 전 전체 샘플과 증감률은 [`bench/results.json`](bench/results.json)에 있습니다. 변경 전 별도 기록은 [`bench/before-source-mapping.json`](bench/before-source-mapping.json)에 보존하며 이후 벤치는 그 기준과 비교해 results.json을 갱신합니다. 실제 deps-builder manifest로 측정하려면 `MANIFEST_URL=http://localhost:7100/.../manifest.json npm run bench`를 사용합니다.

| ms | 1회 | 2회 | 3회 | 중앙값 |
| --- | ---: | ---: | ---: | ---: |
| 준비 포함 첫 커밋 | 1038.0 | 1121.1 | 1220.1 | **1121.1** |
| 수정 → 커밋 | 48.8 | 49.4 | 48.6 | **48.8** |

| 중앙값 ms | 변경 전 동일 세션 | 변경 후 | 증감 | 이전 README 기록 대비 |
| --- | ---: | ---: | ---: | ---: |
| 준비 포함 첫 커밋 | 1092.0 | 1121.1 | **+2.7%** | 1030.8 → 1121.1, **+8.8%** |
| 수정 → 커밋 | 49.3 | 48.8 | **−1.0%** | 49.8 → 48.8, **−2.0%** |

2026-09-13 동일 환경·5273/5274·실제 CDN fixture로 변경 전후 각 3회 측정했습니다. 두 기준 모두 중앙값 회귀가 20% 이내여서 별도 오류 시 재빌드 방식은 필요하지 않았습니다. CDN 변동이 포함된 소규모 측정이며 성능 개선의 통계적 증거는 아닙니다.

시작은 `demo.run()` 호출 직전입니다. 토큰/source/manifest digest 준비, Worker 생성과 엔진 JS, WASM fetch/initialize, context 생성, 첫 rebuild, frame 문서 탐색·import map 구성, CDN 모듈 다운로드/평가, 2 rAF와 부모의 guard/iframe 교체를 포함합니다. 종점은 부모에서 commit 후 build Promise가 해결된 시점입니다. 이벤트의 `bundleMs`는 Worker 내부 작업 시작~결과까지, `bootMs`는 새 frame bootstrap 시작~2 rAF까지, `totalMs`는 `runtime.build()` 진입~교체까지이며 벤치의 바깥쪽 시간은 caller의 토큰 준비도 포함합니다.

엔진 예열 transform이나 빈 probe build는 없습니다. 3회 각각 새 browser context·Worker를 쓰되 하나의 Chrome process를 사용합니다. 수정은 같은 esbuild context와 HTTP cache를 유지합니다. 로컬 자산은 no-store이며 esm.sh HTTP cache·OS/DNS/TLS/CDN/WASM compile cache를 강제로 비우지 않았습니다. 초기 npm 설치, 서버 시작, 도구 소스의 사전 호스트 빌드, HTML navigation, 데모 helper JS 및 `demo.ready`까지의 manifest fetch는 제외합니다. 따라서 완전한 cold navigation 숫자는 아닙니다. 첫 커밋은 실제 CDN 의존성 요청을 포함하므로 로컬 준비 ESM을 쓴 기존 PoC와 직접 비교할 수 없습니다.

## 알려진 한계

- 2 rAF는 화면 반영의 대리 지표이며 실제 compositor paint 완료 증명이 아닙니다. 작은 TSX 1파일 fixture의 3회 중앙값이고 p95, 대형 graph, 사내 registry, TOI 1.3초의 재현을 뜻하지 않습니다.
- 프리뷰는 매번 새 realm으로 실행하므로 React 상태/Fast Refresh/HMR를 보존하지 않습니다. CSS/assets, Node builtin, CJS `require` 호환 레이어, tsconfig alias는 제공하지 않습니다. 계산식 dynamic import는 esbuild가 정적으로 해석할 수 없어 allowlist가 네트워크 접근 보안 경계가 되지 않습니다.
- 초기 실행 검증 이후 발생한 지연 오류를 자동 롤백하지 않습니다. 실행 완료된 API 쓰기도 롤백하지 않습니다. 정책 프록시의 권한·capability 검증은 별도 시스템이 담당합니다. iframe은 악성 코드의 CPU 무한 루프나 모든 데이터 유출을 막는 하드 샌드박스가 아닙니다.
- import map의 manifest digest는 확인하지만 각 외부 모듈의 sha256을 브라우저에서 별도로 검사하지 않습니다. 실제 산출물의 immutable URL/무결성/peer singleton은 deps-builder의 책임입니다. 공개 fixture의 `files:[]`는 이 검증을 대신하지 않습니다.
- frame과 데모 서버는 nonce CSP를 사용하고 번들은 인라인 module로 실행합니다. data:·blob: 스크립트와 직접 네트워크 연결은 거부합니다. HTTPS 배포에서는 studio, preview, WASM 및 의존성 URL을 모두 적절히 HTTPS로 바꿉니다.
- 취소된 토큰은 해당 런타임의 수명 동안 기억합니다. 프로젝트를 닫을 때 `dispose()`해야 합니다. 백그라운드 탭/숨겨진 상위 컨테이너의 rAF 억제로 boot timeout이 발생할 수 있습니다. 무제한 동시 후보 수를 제어하는 UI admission 정책은 소비 앱에서 추가해야 합니다.


P0-2: runtime accepts only `previewOriginForProject(projectId)` and rejects build
or host-config project mismatches. The trusted parent is localhost:5273. Frame
responses carry nonce CSP through document replacement; CSP violations use the
existing runtime_failed diagnostic with a CSP_BLOCKED prefix, including after commit.
The AST source policy is defense in depth; CSP enforces the browser network boundary.
Browser tests keep contract origins while forwarding HTTP to isolated fixture ports
5273/5274, preserving real response CSP. Their React fixture is bundled from the
pinned local studio packages; it does not use a public CDN. End-to-end isolation
coverage against the actual running servers is in e2e/tests/isolation.spec.ts.
