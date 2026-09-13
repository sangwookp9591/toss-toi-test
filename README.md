# toss-toi-test

토스 FE 웨비나 「AI 시대, 토스 FE는 어떻게 일할까」(2026-08-25)의 **AI 시대 어드민(TOI)** 세션을 1차 자료와 직접 실측으로 분석한 기록입니다.
토스와 무관한 독립 분석이며, 모든 수치는 공개 자료와 이 저장소의 PoC에서 나왔습니다.

- 분석·종합: Claude Opus / 실측·조사: Codex Astra (high) / 상호 비평 2라운드
- 기준일: 2026-09-11 · 측정 환경: Apple M4, macOS 26.6.2, Node v22.14.0, Chrome 153 · 3회 반복 중앙값

## 핵심 결론

1. **47초 → 1.3초는 esbuild 덕이 아닙니다.** 의존성 준비를 편집·프리뷰 경로에서 떼어낸 아키텍처 전체의 결과입니다.
2. **esbuild-wasm도 yarn도 필연은 아니었습니다.**
   - 번들 없는 방식(Oxc 변환 + blob URL + import map)은 첫 화면이 132ms로 esbuild 300ms보다 빨랐지만, 수정 반영은 약 50ms로 동률이었습니다.
   - 패키지 매니저 5종 모두 lockfile을 3회 생성해도 같았습니다.
3. **가장 큰 빈칸은 엔진이 아니라 운영입니다.**
   - Package Set Hash에는 빌드 도구·설정 변화가 반영되지 않습니다.
   - 프리뷰 "트랜잭션"은 화면만 되돌리고, 이미 보낸 API 쓰기는 되돌리지 못합니다.
   - 라이브 앱의 수명주기를 추적하는 방법이 공개되지 않았습니다.
4. **Sandpack을 버린 이유**: 런타임 의존성 다운로드 때문에 첫 화면이 47초였고, 사내 레지스트리 인증 프록시(tarball URL 재작성, 전이 의존성, CORS/PNA) 비용이 컸습니다. 불가능해서가 아니라 비용과 통제권의 트레이드오프였습니다.
5. **Rolldown browser 1.2.8**은 COOP/COEP 격리가 없으면 3/3 실패했습니다.

## 구성

| 경로 | 내용 |
|---|---|
| [`site/index.html`](site/index.html) | 공유용 요약 페이지 (브라우저로 열기) |
| [`intent/INTENT.md`](intent/INTENT.md) | "채팅으로 어드민을 만드는 플랫폼"의 proto-spec (draft). [AI-native SDLC Playbook](https://academy.claude.com/courses/ai-native-sdlc-playbook/capture-intent)의 Capture Intent 형식을 따름 |
| [`astra-report.md`](astra-report.md) | Astra 1차 조사·실측 보고서: 1차 자료, 번들러 비교, 싱글톤 실증, 패키지 매니저·해시 검사, 대안 |
| [`opus-analysis.md`](opus-analysis.md) | Opus 독립 분석 |
| [`opus-critique.md`](opus-critique.md) | Opus → Astra 비평과 자기 수정 |
| [`astra-critique.md`](astra-critique.md) | Astra → Opus 비평: 번들 없는 방식 실측, 측정 경계 정정, Backend 경합 설계, 합의 표 |
| [`astra-spec.md`](astra-spec.md) | Astra에게 준 작업 명세 |
| [`poc/`](poc/) | 벤치마크 소스, 원시 결과 JSON, 로그 ([`poc/README.md`](poc/README.md), [`poc/critique/README.md`](poc/critique/README.md)) |

## 재현

```sh
cd poc && npm ci && npm run bench           # 번들러·설치·해시 벤치 (README 참고)
cd poc/critique && node prepare.mjs         # 브라우저 헬퍼 번들 생성
node run-browser.mjs && node validate.mjs   # 번들 없는 방식·분해 측정
```

브라우저 벤치는 시스템 Chrome과 `playwright-core`가 필요합니다. `poc/public/`(사전 번들한 서드파티 라이브러리)과 `poc/critique/tools.js`는 준비 스크립트가 다시 만듭니다.

## 저장소에 포함하지 않은 것

보고서 일부는 아래 파일에 링크하지만, 저작권과 재배포 문제 때문에 이 공개 저장소에서는 뺐습니다. 원문은 출처에서 확인하세요.

- 웨비나 자동 자막과 메타데이터 (`poc/evidence/webinar*`, `transcript-*.txt`) → [전체 웨비나](https://youtube.com/live/xDVbTlFfu30), [편집본](https://www.youtube.com/watch?v=tcGKZANuUVE)
- 토스 기술 글 HTML 사본 (`poc/evidence/toss-52885.html`) → [AI가 만든 코드가 어드민이 되기까지](https://toss.tech/article/52885)
- 조사 중 수집한 웹 문서 원문 (`poc/evidence/source-*.txt`). URL 목록은 [`poc/evidence/source-index.json`](poc/evidence/source-index.json)에 남겨 둠
- `node_modules`, 패키지 매니저 캐시, 사전 번들한 서드파티 라이브러리

## 한계

Apple M4 한 대, 작은 fixture, 3회 중앙값입니다. 큰 모듈 그래프, CSS·asset, 사내 레지스트리, WAN p95, 동시 빌드 경합은 측정하지 못했습니다. 어느 수치도 토스의 1.3초를 독립적으로 재현한 것이 아닙니다. 공개되지 않은 토스 내부 구현은 보고서에서 `unverifiable`로 표시했습니다.

## TOI-lite 실행

Docker Desktop, Node.js 22, npm, 시스템 Google Chrome이 필요하다. Docker를 실행한 뒤 저장소 루트에서 다음 명령을 실행한다. 새 클론에서도 별도의 패키지 설치나 환경 파일 작성 없이 이 한 줄로 첫 기동한다.

```sh
node scripts/dev-up.mjs
```

스크립트는 Docker Compose의 Keycloak(8080)/Verdaccio/MinIO, 사내 패키지 등록, mock-backend(7300), policy-proxy(7200), deps-builder(7100), agent-server(7400), 스튜디오(5173)와 프리뷰 origin(5174)을 순서대로 확인한다. fake-tds·preview-runtime과 모든 실행 서비스·스튜디오의 의존성을 각 폴더의 lockfile로 설치하며 정상 실행 중인 서비스는 재사용한다. `node scripts/dev-up.mjs --check`로 설치 대상과 lockfile을 서비스 기동 없이 검사할 수 있다.

기동 출력에는 단계별 소요 시간이 표시된다. 실패하면 `registry setup failed: fake-tds build failed: tsc not found`처럼 실패 단계와 원인 요약, 로그 경로를 표시한다. 전체 기동 로그는 `scripts/.run/dev-up.log`, 서비스별 로그는 `scripts/.run/<서비스 이름>.log`, 직접 시작한 프로세스 목록은 `scripts/.run/processes.json`에 보관한다. 기동 로그는 비밀값을 가리고 레지스트리 설정 오류는 안전한 원인 요약만 출력한다. 원인을 해결한 뒤 같은 dev-up 명령을 다시 실행한다.

[스튜디오](http://localhost:5173)에서 Keycloak 사용자 alice로 로그인한다. 비밀번호는 dev-up이 무작위 생성한 `.env`의 `TOI_PASSWORD_ALICE`를 확인한다(bob/carol/dana/root도 `TOI_PASSWORD_*`). 로그인 후 프로젝트를 만들고 “고객 목록 화면 만들어줘”를 입력한다. 조회 사유 질문에 답하면 생성된 코드와 미리보기를 볼 수 있다. 조회 사유를 입력한 뒤 조회하면 마스킹된 고객 데이터가 표시된다. 코드 편집 후 “저장하고 반영”으로 저장하며 오류가 있으면 마지막 정상 화면을 유지한다. 쓰기 작업은 기본 차단되고 “쓰기 테스트 허용”을 켰을 때 현재 프로젝트의 API에 2분간 허용된다. 프리뷰에는 `/preview-sessions`로 발급한 프로젝트 한정 viewer 세션과 capability만 전달하며 Keycloak 토큰은 전달하지 않는다. `/dev/session`은 제거했다.

프로젝트 viewer는 열기·preview read, editor는 생성·저장·preview write, owner는 멤버 관리·live 승인 요청을 할 수 있다. 비멤버는 404이며 멤버 제거는 다음 proxy 요청부터 적용된다. live 쓰기는 owner 요청 후 해당 API api-owner(dana)의 4-eyes 승인이 필요하고 본인 승인은 금지한다. 승인은 기본 5분 후 만료된다. preview/live는 서로 다른 upstream 경로·데이터셋·서비스 토큰을 사용한다. 자세한 API와 역할표는 [policy-proxy README](services/policy-proxy/README.md)에 있다.

기본 에이전트는 키가 필요 없는 mock 모드다. 실제 Claude 모드는 루트 `.env`에 `ANTHROPIC_API_KEY`를 설정하고 `AGENT_MODE=claude node scripts/dev-up.mjs`로 시작한다. 이미 agent-server가 실행 중이면 해당 프로세스를 먼저 종료해야 새 모드가 적용된다. 모델/SDK 설정과 실제 모드 검증 범위는 [agent-server README](services/agent-server/README.md)를 참고한다. 비밀 값은 브라우저 코드에 넣지 않는다.

```sh
npm --prefix apps/studio run typecheck
npm --prefix e2e ci
node scripts/dev-up.mjs --e2e
npm --prefix e2e run test:repeat
node scripts/dev-up.mjs # 승인 TTL 기본 300초 복원
npm --prefix bench ci
npm --prefix bench run run
node scripts/dev-down.mjs
```

E2E는 시스템 Chrome의 실제 Keycloak 로그인으로 A–S를 세 번 반복한다. `dev-up --e2e`는 승인 만료 테스트를 위해 TTL을 8초로 줄이고 관리 중인 policy-proxy를 필요하면 재시작한다. 일반 `dev-up`은 기본 300초를 다시 적용한다(명시적 `TOI_APPROVAL_TTL_SEC` 설정은 유지). 옵션 없이도 E2E는 실제 만료 시각까지 기다리지만 반복마다 최대 5분이 추가된다. 결과와 화면은 [e2e/README.md](e2e/README.md), 비교 조건과 3회 원시 측정값은 [bench/README.md](bench/README.md), 구현 구조는 [스튜디오 README](apps/studio/README.md)에 있다. `dev-down`은 dev-up이 직접 시작한 프로세스와 Docker Compose를 종료하며, 외부에서 시작해 재사용한 서비스는 종료하지 않는다. Docker 볼륨은 보존한다.
