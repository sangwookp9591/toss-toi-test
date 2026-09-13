# CMP1: TOI-lite 결과물과 토스 TOI 차이 분석

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test` (main `b5e3786`). 서비스는 이미 떠 있다: 4873·9000·7100·7200·7300·7400·5173·5174, 에이전트는 mock 모드.
- 토스 쪽 1차 자료(공개 자료만):
  - 기술 글 https://toss.tech/article/52885 (2026-09-04, 「AI가 만든 코드가 어드민이 되기까지」)
  - 편집 영상 https://www.youtube.com/watch?v=tcGKZANuUVE
  - 전체 웨비나 https://youtube.com/live/xDVbTlFfu30 (TOI 세션과 Q&A)
  - 자막이 필요하면 `/private/tmp/claude-501/-Users-psw-orca-workspaces-admin-ui-sargassum/4f10a63d-b5f0-49da-96ed-bc9d41509e2a/scratchpad/venv/bin/yt-dlp`를 쓴다(`SSL_CERT_FILE=$(<같은 venv>/bin/python -m certifi)`). 받은 자막·HTML은 `/private/tmp/claude-501/-Users-psw-orca-workspaces-admin-ui-sargassum/4f10a63d-b5f0-49da-96ed-bc9d41509e2a/scratchpad/cmp1/`에만 두고 **저장소에 커밋될 경로에 복사하지 않는다**(저작권).
- 우리 쪽: `docs/ARCHITECTURE.md`, `contracts/src/*`, `intent/INTENT.md`, 각 패키지 README, `bench/README.md`, `docs/qa/qa3/QA3-REPORT.md`, `docs/FOLLOWUPS.md`, 기존 분석(`astra-report.md`, `astra-critique.md`)

## Change
`docs/compare/TOSS-GAP.md`를 작성한다. **소스는 수정하지 않는다.**

1. **기능 대응표**: 토스 TOI가 공개적으로 설명한 기능과 설계 요소를 하나씩 뽑고(출처: 글 절 이름 또는 영상 타임스탬프), 각각 TOI-lite 대응을 판정한다.
   - 판정: `동등 / 부분 / 다름(의도적 개선) / 없음 / 확인 불가(토스 비공개)`
   - 근거: 우리 쪽은 파일:줄 또는 테스트 이름, 토스 쪽은 출처 위치
   - 최소 포함 항목: 채팅·역질문·플래닝, API 등록과 스키마 활용, 정책 프록시(마스킹·조회 사유·다운로드 암호화·감사), 프리뷰 런타임(4계층 VFS, Worker, esbuild-wasm, external 규칙, 실패 시 정상 화면 유지·문서 교체), 사내 레지스트리 인증, Package Set Hash와 조합 사전 빌드·S3·import map, 싱글톤 처리, 코드 저장(S3)·Git/PR 리뷰·릴리즈·배포, 사내 디자인시스템(TDS)·패턴(테이블/필터/상세), MCP·GitOps·이관, 운영 규모(440 프로젝트·120 라이브)
2. **아키텍처 차이**: 같은 문제를 다르게 푼 지점과 그 이유·트레이드오프. 예: artifactKey 이원화, revision guard, capability read 기본, Origin 판정, 실패 원인 코드, 다른 탭 복원.
3. **성능 비교**
   - 토스 공개 수치: Sandpack 47초 → 1.3초 첫 화면. 측정 조건 중 공개된 것과 비공개인 것을 구분한다.
   - TOI-lite를 **토스 수치에 최대한 가까운 정의**로 다시 측정한다(3회 중앙값).
     - 스튜디오에서 기존 프로젝트를 열었을 때 프리뷰 첫 커밋까지(조합 hit, 브라우저 캐시 비움)
     - 새 조합 miss 포함
     - 수정 → 커밋
   - 네트워크 조건을 둘 이상으로 나눈다: 로컬 무제한, CDP로 느린 연결(QA1과 같은 조건: latency 400ms, down 750kB/s, up 250kB/s).
   - 기존 `bench/`의 Sandpack 비교 결과도 인용하되, 조건 차이를 표로 명시한다. "토스 1.3초를 재현했다"는 주장은 조건이 같을 때만 쓴다.
4. **규모·운영 차이**: 토스는 실서비스(사내 SSO, 다수 사용자, 실제 업무 API, 실제 Claude급 모델)이고 TOI-lite는 로컬 단일 사용자 mock이다. 이 차이가 결론에 주는 영향을 정리한다(검증하지 못한 것 목록).
5. **격차 점수와 우선순위**
   - 영역별로 동등 비율 또는 점수를 매긴다. 점수 계산식을 명시한다.
   - "토스 수준에 가려면 필요한 것" 우선순위 목록(작업량 S/M/L, 필요 전제)을 만든다. `docs/FOLLOWUPS.md`와 중복되는 항목은 연결한다.
6. **확인 불가 항목**: 토스가 공개하지 않아 비교할 수 없는 항목을 따로 모은다. 추정은 추정으로 표기한다.

## Constraints
- 소스·설정·계약 수정 금지. 작성 가능: `docs/compare/**`(측정 스크립트는 `docs/compare/bench/`). git commit·push 금지.
- 토스 자료는 요약하고, 인용은 짧게(한 문장 이내) 출처와 함께만 쓴다. 자막·글 원문을 저장소에 넣지 않는다.
- 서비스는 재시작해도 되지만 코드 변경은 안 된다. 측정 중 E2E 동시 실행 금지.
- 비밀값 원문을 문서에 남기지 않는다.

## Ownership
- 편집 가능: `docs/compare/**`, 스크래치패드 `cmp1/`

## Observable acceptance
- `docs/compare/TOSS-GAP.md`에 1~6절, 기능 대응표(항목별 출처·근거), 성능 표(원시 3회·중앙값·조건), 격차 점수와 우선순위.
- `docs/compare/bench/`에 재측정 스크립트와 결과 JSON.
