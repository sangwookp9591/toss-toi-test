# W1: 브라우저 프리뷰 런타임 (packages/preview-runtime)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 만들 곳: `packages/preview-runtime/` (라이브러리 + 데모 페이지 + 테스트)
- 반드시 읽을 것: `docs/ARCHITECTURE.md`, `contracts/src/runtime.ts`, `contracts/src/package-set.ts`, `intent/INTENT.md`
- 참고 근거: `astra-critique.md` §2~3(번들 없는 방식·esbuild 측정 경계), `poc/`(기존 벤치 코드)

## Change
`contracts/src/runtime.ts`의 `PreviewRuntime`을 구현한다.

1. **4계층 메모리 VFS**: user > project > template > runtime 우선순위로 병합. `sourceDigest` 계산 함수 export.
2. **Web Worker + esbuild-wasm**(최신 안정 버전 고정): Worker 안에서 `initialize` → `context` 유지 → `rebuild` 증분. VFS는 `onResolve/onLoad` 플러그인(상대 경로, 확장자 탐색 `.tsx .ts .jsx .js`, `index.*`). JSX automatic, format esm, sourcemap inline.
3. **external 허용 목록**: `manifest.importMap.imports` 키와 **정확히 일치**하는 specifier만 external. 그 외 bare import는 Diagnostic `package not in package set: <specifier>`로 빌드 실패. (esbuild의 `external` 배열은 하위 경로까지 매칭하므로 onResolve로 exact 판정할 것)
4. **트랜잭션 커밋 + revision guard**: 시도마다 **새 숨김 iframe**(previewOrigin의 frame.html) 생성 → `ParentToFrame.load` 전송 → frame이 import map 주입 후 번들 실행 → 2 rAF 뒤 `rendered` 또는 `error` → 조건 충족 시에만 기존 iframe과 교체. 조건: rendered, desired 토큰과 모든 필드 일치, 취소 안 됨. 아니면 `stale_discarded`/`runtime_failed`/`build_failed`로 끝내고 **마지막 정상 iframe 유지**. postMessage는 양쪽 origin·source 검증.
5. **frame.html**: previewOrigin에서 서빙. import map은 문서 파싱 전에 주입해야 하므로, frame은 `load` 메시지를 받으면 import map을 포함한 새 문서를 blob/srcdoc 없이 구성하는 방식이 필요하다(예: frame.html이 부모 메시지 수신 → `document.open/write`로 `<script type="importmap">` + module script 삽입, 또는 쿼리로 manifest URL을 받아 서버에서 import map을 인라인). 방식 선택과 근거를 README에 적는다.
6. **데모**: `pnpm`/`npm` 스크립트 `dev`로 스튜디오 역할 페이지(5173)와 프리뷰 origin 서버(5174)를 동시에 띄운다. 에디터는 textarea로 충분. 의존성 manifest는 W2가 아직 없으므로 **공개 esm.sh URL로 만든 가짜 manifest fixture**(react 19, react-dom/client, react/jsx-runtime)로 먼저 동작시키고, `manifestUrl` 쿼리로 실제 deps-builder manifest를 받게 한다.
7. **테스트**
   - 단위(vitest): VFS 병합 우선순위, external exact 판정, revision guard 판정 표(아래 4케이스).
   - 브라우저(Playwright, 시스템 Chrome): 첫 커밋 성공, 수정 후 커밋, 문법 오류 시 이전 화면 유지, 런타임 throw 시 이전 화면 유지, **r10 요청 → r11 요청 → r11 성공 → r10 늦게 성공 ⇒ r11만 커밋**, 취소 후 늦은 성공 폐기, 허용 목록 밖 import 실패, COOP/COEP 없이 동작.
8. **측정**: 3회 중앙값으로 준비 포함 첫 커밋, 수정 → 커밋 시간을 `packages/preview-runtime/bench/results.json`에 기록. 측정 경계(예열 여부, 종점)를 README에 명시.

## Constraints
- `packages/preview-runtime/` 밖 수정 금지. `contracts/`는 읽기 전용이며 `import type`으로 참조. 계약과 어긋나야 하면 구현을 멈추고 ask로 질문.
- 전역 설치 금지, git commit 금지. 이 패키지 전용 `package.json`/lockfile.
- COOP/COEP 격리 헤더에 의존하지 않는다.
- 포트: 5173(데모 스튜디오), 5174(프리뷰 origin). 다른 워커가 7100 이상과 4873/9000을 쓴다.

## Ownership
- 편집 가능: `packages/preview-runtime/**`
- W2(deps-builder)가 병렬로 `services/deps-builder/**`, `packages/fake-tds/**`를 만든다. 서로의 폴더를 건드리지 않는다.

## Observable acceptance
- `cd packages/preview-runtime && npm test` (단위+브라우저) 전부 통과, 출력 요약을 README에 붙인다.
- `npm run typecheck` 통과.
- `bench/results.json`에 원시 3회 값과 중앙값.
- README: 구조, frame 문서 구성 방식과 근거, 실행 방법, 측정 경계, 알려진 한계.
