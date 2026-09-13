# P0B: 암호화 다운로드와 변조 감지 감사 로그 (P0-3)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`. 서비스는 떠 있다(`node scripts/dev-up.mjs`).
- 반드시 읽을 것: `docs/P0-DESIGN.md`, `contracts/src/policy.ts`(`Download*`, `AuditRecord`, HTTP·P0-2·P0-3 규칙 전부), `contracts/src/auth.ts`, `docs/compare/TOSS-GAP.md` P0-3, `services/policy-proxy/README.md`, `services/policy-proxy/bench/P0A-REPORT.md`
- 병렬 워커: P0C(프리뷰 격리, `docs/tasks/P0C-preview-isolation.md`)와 P0D(로컬 모델 평가)가 같은 체크아웃에서 동시에 작업한다.

## Change
1. **다운로드** (`services/policy-proxy`)
   - `POST /downloads`: 인증, 멤버십(editor 이상), read capability, 스튜디오 origin만(프리뷰 origin 403). reason 5자 이상. 등록 API GET 경로만, 행 최대 10000.
   - upstream은 `/proxy`와 같은 판정·환경 선택·마스킹·잔여 PII 검사를 거친다(판정 코드를 복제하지 말고 공유한다).
   - CSV와 XLSX 생성. CSV는 수식 주입(`= + - @` 시작 셀) 무력화. XLSX 라이브러리는 버전 고정.
   - 봉투 암호화: 파일마다 새 데이터 키로 AES-256-GCM, 데이터 키는 KEK로 감싼다. KEK·kekId·URL 서명 키는 env에서만 읽는다(dev-up이 무작위 생성). 암호문은 MinIO 버킷에 저장하고 `EncryptedDownloadRecord` 메타데이터를 보관한다.
   - `DownloadTicket` 응답: 24자 이상 무작위 ZIP 비밀번호(한 번만, 서버는 scrypt 해시만 보관), 60초 서명 URL.
   - `GET /downloads/:id?exp=&sig=`: 서명·만료·1회 사용·Keycloak 토큰 sub === requestedBy를 모두 검사한다(410/403/404는 계약대로). 복호화 후 AES-256 ZIP(WinZip AE-2)으로 스트리밍한다. 라이브러리는 버전 고정.
   - 첫 성공 전달 또는 retainUntil(기본 24시간) 중 먼저 오는 시점에 암호문과 wrappedDataKey를 삭제한다. 만료분 정리 작업을 둔다.
   - 평문 데이터·데이터 키·KEK·ZIP 비밀번호는 로그·감사·오류·임시 파일에 남기지 않는다. 디스크 임시 파일을 쓰지 않는다.
2. **감사 로그**
   - `AuditRecord`의 `seq/prevHash/hash`를 구현한다. append 후 fsync(fdatasync). 동시 요청에서도 seq 빈틈·중복이 없어야 한다.
   - 세그먼트를 MinIO에 불변 키로 복제한다(기존 키 덮어쓰기 금지, 가능하면 버킷 object lock). 복제 실패는 재시도하고 지연을 `/healthz`에 보고한다.
   - 시작 시와 `GET /audit/verify`(platform-admin)에서 로컬 체인과 복제 세그먼트를 검증한다. 불일치면 `/healthz` 외 전부 503 `AUDIT_CHAIN_BROKEN`.
   - 기존 해시 없는 `audit.jsonl`은 legacy로 보관하고, 새 체인 첫 레코드에 legacy 파일 sha256을 남긴다.
   - 모든 action(`proxy`·`capability`·`preview-session`·`approval`·`download-create`·`download-fetch`·`membership-denied`)을 기록한다.
3. **P0-2 CORS 변경**(policy-proxy가 이 워커 소유라 여기서 구현): 프리뷰 origin은 `previewOriginForProject` 형식만, projectId가 X-Toi-Project·프리뷰 세션·capability와 모두 같아야 한다. 다르면 403 `PREVIEW_ORIGIN_MISMATCH`. 기존 5174 고정 origin 허용은 제거한다. P0C가 프리뷰 서버를 바꾸는 시점과 맞추려고 `orca orchestration send`로 P0C와 조율한다.
4. **스튜디오 다운로드 UI**: `apps/studio/src/download-panel.tsx`(신규)와 `apps/studio/src/main.tsx`의 마운트 한 곳만. 형식·사유 입력 → 비밀번호 1회 표시(복사 버튼, 닫으면 다시 볼 수 없음) → Bearer로 받은 ZIP을 저장. 비밀번호를 storage·URL·로그에 두지 않는다.
5. **E2E**: `e2e/tests/downloads.spec.ts`(신규). 기존 헬퍼는 읽기만 하고, 필요한 헬퍼 변경은 P0C에 요청한다.
   - T: alice CSV·XLSX 다운로드 → ZIP이 AES-256이고 비밀번호로만 열림 → 마스킹 필드가 가려짐 → 두 번째 GET 410 → 60초 뒤 410 → 서명 변조 403 → bob 토큰으로 GET 404
   - U: bob(viewer) POST 403, carol(비멤버) 404, 프리뷰 origin POST 403
   - V: MinIO 객체 바이트에 알려진 행 값·비밀번호가 없음, 전달 후 암호문 삭제
   - W: `GET /audit/verify` ok, 테스트 전후 seq 연속, 감사 레코드에 비밀번호·키·서명 없음
   - 변조 fail-closed(로컬 파일 한 줄 수정 → 503, verify brokenAt)는 공유 서비스를 깨므로 E2E가 아니라 policy-proxy 통합 테스트에서 격리 인스턴스로 검증한다.

## 조율
- `scripts/**`(dev-up)과 `infra/**`는 P0C 소유다. 필요한 env(KEK·kekId·URL 서명 키), MinIO 버킷·object lock 설정은 P0C에 send로 요청하고, 합의한 이름을 README에 적는다.
- 서비스 재기동은 P0C가 한다. 재기동이 필요하면 P0C에 요청한다.
- `contracts/` 변경이 필요하면 코디네이터에게 ask.

## Constraints
- 수정 금지: `contracts/`, `packages/`, `services/agent-server/**`, `services/mock-backend/**`, `services/deps-builder/**`, `apps/studio/` 중 위 두 파일 외, `e2e/` 중 `downloads.spec.ts` 외, `evals/**`, `scripts/**`, `infra/**`.
- 전역 설치 금지, git commit 금지. 비밀값을 로그·문서·스크린샷에 남기지 않는다.
- R1·R2·F3·P0-1 보안 강화(Origin, 경로 정규화, 마스킹, 멤버십, 승인)를 약화시키지 않는다.

## Ownership
- 편집 가능: `services/policy-proxy/**`, `apps/studio/src/download-panel.tsx`, `apps/studio/src/main.tsx`(마운트 한 곳), `e2e/tests/downloads.spec.ts`

## Observable acceptance
- policy-proxy typecheck·test 통과. 테스트에 포함할 것:
  - 봉투 암호화 왕복, 잘못된 KEK 실패
  - 서명·만료·1회·sub 불일치
  - CSV 수식 무력화
  - 감사 동시 append 연속성
  - 변조·세그먼트 불일치 fail-closed
  - legacy 이전
  - 프리뷰 origin 불일치 403
- P0C와 합친 뒤 `npm --prefix e2e run test:repeat`에서 기존 A~S와 T~W 전부 3회 통과.
- `services/policy-proxy/README.md`: 다운로드 흐름, 키 관리·회전, 감사 체인·복제·복구 절차, 운영에서 바꿔야 할 것(KMS·WORM 저장소).
