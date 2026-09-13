# R3: P0 독립 보안 리뷰 (P0-1·P0-2·P0-3·P0-4)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`, 브랜치 `main`
- 대상 범위: `6b9ea24`(P0 설계·계약)부터 HEAD까지. 구현 커밋:
  - P0-1 `788c742`
  - P0-4 `d65e7fd`
  - P0-2·P0-3 2차 커밋(HEAD)
- 서비스는 떠 있다(`node scripts/dev-up.mjs --e2e`로 기동). 포트:
  - Keycloak 8080, Verdaccio 4873, MinIO 9000
  - deps 7100, policy 7200, mock 7300, agent 7400
  - studio 5173, preview `p-<uuid>.preview.localhost:5174`
- 테스트 계정 비밀번호와 서비스 비밀값은 루트 `.env`(0600)에 있다. 값을 출력·문서에 남기지 말고 길이·일치 여부만 기록한다.
- 반드시 읽을 것:
  - `docs/P0-DESIGN.md`, `contracts/src/{auth,policy,runtime,generation}.ts`
  - `docs/review/REVIEW.md`·`REVIEW-R2.md`(이전 형식과 판정 기준)
  - 구현 보고서: `services/policy-proxy/bench/P0A-REPORT.md`, `services/policy-proxy/bench/P0B-REPORT.md`, `e2e/P0A2-REPORT.md`, `e2e/P0A2-K-FIX.md`, `e2e/P0C-REPORT.md`
  - `evals/README.md`
  - 구현자 보고서와 테스트 통과는 판정 근거가 아니다.

## Change
직접 공격·우회를 시도해 판정한다. 코드·설정·계약은 수정하지 않는다. 산출물은 `docs/review/REVIEW-R3.md`와 `docs/review/repro/r3/`뿐이다.

1. **식별·권한(P0-1)**
   - JWT 검증: `alg=none`·HS256 혼동, 다른 realm·client 토큰, aud·iss·exp·nbf, `kid` 조작, JWKS 캐시 오염.
   - 서비스 토큰 오용: `toi-agent-server` 토큰으로 사용자 API 호출, `azp` 조작.
   - 멤버십: 비멤버 존재 노출(404와 403 차이·타이밍), 마지막 owner 보호 경합, 역할 변경 후 5초 캐시 경계.
   - 승인(4-eyes): 본인 승인, 같은 사람의 다른 계정, 승인 재사용·만료 경계, 다른 API·프로젝트 승인 전용.
   - 프리뷰 하향 세션으로 스튜디오 전용 API 호출, capability의 sub·projectId 교차 사용.
   - preview/live 분리: 경로 인코딩·쿼리로 live upstream 도달, preview capability로 live 데이터.
   - 스튜디오 OIDC: `prompt=none` 리다이렉트 루프, state·nonce·PKCE, 콜백 URL 잔류, 토큰 저장소 잔류, 로그아웃 후 늦은 갱신 응답.
2. **프리뷰 격리(P0-2)**
   - 실제 Chrome에서 확인한다. 생성 코드가 할 수 있는 모든 방법으로 다음을 시도한다.
     - 다른 프로젝트 프리뷰의 storage·BroadcastChannel·`window.open`·`opener`·`parent` 접근
     - 스튜디오 DOM·토큰 접근
     - 외부 전송: fetch·XHR·WebSocket·이미지·CSS·font·prefetch·`<a ping>`·form·`location`·`window.open`·DNS prefetch·WebRTC
   - CSP 헤더가 `document.open/write` 뒤에 유지되는지, nonce 재사용·유출(`document.currentScript.nonce`, DOM 속성)로 추가 스크립트를 주입할 수 있는지.
   - `data:` 모듈 허용이 CSP 우회 수단이 되는지.
   - policy-proxy `PREVIEW_ORIGIN_MISMATCH`: origin 형식 변형(대소문자, 포트 생략, IPv6, 후행 점), X-Toi-Project와 세션 불일치.
   - 5174 Host 검사: DNS rebinding 형태, 잘못된 Host, 경로 탈출. deps-builder 자산 CORS 범위.
   - AST source policy 우회는 low로 분류하되, CSP로도 막히지 않는 경로가 있으면 심각도를 올린다.
   - env allowlist: 각 서비스 프로세스 env에 불필요한 비밀값이 있는지(`ps eww` 등으로 키 이름만 확인). `TOI_MANAGED_ENV`·dotenv 경로. mock-backend 토큰 필수.
3. **다운로드·감사(P0-3)**
   - 서명 URL: 서명 대상 필드 누락, exp 조작, 재사용 경합(동시 두 요청), 다른 사용자 토큰, 프리뷰 origin 요청.
   - 암호화: 봉투 구조(데이터 키 재사용, IV 재사용, GCM 태그 검증), KEK·데이터 키·비밀번호의 로그·감사·오류·임시 파일·MinIO 노출. MinIO 객체 평문 여부.
   - ZIP이 실제 AES-256(AE-2)인지, 비밀번호 엔트로피, scrypt 파라미터.
   - CSV/XLSX 수식 주입, 마스킹 우회(다운로드 경로가 /proxy와 같은 마스킹을 타는지), 행 한도·메모리 고갈.
   - 삭제 정책: 전달 후·retainUntil 뒤 암호문·wrappedDataKey가 실제로 사라지는지.
   - 감사 체인:
     - canonicalJson 모호성, 동시 append의 seq 중복·빈틈
     - fsync 실제 호출
     - 세그먼트 복제 키 덮어쓰기와 object lock 실제 적용
     - policy 전용 MinIO 사용자 권한 범위
     - 변조·삭제·끝부분 잘라내기(truncation) 감지
     - 복제 전 로컬 변조
     - fail-closed가 모든 경로에 적용되는지
   - 변조 실험은 격리 인스턴스(임시 dataDir·임시 버킷)로만 한다.
4. **평가·드라이버(P0-4)**
   - `json-content` 파싱이 도구 검증을 우회하는지(여러 객체, 코드펜스 중첩, 유니코드).
   - 평가 하네스가 실제 비밀값을 결과 파일에 남기는지.
   - 인젝션 케이스에서 정책 계층이 실제로 막았는지.
5. **이전 발견 회귀**: R1·R2의 C1·H1·H2·M1~M3·N1~N5·L1~L7이 P0 변경으로 다시 열렸는지 확인한다.

## Constraints
- 비파괴: 새 projectId·임시 사용자 자원만 쓴다. 공유 Keycloak·MinIO 설정을 바꾸면 반드시 원래대로 복원하고 다시 읽어 확인한다.
- 서비스 재기동이 필요하면 격리 인스턴스를 띄운다(다른 포트). 공유 서비스는 재기동하지 않는다.
- git commit 금지. 비밀값 원문 기록 금지. 외부 네트워크로 데이터 전송 금지(외부 전송 시험은 로컬 수신기를 쓴다).
- 추측성 영향은 심각도를 한 단계 낮추고 `코드로만 판단`으로 표시한다.

## Ownership
- 편집 가능: `docs/review/REVIEW-R3.md`, `docs/review/repro/r3/**`

## Observable acceptance
- REVIEW-R3.md
  - 요약표: ID, 심각도, 영역, 한 줄 근거, 검증 여부
  - 발견마다 재현 절차·출력 파일·영향·권장 수정·관련 파일:줄
  - R1/R2 회귀 판정표
  - 머지 판단: critical·high 유무와 수정 전 필수 항목
- 모든 **직접 재현함** 항목에 `repro/r3/`의 실행 가능한 스크립트와 출력이 있다.
