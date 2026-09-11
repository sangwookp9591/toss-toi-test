# Task: 토스 "AI 시대 어드민(TOI)" — 1차 자료 조사 + 실측 + 2026-09-11 대안 조사

## Target
- 작업 폴더(이 폴더 안에서만 파일 생성): `/private/tmp/claude-501/-Users-psw-orca-workspaces-admin-ui-sargassum/4f10a63d-b5f0-49da-96ed-bc9d41509e2a/scratchpad/toss-admin/` (이하 `$W`). PoC는 `$W/poc/`.
- 편집본 자막: `$W/transcript-tcGKZANuUVE.txt` (YouTube tcGKZANuUVE, Toss Challengers, 2026-09-10, 12분)
- 전체 웨비나: https://youtube.com/live/xDVbTlFfu30 (2026-08-25 'AI 시대, 토스 FE는 어떻게 일할까')
- yt-dlp: `/private/tmp/claude-501/-Users-psw-orca-workspaces-admin-ui-sargassum/4f10a63d-b5f0-49da-96ed-bc9d41509e2a/scratchpad/venv/bin/yt-dlp`, 실행 시 `SSL_CERT_FILE=$(<같은 venv>/bin/python -m certifi)` 필요.

## 발표 요지 (코디네이터 요약)
어드민 생성 플랫폼. 데이터·컴플라이언스는 서버 프록시(API 등록 → 마스킹·암호화·감사로그 자동), UI는 AI가 API 스키마 + 사내 패턴(테이블/필터/상세)으로 React 코드 생성. 프리뷰 런타임: ① 서버 Next.js dev 서버 공유 → 격리 실패 ② Sandpack → 첫 화면 47초, 사내 패키지 주입 어려움 ③ 직접 구축: 메모리 VFS + esbuild-wasm 번들링 + 의존성은 "Package Set Hash"(package.json 엔트리 + yarn.lock 해시) 단위로 yarn install → Vite 번들 → import map → S3. 성공 시에만 반영("트랜잭션 커밋"). 47s → 1.3s. 6개월 프로젝트 ~440, 페이지 ~2400, 라이브 ~120.

## Change — 산출물 `$W/astra-report.md` (증거: URL·명령·원시 측정값)
1. **1차 자료**: 전체 웨비나 자막/설명, toss.tech의 발표자 관련 글, 기타 공개 자료에서 Backend 통신(채팅↔에이전트 스트리밍, API 등록·스키마 형식, 프록시, 인증, 저장, 배포, Git/리뷰)에 대한 **확인된 사실**을 모은다. 확인/추정/unverifiable 분리.
2. **esbuild-wasm 선택 검증 PoC**: 메모리 VFS 플러그인 + esbuild-wasm으로 React TSX 몇 파일 번들, 의존성은 import map external. Node와 headless 브라우저에서 wasm 준비·첫 번들·증분 재번들 측정. 같은 입력으로 대안 비교: @swc/wasm(-web), sucrase, @babel/standalone, @rolldown/browser(2026-09 최신), oxc 계열. **변환기 vs 번들러**를 구분하고, 증분과 전체 재번들은 같은 표에서 우열 비교하지 말 것. @rolldown/browser는 브라우저 엔트리가 COOP/COEP(crossOriginIsolated) 없이 동작하는지 헤더 유무 두 조건으로 확인하고, 격리된 부모가 cross-origin 프리뷰 iframe을 임베드할 수 있는 조건도 확인.
3. **싱글톤 대안 실증**: 조합 전체 번들 대신 **패키지 단위 ESM + peer external(import map)** 방식에서 React 인스턴스 1개·hooks·QueryClient 공유가 유지되는지 브라우저에서 확인. 이 방식과 조합 캐시의 트레이드오프(캐시 단위, 콜드 miss, 원자적 롤백, 네트워크 요청 수)를 표로.
4. **yarn 선택 검증**: 같은 소규모 의존성 세트로 yarn classic/berry, pnpm, npm, bun의 lockfile 결정성, cold/warm 설치 시간, 사내 registry 스코프 구성 난이도. 토스식 해시 규칙(정렬된 엔트리 + lockfile 해시)을 재현해 **어떤 변화에 키가 바뀌고/안 바뀌는지**(lock 공백, 빌드 도구·설정 버전 등) 검사.
5. **2026-09-11 기준 대안 재료**: 브라우저/원격 프리뷰 런타임(WebContainers, Sandpack 최신, Nodebox, CodeSandbox SDK, Cloudflare/Vercel Sandbox, esm.sh/JSPM self-host, Vite 8/Rolldown 등)과 AI 앱·어드민 빌더(v0, Bolt, Lovable, Retool 등)의 아키텍처. 버전·날짜·출처 필수, 토스 요구(사내 패키지·격리·속도·컴플라이언스) 적합도.
6. **Astra 의견**: 토스가 놓친 점/개선 우선순위(실측 근거 기반, 이미 공개된 구현을 누락으로 비판하지 말 것).

## Constraints
- `$W` 밖 파일 수정 금지, 전역 설치 금지, git 조작 금지.
- 추정은 "추정", 확인 불가는 `unverifiable`. 측정은 3회 반복 후 중앙값, 환경(OS, CPU, Node) 기록.
- 코디네이터(Claude Opus)가 `$W/opus-analysis.md`를 병렬로 독립 작성한다. 이번 Task에서는 읽지 말 것(상호 비평은 후속 Task).

## Ownership
- 편집 가능: `$W/poc/**`, `$W/astra-report.md`

## Observable acceptance
- `astra-report.md`에 1~6 섹션, 각 측정표에 명령과 원시 수치.
- `$W/poc/README.md`의 재현 명령으로 벤치가 다시 돈다.
