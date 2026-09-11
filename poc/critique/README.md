# 상호 비평 추가 PoC

기존 `../fixtures.mjs`, `../node_modules`, `../public/oxc`, `../public/singleton`을 읽기 전용으로 사용한다. 새 출력은 모두 이 디렉터리와 `../../astra-critique.md`에 둔다. 전역 설치는 없다.

```sh
cd /private/tmp/claude-501/-Users-psw-orca-workspaces-admin-ui-sargassum/4f10a63d-b5f0-49da-96ed-bc9d41509e2a/scratchpad/toss-admin/poc/critique
mkdir -p .tmp evidence
npm ci --cache "$PWD/.cache/npm" --no-audit --no-fund
node prepare.mjs
TMPDIR="$PWD/.tmp" node run-browser.mjs > evidence/browser.log 2>&1
node node-decompose.mjs > evidence/node-decompose.log 2>&1
node provenance.mjs
node validate.mjs
python3 write-report.py
```

Chrome 경로는 기본 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, 다른 설치는 `CHROME_PATH`로 지정한다. 부모 PoC 산출물이 이미 있는 현재 작업 폴더에서 재현하는 명령이며, 부모 전체 설치·준비를 다시 실행하지 않는다. 각 benchmark는 순차 실행한다.

- `render-case.mjs`: 동일 4파일 TSX, 100행. Oxc WASI `transformSync` + lexer + blob 상대경로 연결 + peer import map과 esbuild-wasm `context.rebuild`를 비교한다. Table 한 파일 수정 후 두 경로 모두 새 iframe으로 교체한다. React 상태를 보존하는 HMR 실험은 아니다.
- `bundleless.mjs`: 소스가 바뀐 파일만 재변환한다. blob URL을 직접 import하므로 변경은 부모 URL로 전파된다. 순환과 계산된 dynamic import는 명시 거부한다. source map은 Oxc 변환 map과 MagicString 재작성 map을 보관하고 에러 발생 시 두 단계로 추적한다.
- `render` 완료: table DOM 관찰 후 2 requestAnimationFrame, 부모 postMessage 수신. 100행 및 변경된 첫 셀 문자열을 검증한다. headless의 실제 GPU 페인트 완료를 측정하지 않는다.
- 엔진 준비는 측정 드라이버를 import한 뒤 시작한다. helper tools/fixture 로드와 adapter 사전 빌드는 제외, Oxc/esbuild 엔진 JS+WASM 로드·초기화는 포함한다. esbuild는 준비 단계에 context 생성도 포함한다. 첫 준비 완료 후 시간과 준비 포함 합계를 모두 기록한다.
- HTTP `no-store`, 매 sample 새 브라우저 context, 단일 Chrome process, localhost, COOP 없는 비격리 조건. OS/page/Chrome WASM 캐시는 강제로 비우지 않는다. cold WAN 또는 실제 토스 화면의 1.3초 재현이 아니다.
- 각 조건 3회. 최초 로더 구현은 lexer 3의 필드 변경을 놓쳐 실패했으며 수정 후 전체 browser suite를 다시 수행했다. 보존된 browser.json/log는 수정 후 전체 결과다.
- `decompose-case.mjs`: worker 켜기/끄기, 첫 호출 전 empty transform probe, WASM fetch+compile 사전 분리. `node-decompose.mjs`는 각 sample 새 Node process. probe는 비용을 앞당길 뿐 공짜 준비가 아니다.
- `provenance.mjs`: registry 게시 시각과 부모에 고정 설치된 pnpm 실행 파일의 버전·형식·SHA256를 읽는다. 패키지 설치 벤치는 재실행하지 않는다.
- `validate.mjs`: 12 렌더·15 browser 분해·3 edge·6 Node sample 구조/결과와 pnpm 버전을 검사한다. 속도 순위는 assert하지 않는다.

원시값은 `evidence/browser.json`, `evidence/node-decompose.json`, `evidence/pnpm-provenance.json`이다. `write-report.py`는 이 값으로 표와 비평 보고서를 만든다. 소규모 DAG의 결과를 임의의 CSS, assets, CJS, import attributes, dynamic loading, Fast Refresh 지원으로 확대하지 않는다.
