# Sandpack / TOI-lite 비교

이 환경의 3회 중앙값에서 **Sandpack cold 첫 화면은 918ms, TOI-lite cold(조합 miss 포함)는 2,069ms**였다. 이 작은 앱에서는 TOI-lite cold가 Sandpack보다 느렸다. 토스 사례의 “47초 → 1.3초” 수치를 재현했다고 주장하지 않는다.

**TOI-lite 내부 cold → warm 변화**는 조합 miss 포함 2,069ms에서 조합 hit 397ms로 측정됐고, 수정 후 커밋은 115ms였다. warm 값은 TOI의 조합 캐시 적중 효과를 보여 주며 Sandpack cold와의 동급 비교 값이 아니다.

## 실행과 결과

```sh
node scripts/dev-up.mjs
npm --prefix bench ci
npm --prefix bench run run
```

2026-09-13, Apple M4 / macOS arm64, Node v22.14.0, 시스템 Chrome 153.0.8010.36. 전체 원시 값·환경·조건은 [`results.json`](results.json)에 있다. 각 값을 ms 단위 소수 첫째 자리로 표시했다.

| 항목 | 1회 | 2회 | 3회 | 중앙값 |
| --- | ---: | ---: | ---: | ---: |
| Sandpack cold 첫 화면 | 1075.9 | 885.4 | 917.9 | **917.9** |
| TOI-lite cold, 조합 miss 포함 | 2325.1 | 1942.1 | 2069.4 | **2069.4** |
| TOI-lite warm, 브라우저 캐시 비움 | 397.3 | 386.9 | 396.6 | **396.6** |
| TOI-lite 수정 → 커밋 | 114.8 | 114.3 | 131.4 | **114.8** |

cold POST는 세 번 모두 HTTP 202, warm POST는 세 번 모두 HTTP 200을 확인했다. 실패나 timeout을 성공 값으로 대체하지 않는다. 실패하면 오류를 원시 JSON에 기록하고 프로세스가 실패 상태로 종료된다.

## 측정 경계와 조건

| 조건 | Sandpack cold | TOI-lite cold | TOI-lite warm | TOI-lite 수정 |
| --- | --- | --- | --- | --- |
| 시작점 | Sandpack React provider mount 직전 | PreviewRuntime 생성 및 조합 요청 직전 | 동일 | VFS 수정 빌드 호출 직전 |
| 종점 | 프리뷰 DOM의 `벤치 고객 목록` h1 표시 확인 + 2 rAF | 정상 커밋 후 같은 h1 확인 + 2 rAF | 동일 | `벤치 고객 목록 수정` 확인 + 2 rAF |
| 런타임 준비 | 새 Sandpack client | 새 Worker, WASM 다운로드·initialize 포함 | 동일 | Worker/esbuild context 유지 |
| 브라우저 캐시 | 새 context + CDP clearBrowserCache | 동일 | 동일 | 기존 HTTP/module cache 유지 |
| 의존성 저장 캐시 | 원격 bundler 서버 캐시 통제 불가 | 매회 새 MinIO bucket, 빈 Yarn cache/workspace | 직전 cold 산출물 적중 | 재요청 없음 |
| 네트워크 | CodeSandbox 원격 번들러·공개 npm 경로 | 로컬 Verdaccio/MinIO/HTTP | 로컬 HTTP | 로컬 프레임, 캐시된 ESM |
| 패키지 | React/react-dom 19.3.0 | 동일 + 사내 @toi/tds 1.0.0 | 동일 | 동일 |

부모 페이지의 `performance.now()`를 사용한다. Playwright가 visible marker를 최대 50ms 간격으로 확인하므로 관측 지연이 포함된다. TOI는 자체 rendered의 2 rAF와 커밋이 끝난 뒤 공통 DOM 종점의 2 rAF를 추가로 기다린다. host HTML 이동과 이미 빌드된 측정 harness JS 다운로드는 양쪽 모두 타이머 밖이다. 실제 스튜디오 전체 navigation, 채팅 모델 시간, 프로젝트 저장, API 조회 시간은 포함하지 않는다. 따라서 “사용자가 URL을 연 순간부터”의 페이지 로드 시간이 아니다.

인위적인 네트워크/CPU throttling은 없다. DNS/OS 캐시, Verdaccio upstream 캐시, npm/CDN 및 CodeSandbox 서버 캐시는 비우지 않았다. 정식 3회 전 harness 동작 확인 실행이 있었으며 브라우저 context/HTTP 캐시와 TOI 조합 저장소는 정식 매회 새로 만들었다. 원격 서비스의 진정한 최초 실행을 보장하지 않는다. 측정 동안 E2E 테스트를 동시에 실행하지 않았다.

## 앱과 비교 한계

`app.mjs`가 양쪽의 동일한 20개 정적 고객 행과 마스킹된 휴대폰을 생성한다. Sandpack은 공개 React만 사용한 HTML table이며 TOI는 사내 `@toi/tds`의 Table을 사용한다. 표의 컬럼·데이터·heading은 같지만 의존성 그래프는 다르다. 인증된 Verdaccio의 사내 패키지를 공개 Sandpack에 전달하지 않았다. 두 앱 모두 네트워크 업무 조회나 @toi/fetch를 포함하지 않으며, 그 흐름은 E2E A/D에서 별도 검증한다.

`@codesandbox/sandpack-react`는 npm latest 확인값 **2.20.0**으로 lockfile에 고정했다. 실행 시 기본 번들러 origin은 `https://2-19-8-sandpack.codesandbox.io/`였다. [공식 사용법](https://sandpack.codesandbox.io/docs/getting-started/usage)의 React provider/preview와 customSetup을 사용한다. 번들러 버전 문자열과 npm 패키지 버전이 다른 것은 기본 SDK 설정 그대로다.

`run.ts`는 deps-builder 공개 구현을 읽어 각 cold trial에 별도 저장 bucket 및 이 폴더의 `.cache/`를 지정한다. 기존 서비스의 코드와 캐시를 수정하지 않는다. trial 후 생성한 bucket/캐시를 삭제하며 기존 서비스의 산출물은 보존한다. TOI warm 이점은 이 조건에서 관측됐지만 세 표본으로 다른 앱·네트워크의 일반적인 배수를 주장할 수 없다.
