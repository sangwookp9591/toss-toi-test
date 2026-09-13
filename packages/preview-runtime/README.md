# Browser preview runtime

`contracts/src/runtime.ts`의 `PreviewRuntime` 구현입니다. user → project → template → runtime 순으로 소스를 선택하고, 브라우저 Worker의 esbuild-wasm으로 앱 코드만 번들합니다. 새 iframe에서 실행이 성공하고 현재 desired 토큰의 **모든 필드**가 일치해야 화면을 교체합니다. 빌드 오류·초기 실행 오류·취소·오래된 결과는 마지막 정상 iframe을 유지합니다.

## 실행

Node 22와 시스템 Google Chrome이 필요합니다. 전역 설치는 하지 않습니다.

```sh
cd packages/preview-runtime
npm ci
npm run dev
# studio: http://localhost:5173
# preview document: http://localhost:5174/frame.html
```

`dev`는 두 서버를 함께 시작하고 라이브러리 소스 변경을 watch합니다. 소스를 바꾼 뒤 브라우저를 새로고침합니다. 두 포트가 비어 있어야 합니다. 서버는 COOP/COEP를 설정하지 않습니다.

기본 데모는 실제 공개 esm.sh URL의 React **19.3.0**, `react-dom/client`, `react/jsx-runtime`을 사용합니다. React를 peer external로 통일합니다. `demo/fixture.ts`의 해시·buildProfile은 **가짜 manifest fixture 표시용 값**이며 deps-builder 산출물이나 파일 무결성 보장을 뜻하지 않습니다. 데모/브라우저 테스트/기록된 벤치는 실제 CDN 요청을 사용하므로 인터넷 연결이 필요합니다.

실제 deps-builder가 만든 manifest로 연결할 때:

```text
http://localhost:5173/?manifestUrl=http%3A%2F%2Flocalhost%3A7100%2Fassets%2FARTIFACT_KEY%2Fmanifest.json
```

`manifestUrl`은 manifest 본문 또는 `{status:"ready", manifest: ...}` 응답을 지원합니다. 해당 서버는 5173의 manifest fetch와 5174의 ESM import에 CORS를 허용해야 합니다. `?manual`은 자동 첫 빌드를 끕니다. 개발 origin이 바뀌면 `STUDIO_ORIGIN=https://studio.example npm run dev`처럼 iframe 문서의 허용 부모 origin을 **서버에서** 지정하고 런타임 옵션도 함께 바꿉니다.

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
  previewOrigin: 'http://localhost:5174',
  frameUrl: 'http://localhost:5174/frame.html',
  esbuildWasmUrl: 'http://localhost:5173/esbuild.wasm',
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
| `src/frame.ts` | 부모 메시지 검증, 새 문서와 import map 구성, 실행 오류 감지, 2 rAF 보고 |
| `demo/` | textarea studio, esm.sh fixture, 실제 manifest 연결 |
| `scripts/bench.mjs` | 실제 Chrome 3회 실행 및 원시값·중앙값 저장 |

esbuild-wasm은 npm registry의 최신 안정 버전을 확인한 **0.28.2**로 lockfile까지 고정했습니다(2026-09-13). 전용 Worker 안에서 `initialize({worker:false})`를 호출하므로 중첩 Worker를 만들지 않으며 메인 스레드에서 WASM을 실행하지 않습니다. Worker JS/WASM 로드는 첫 build 시점까지 미룹니다. 같은 런타임의 번들 요청만 직렬화하여 플러그인의 현재 VFS가 다른 요청과 섞이지 않게 하고, iframe 실행은 서로 독립적이므로 r11 실행이 r10보다 먼저 끝날 수 있습니다. context는 실패 뒤에도 재사용하며 manifest allowlist 변경은 다음 rebuild의 플러그인에서 읽습니다.

VFS의 상대 경로와 `.tsx .ts .jsx .js`, `index.*`를 순서대로 찾습니다. 명시적 `.json`도 지원합니다. `jsx:automatic`, `format:esm`, `sourcemap:inline`, `target:es2022`로 번들합니다. `onResolve`에서 import-map own key와 **정확히** 일치할 때만 external로 보냅니다. 그 밖의 bare import와 직접 URL import는 `package not in package set: <specifier>` Diagnostic으로 실패합니다. esbuild의 하위 경로까지 확장되는 `external` 배열은 사용하지 않습니다. [esbuild browser API](https://esbuild.github.io/api/#browser), [plugin resolution API](https://esbuild.github.io/plugins/#on-resolve).

## frame 문서 구성 방식과 근거

iframe은 항상 preview origin의 실제 HTTP `frame.html`로 탐색합니다. 최초 loader가 `frame_ready`를 보내고 부모가 `load`를 보냅니다. 부모는 **event.origin + 후보 iframe.contentWindow**, frame은 **서버 설정의 부모 origin + event.source === parent**를 확인합니다. 토큰이 다른 응답도 무시합니다. `postMessage`의 targetOrigin은 양방향 모두 명시하며 `*`를 쓰지 않습니다. iframe은 `sandbox="allow-scripts allow-same-origin"`이고 studio와 다른 origin을 강제합니다.

`load`를 받으면 `document.open/write/close`로 새 HTML 문서를 구성합니다. `BuildInput.hostConfig`는 입력 스냅샷에서 그대로 `ParentToFrame.load.hostConfig`로 전달합니다. `hostConfig.toiFetch`가 있으면 문서의 첫 스크립트에서 `globalThis.__TOI_FETCH_CONFIG__ = Object.freeze({ ...hostConfig.toiFetch })`를 설정하고, 그 뒤에 `<script type="importmap">`, 실행 bootstrap, 앱 모듈 순서로 진행합니다. hostConfig 또는 toiFetch 설정이 없으면 전역을 만들지 않습니다. 따라서 앱의 최초 모듈 평가 시점부터 설정을 읽을 수 있고, bare import가 해석되기 전에 import map도 파싱됩니다. iframe 문서에 blob URL이나 srcdoc을 사용하지 않으므로 실제 preview origin이 유지되어 양방향 origin 검증이 가능합니다.

이 전역은 생성 코드가 읽을 수 있으며 `Object.freeze`는 설정 객체의 필드 변경을 막는 장치일 뿐 토큰을 숨기지 않습니다. viewer 역할만 가진 세션과 기본 **read capability·짧은 TTL**을 주입하고 editor 세션은 신뢰하는 host에만 둡니다. write capability는 명시적 승인 후 API 범위와 TTL을 제한해 전달합니다. hostConfig는 소스나 revision 식별자에 포함하지 않으므로 토큰 교체로 sourceDigest가 달라지지 않습니다.

앱 번들 자체는 URI 인코딩된 `data:text/javascript` 모듈로 import합니다. 문서 URL은 계속 HTTP입니다. 이를 통해 앱 안의 `</script>`·한글·이모지가 HTML 태그나 손상된 코드로 해석되지 않습니다. hostConfig, import map과 bootstrap 인자는 같은 `json()` 경로로 `<`, U+2028, U+2029를 escape합니다. 문서 작성 뒤 등록한 오류/미처리 rejection handler가 모듈 평가와 React의 초기 render throw를 감지합니다. 모듈 import가 끝나고 **2 rAF** 뒤 오류가 없을 때만 `rendered`를 보냅니다.

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
vitest: Test Files 2 passed (2), Tests 23 passed (23)
Playwright: 15 passed (15.8s), system channel: chrome
```

기존 단위 22개·브라우저 12개를 유지했고, hostConfig load 메시지 전달/입력 스냅샷 단위 테스트 1개와 브라우저 테스트 3개를 추가했습니다. 추가 브라우저 검증은 초기 실행 전 projectId 렌더, frozen 객체 변경 차단, 토큰의 closing-script/U+2028/U+2029 보존, 설정 미제공 시 전역 부재, 동일 revision 토큰의 설정만 교체한 재커밋을 확인합니다.

브라우저 검증은 첫 React 커밋/수정, 문법·모듈 throw·React render throw 시 동일 정상 화면 유지, r10→r11→r11 성공→r10 성공 경합, 최신 실패 뒤 과거 성공 폐기, 취소 뒤 늦은 성공, exact import 거부, digest 불일치, 상대/index 경로 및 계층 병합, allowlist 변경 뒤 context 재사용, closing-script/Unicode 보존, timeout/dispose, 잘못된 origin/source 메시지 무시를 포함합니다. COOP/COEP 헤더 부재와 `crossOriginIsolated=false`에서도 첫 커밋이 성공함을 확인합니다. 경합 테스트는 실제 번들 내부 top-level await로 이전 후보의 **실행 완료**를 지연시킵니다. 런타임의 성공 결과를 모킹하지 않습니다.

## 3회 측정

원시값과 환경·측정 경계는 [`bench/results.json`](bench/results.json)에 있습니다. 실행마다 덮어씁니다. 실제 deps-builder manifest로 측정하려면 `MANIFEST_URL=http://localhost:7100/.../manifest.json npm run bench`를 사용합니다.

| ms | 1회 | 2회 | 3회 | 중앙값 |
| --- | ---: | ---: | ---: | ---: |
| 준비 포함 첫 커밋 | 1195.1 | 1006.2 | 1030.8 | **1030.8** |
| 수정 → 커밋 | 49.8 | 49.1 | 49.9 | **49.8** |

시작은 `demo.run()` 호출 직전입니다. 토큰/source/manifest digest 준비, Worker 생성과 엔진 JS, WASM fetch/initialize, context 생성, 첫 rebuild, frame 문서 탐색·import map 구성, CDN 모듈 다운로드/평가, 2 rAF와 부모의 guard/iframe 교체를 포함합니다. 종점은 부모에서 commit 후 build Promise가 해결된 시점입니다. 이벤트의 `bundleMs`는 Worker 내부 작업 시작~결과까지, `bootMs`는 새 frame bootstrap 시작~2 rAF까지, `totalMs`는 `runtime.build()` 진입~교체까지이며 벤치의 바깥쪽 시간은 caller의 토큰 준비도 포함합니다.

엔진 예열 transform이나 빈 probe build는 없습니다. 3회 각각 새 browser context·Worker를 쓰되 하나의 Chrome process를 사용합니다. 수정은 같은 esbuild context와 HTTP cache를 유지합니다. 로컬 자산은 no-store이며 esm.sh HTTP cache·OS/DNS/TLS/CDN/WASM compile cache를 강제로 비우지 않았습니다. 초기 npm 설치, 서버 시작, 도구 소스의 사전 호스트 빌드, HTML navigation, 데모 helper JS 및 `demo.ready`까지의 manifest fetch는 제외합니다. 따라서 완전한 cold navigation 숫자는 아닙니다. 첫 커밋은 실제 CDN 의존성 요청을 포함하므로 로컬 준비 ESM을 쓴 기존 PoC와 직접 비교할 수 없습니다.

## 알려진 한계

- 2 rAF는 화면 반영의 대리 지표이며 실제 compositor paint 완료 증명이 아닙니다. 작은 TSX 1파일 fixture의 3회 중앙값이고 p95, 대형 graph, 사내 registry, TOI 1.3초의 재현을 뜻하지 않습니다.
- 프리뷰는 매번 새 realm으로 실행하므로 React 상태/Fast Refresh/HMR를 보존하지 않습니다. CSS/assets, Node builtin, CJS `require` 호환 레이어, tsconfig alias는 제공하지 않습니다. 계산식 dynamic import는 esbuild가 정적으로 해석할 수 없어 allowlist가 네트워크 접근 보안 경계가 되지 않습니다.
- 초기 실행 검증 이후 발생한 지연 오류를 자동 롤백하지 않습니다. 실행 완료된 API 쓰기도 롤백하지 않습니다. 정책 프록시의 권한·capability 검증은 별도 시스템이 담당합니다. iframe은 악성 코드의 CPU 무한 루프나 모든 데이터 유출을 막는 하드 샌드박스가 아닙니다.
- import map의 manifest digest는 확인하지만 각 외부 모듈의 sha256을 브라우저에서 별도로 검사하지 않습니다. 실제 산출물의 immutable URL/무결성/peer singleton은 deps-builder의 책임입니다. 공개 fixture의 `files:[]`는 이 검증을 대신하지 않습니다.
- frame 배포 CSP는 bootstrap과 `data:` 모듈 및 승인 의존성 origin을 허용하도록 별도 설계해야 합니다. 기본 데모 서버는 CSP를 설정하지 않습니다. HTTPS 배포에서는 studio, preview, WASM 및 의존성 URL을 모두 적절히 HTTPS로 바꿉니다.
- 취소된 토큰은 해당 런타임의 수명 동안 기억합니다. 프로젝트를 닫을 때 `dispose()`해야 합니다. 백그라운드 탭/숨겨진 상위 컨테이너의 rAF 억제로 boot timeout이 발생할 수 있습니다. 무제한 동시 후보 수를 제어하는 UI admission 정책은 소비 앱에서 추가해야 합니다.
