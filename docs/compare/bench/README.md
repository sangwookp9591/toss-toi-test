# CMP1 스튜디오 첫 커밋 재측정

실행일 2026-09-13. 제품 소스 수정 없이 실제 5173 스튜디오·5174 frame·7400 agent·7200 policy를 사용한다. 비교 해석과 수치는 [TOSS-GAP.md](../TOSS-GAP.md) §3을 참고한다.

## 실행

모든 서비스와 `bench/node_modules`가 준비된 저장소 루트에서 실행한다. E2E·다른 벤치가 동시에 실행 중이면 안 된다. 먼저 7100 listener PID와 실행 경로를 확인한다.

```sh
lsof -nP -iTCP:7100 -sTCP:LISTEN
ps -p <확인한_PID> -o command=
bench/node_modules/.bin/tsx docs/compare/bench/run.mts --replace-builder-pid=<확인한_PID>
```

`<확인한_PID>`는 실제 숫자로 바꾼다. 스크립트는 PID가 이 저장소의 deps-builder main인지 검증한다. 경로가 다른 클론에서는 안전 검사에 있는 체크아웃 경로도 해당 클론에 맞게 검토해야 한다. `CMP1_SCRATCH`로 임시 Yarn/cache와 복구 로그의 위치를 바꿀 수 있다. 기본은 과제에서 지정한 외부 `scratchpad/cmp1/`다.

측정 동안 **7100 서비스만** 종료하고 동일 `PackageBuilder/createApp/MinioStore` 구현을 같은 포트에서 실행한다. 6개 trial 각각 빈 MinIO bucket·Yarn cache·builder 상태를 사용하며, trial 안에서는 miss → hit → edit 순서다. 원래 bucket/캐시/설정은 보존한다. 끝나면 임시 bucket/cache를 지우고 원래 `src/main.ts`를 같은 포트에 다시 실행해 health를 확인한다. `results.json.serviceRestored`가 true인지 확인한다. 강제 kill/머신 종료는 finally 복구를 보장하지 않으므로 7100 상태를 별도로 확인해야 한다.

복구된 builder는 **외부에서 시작한 독립 프로세스**다. 소유 범위 밖인 `scripts/.run/processes.json`은 수정하지 않아 기존 dev-down 관리 목록에는 새 PID가 등록되지 않는다. 전체 서비스를 내릴 때는 `lsof`와 `ps`로 복구 listener를 재확인해 해당 프로세스도 종료한다. 스크립트가 만든 `CMP1 <network> <repeat>` 프로젝트는 기존 agent의 gitignored 런타임 데이터에 남으며 기존 프로젝트는 수정하지 않는다. 최종 project ID는 원시 JSON에 있다.

## 측정 경계

- 시작: 기존 프로젝트 URL로 새 navigation의 `performance.timeOrigin`. HTML·studio JS/CSS·개발 세션 발급·project GET·dependency POST·capability·Worker/WASM·frame/ESM 모두 포함한다.
- 끝: 제품이 원래 노출하는 `window.studio`에 read-only subscriber를 붙여 새 `lastCommit`을 동기 관찰한 시점. runtime의 iframe 교체와 frame의 2 rAF 이후다. 측정 완료 대기는 polling이지만 **값은 이벤트 시점에 저장**하므로 polling 간격을 duration에 더하지 않는다. compositor paint 완료를 보장하는 지표는 아니다.
- 수정: 이미 열린 hit 페이지에서 `edit`/`saveFiles` 시작 → 다음 revision 커밋. 입력을 타이핑하는 인간 시간은 제외하고 저장/CAS·조합 확인·capability·rebuild·새 frame 비용은 포함한다.
- 각 navigation은 새 browser context + CDP HTTP cache clear, 수정은 정상 HTTP/module cache와 Worker/context 유지. Playwright route/mock/response fulfillment는 사용하지 않는다.
- slow는 CDP latency **400ms**, down **750,000B/s**, up **250,000B/s**. localhost 업무 서비스와 브라우저에 적용하지만 서버→registry/MinIO는 로컬 무제한 그대로다. Worker Resource Timing의 WASM 다운로드 약 19초로 실제 제한 적용을 확인한다.
- 앱은 기존 `bench/app.mjs`의 20행 정적 고객 Table이며 스튜디오 기본 package set을 쓴다. 실제 고객 API 조회·모델 생성은 없다. 실제 스튜디오 CSS가 불러오는 Google Fonts는 차단하지 않는다. 따라서 local은 **인위적 제한 없음**이지 모든 요청이 localhost라는 뜻은 아니다.
- 개발 서버는 JS/CSS/WASM을 압축 없이 no-store로 제공한다. 기동·프로젝트 fixture 생성·npm 설치는 측정 밖이다. OS/DNS/registry upstream/CDN/WASM compile cache는 통제하지 않는다. 최초 helper 예열 빌드는 없지만 사전 계측 점검과 같은 Chrome 프로세스 효과는 배제하지 않았다.

## 파일과 실패 처리

`results.json`은 6개 trial의 원시값, 각 network의 3회 중앙값, 202/200 확인, builder install/build 횟수, host/Worker의 Resource Timing을 포함한다. resource 이름은 query/credential 없이 path만 저장한다. runtime `bundleMs/bootMs/totalMs`는 전체 navigation 시간의 구성 참고값이며 서로 중첩되므로 합산하지 않는다. Chrome이 일부 Worker JS Resource Timing에 음수 duration을 보고할 수 있어 이 값은 분해 분석에 사용하지 않는다.

`node docs/compare/bench/validate.mjs`는 원시값·중앙값·HTTP hit/miss·점수·로컬 링크·변경 범위·비밀값 및 복구 health를 확인하고 [validation.json](validation.json)을 쓴다. [dependency-observation.json](dependency-observation.json)은 최종 실행 중 읽은 Yarn cache 파일명만 기록한 자료이며 서드파티 코드나 자격증명을 담지 않는다.

최초 계측은 TypeScript/tsx가 직렬화할 브라우저 함수에 `__name` 보조 함수를 삽입해 subscriber에서 오류가 났다. `failed-probe.json`에 180초 timeout, `failed-probe-2.json`에 원인을 확인한 뒤 측정용 Chrome만 종료한 실행을 보존했다. 둘 다 원래 builder 복구가 true이며 제품의 성능 실패로 집계하지 않는다. 최종 스크립트는 변환되지 않는 원문 JavaScript init script를 사용한다. 최종 측정에는 실패값을 성공값으로 대체하지 않으며 오류/timeout 시 JSON에 남기고 exit 1로 종료한다.
