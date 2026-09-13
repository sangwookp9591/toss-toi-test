# 정책 프록시와 API 레지스트리

포트 7200. Keycloak 액세스 토큰을 `jose@6.1.3`의 JWKS RS256 검증으로 확인한다. issuer는 `http://localhost:8080/realms/toi`, audience는 `toi-api`이며 서명·만료·필수 클레임을 검사한다. `/dev/session`은 제거되어 항상 404다.

## 실행과 로그인

저장소 루트에서 `node scripts/dev-up.mjs`를 실행하고 [스튜디오](http://localhost:5173)에 로그인한다. 사용자 alice/bob/carol/dana/root의 비밀번호는 무작위 생성된 루트 `.env`의 `TOI_PASSWORD_ALICE` 등에서 확인한다. realm import에는 비밀번호와 client secret을 넣지 않는다. dev-up은 Keycloak admin API로 비밀번호·서비스 client secret을 설정하고 파일 권한을 0600으로 제한한다.

```sh
npm --prefix services/policy-proxy run typecheck
npm --prefix services/policy-proxy test
node scripts/dev-up.mjs --check
```

Keycloak 그룹은 alice/bob `/team-a`, carol `/team-b`, dana `/risk`, root `/platform`이다. 조직 역할은 builder(alice/bob/carol), api-owner(dana), platform-admin(root)이다. 조직 역할은 프로젝트 멤버십을 자동 부여하지 않는다. API 등록은 platform-admin만, customers live 쓰기 승인은 등록된 `owners`에 포함된 dana만 가능하다.

## 프로젝트 권한

| 프로젝트 역할 | 허용 동작 |
|---|---|
| viewer | 프로젝트 열기, preview read, 자기 감사 기록 조회 |
| editor | viewer + 생성·답변·취소·소스 저장, preview write |
| owner | editor + 멤버 관리, live capability·쓰기 승인 요청, 프로젝트 감사 조회 |

비멤버는 프로젝트 존재를 노출하지 않도록 404를 받는다. 모든 capability 발급 및 proxy 요청에서 agent-server `/internal/projects/:id/membership`을 조회한다. 캐시가 없으므로 멤버 제거·강등은 다음 요청에 적용된다. 내부 조회에는 `toi-policy-proxy` client credentials 토큰을 쓰고, 장애 시 요청을 거부한다. 계정 비활성화 시 Keycloak 갱신이 실패하며 이미 발급된 액세스 토큰은 최대 5분 후 만료된다. 프리뷰 세션·capability도 원본 액세스 토큰 만료를 넘을 수 없다.

## HTTP

- `GET /apis`, `GET /apis/:apiId`: 사용자 또는 `toi-agent-server` 서비스 계정. 공개 응답에는 `environments`와 OpenAPI 내부 서버·인증 정보가 없다.
- `POST /apis`: platform-admin. 환경별 upstream은 `TOI_UPSTREAM_ALLOWLIST`에 정확히 일치해야 한다.
- `POST /preview-sessions`: 정확한 스튜디오 Origin과 사용자 액세스 토큰 필요. `{projectId, write?:{apiIds,ttlSec}}`를 받아 `{sessionToken,sessionClaims,capabilityToken,capability}`를 반환한다. write는 editor 이상, 최대 120초다. 프리뷰 세션은 `aud=toi-preview`, `roles=["viewer"]`, projectId에 제한되며 `/proxy/*`에서만 쓸 수 있다. Keycloak 토큰은 프리뷰에 전달하지 않는다.
- `POST /capabilities`: `{projectId,mode,env,apiIds?,ttlSec}`. preview write는 editor 이상, live는 owner가 필요하다. live write는 현재 유효한 승인이 추가로 필요하다.
- `POST /approvals`: owner가 `{projectId,apiId,scope:"live-write",justification}`로 요청한다. 사유는 5~500자다.
- `POST /approvals/:id/decision`: `{decision:"approved"|"rejected"}`. 요청자 본인의 승인은 금지한다. 해당 API `owners`에 속하며 realm role api-owner를 가진 다른 사용자만 결정한다. 요청자도 여전히 프로젝트 owner여야 한다.
- `GET /approvals?projectId=`: 프로젝트 멤버 또는 해당 API 승인자. 승인자는 자신이 소유한 API 승인만 본다.
- `ANY /proxy/:apiId/*`: Authorization, X-Toi-Project, X-Toi-Capability, 필요하면 URL 인코딩한 X-Toi-Reason을 사용한다.
- `GET /audit?projectId=&limit=`: viewer/editor는 자기 기록, owner는 프로젝트 기록, platform-admin은 전체 기록.
- `GET /healthz`.

승인은 기본 300초 동안 유효하며 만료 후 발급과 기존 live write capability 사용이 모두 거부된다. 승인 상태는 `data/approvals.json`에 원자적으로 저장되어 재시작 후에도 유지된다. `TOI_APPROVAL_TTL_SEC`는 테스트에서 짧게 설정할 수 있고 최대 3600초다. `node scripts/dev-up.mjs --e2e`는 TTL 8초를 관리 중인 프록시에 적용하고 일반 dev-up은 기본 300초로 복원한다. 승인 후 API 소유자 제거와 프로젝트 역할 변경도 요청마다 다시 확인한다.

## preview/live 분리와 기존 보안 경계

등록 API는 `environments.preview.upstreamBaseUrl`과 `environments.live.upstreamBaseUrl`, `owners`를 보관한다. customers seed는 각각 `http://localhost:7300/preview`, `http://localhost:7300/live`를 사용한다. 프록시는 서명된 capability.env로만 upstream과 서비스 토큰을 선택한다. preview 토큰은 live에서 401이고, 프리뷰 세션과 live capability를 조합해도 403이다. 목록 응답의 `dataset` 표식으로 데이터 경계를 검증할 수 있다.

판정 순서는 인증 → 멤버십 → API 존재 → capability 검증 → 환경 → 역할·메서드 → 조회 사유 → 정규화한 등록 경로 → upstream → 마스킹 → 감사다. Origin은 서버에서 검사하며 프로젝트별 `previewOriginForProject(projectId)` Origin만 프리뷰로 인정하고 `/proxy/*`만 허용한다. CORS preflight도 같은 경계를 따른다. 경로 중첩 인코딩·dot segment·구분자·등록되지 않은 메서드와 redirect는 거부한다. 내부 주소·서비스 토큰·서명 키는 응답·감사에서 제거한다. 이름·전화·이메일·주민번호·계좌 마스킹, 등록되지 않은 PII 탐지와 스키마 드리프트 경고를 유지한다.

감사는 프로세스 내 직렬 append-only JSONL·fdatasync·해시 체인·MinIO 불변 세그먼트 복제로 기록하고 append 실패 시 성공 응답을 보내지 않는다. 암호화 다운로드와 복구 절차는 아래 P0-3 절을 따른다. 이미 완료된 upstream 변경을 감사 저장 실패가 되돌리지는 못한다. 기존 익명 프로젝트는 자동으로 임의 사용자에게 귀속시키지 않으며, 로그인 후 새 프로젝트를 만든다.

## 설정과 검증

루트 `.env`: `TOI_SESSION_SECRET`, `TOI_CAPABILITY_SECRET`, `TOI_PREVIEW_SERVICE_TOKEN`, `TOI_LIVE_SERVICE_TOKEN`, `TOI_POLICY_CLIENT_SECRET`, `TOI_IDENTITY_ISSUER`, `TOI_SUB_DANA`. 키와 환경 토큰은 서로 다른 무작위 값이다. `TOI_AGENT_URL`은 멤버십 원천 주소다. Keycloak 운영 배포에는 TLS·외부 DB·IdP 연동과 별도 네트워크 경계가 필요하다.

단위·통합 테스트는 실제 RS256 키와 HTTP JWKS fixture, 서비스 계정 인증을 사용하는 멤버십 HTTP 원천, 실제 mock upstream을 사용한다. 잘못된 issuer/audience/서명/만료, 비멤버·강등·제거, 4-eyes·중복 결정·만료, preview/live 데이터·토큰 경계와 기존 Origin·경로·마스킹 테스트를 포함한다. 실제 Keycloak UI 로그인과 A~S 반복 검증은 `e2e/`가 담당한다. `bench/`의 기존 수치는 P0 이전 기록이며 새 인증 흐름의 측정치가 아니다.

## P0-3 암호화 다운로드

스튜디오의 **암호화 다운로드**에서 등록 API·GET 경로·CSV/XLSX·5자 이상 사유를 선택한다. `POST /downloads`는 정확한 스튜디오 Origin, Keycloak 사용자, 현재 editor 이상 멤버십, `X-Toi-Project`와 body 프로젝트 일치, 해당 사용자·프로젝트의 **read** capability가 필요하다. 프리뷰 Origin과 프리뷰 세션은 다운로드를 생성할 수 없다. API 판정·환경 upstream 선택·등록 경로 정규화·마스킹·잔여 PII 검사는 `/proxy`와 같은 함수로 실행한다. 배열 또는 `{items: [...]}`를 표로 내보내며 객체 하나는 한 행, 최대 10000행이다. CSV는 인용·줄바꿈을 이스케이프하고 공백 뒤를 포함해 `= + - @`로 시작하는 셀을 작은따옴표로 무력화한다. XLSX는 `exceljs@4.4.0`을 사용하고 셀을 수식 객체가 아닌 문자열로 쓴다.

POST 처리 중 파일과 ZIP을 메모리에서만 만든다. `@zip.js/zip.js@2.14.1`의 AES-256 WinZip AE-2 ZIP을 먼저 생성한 다음, 파일마다 새 256비트 데이터 키와 96비트 nonce를 사용해 AES-256-GCM으로 봉투 암호화한다. 데이터 키도 KEK로 AES-256-GCM 래핑하며 다른 nonce와 AAD를 쓴다. downloadId를 AAD에 묶어 파일/키 바꿔치기를 탐지한다. 암호문은 `toi-downloads/downloads/<downloadId>.bin`, 계약 메타데이터는 `data/downloads/<downloadId>.json`에 저장한다. 메타데이터에는 scrypt salt/hash만 있고 ZIP 비밀번호는 없다. 이 순서는 GET에서 비밀번호를 복구할 필요 없이 해시만 보관하기 위한 설계다. 평문 파일·데이터 키·ZIP 비밀번호를 디스크 임시 파일에 쓰지 않는다. 사용한 파일·ZIP·데이터 키 Buffer는 완료 시 덮어쓴다; JavaScript 문자열과 라이브러리 내부 메모리의 물리적 삭제까지 보장하지는 않는다.

응답은 계약 `DownloadTicket`이며 32자 무작위 ZIP 비밀번호를 한 번만 포함한다. URL은 상대 경로이며 `exp`와 `sig`만 갖는다. HMAC-SHA256은 `[downloadId, requestedBy, exp]`를 서명한다. GET은 Keycloak sub 일치(다르면 404), 서명(불일치 403), 최대 60초 만료·보존기한·미사용 상태(410)를 검사한다. 동시에 온 요청도 직렬 예약하고 fetchCount를 디스크에 동기화한 후 ZIP을 스트리밍하므로 한 요청만 성공한다. 전송 실패·프로세스 중단 뒤에도 예약은 재사용되지 않는다. 브라우저는 Bearer 인증으로 ZIP Blob을 받아 저장하며 비밀번호는 storage·URL에 넣지 않고 패널을 닫거나 프로젝트를 바꾸면 제거한다.

첫 전달 성공 후 암호문과 wrappedDataKey를 삭제한다. 1초 주기의 정리 작업은 전달 예약이 끝난 객체 및 retainUntil(기본 24시간)을 지난 객체를 삭제하며 실패는 다음 주기에 재시도한다. 시작 시에도 정리한다. 업로드 전 메타데이터를 동기화하므로 업로드 중단/실패 객체도 보존기한 정리 대상이 된다. 조회 URL 만료와 저장 보존기한은 서로 다르며, 60초가 지난 객체는 새 URL을 발급하지 않고 retainUntil까지 봉투 암호화 상태로만 남는다.

### 키와 객체 저장소 설정

모든 키는 환경 변수에서만 읽고 기본 키를 만들지 않는다. dev-up이 무작위 생성하며 `TOI_MANAGED_ENV=1`로 실행한 정책 서비스는 루트 `.env`를 다시 읽지 않는다. 아래 이름은 P0C와 합의했다.

| 설정 | 값/역할 |
|---|---|
| `TOI_DOWNLOAD_KEK` | 무작위 32바이트, 64자리 hex |
| `TOI_DOWNLOAD_KEK_ID` | 회전 식별자, 예 `dev-v1` |
| `TOI_DOWNLOAD_URL_SECRET` | KEK와 다른 무작위 32바이트, 64자리 hex |
| `TOI_DOWNLOAD_BUCKET` / `TOI_AUDIT_BUCKET` | `toi-downloads` / `toi-audit` |
| `MINIO_ENDPOINT` | 로컬 `http://localhost:9000` |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | 정책 자식 프로세스에서는 전용 사용자 값; dev-up이 `TOI_POLICY_MINIO_USER/PASSWORD`를 이 이름에 매핑 |
| `TOI_DOWNLOAD_RETAIN_MS` | 선택, 기본/최대 86400000ms |

SDK는 `@aws-sdk/client-s3@3.1131.0`으로 고정한다. 정책 사용자는 위 두 버킷만 접근하고 감사 버킷 삭제 권한은 없다. 감사 버킷은 object lock, 다운로드 버킷은 삭제 가능한 비버전 저장소여야 한다. URL 서명 키 회전은 기존 URL을 무효화한다. KEK 회전은 새 다운로드 생성을 중단하고 기존 보존분을 소진·삭제한 뒤 새 KEK와 새 kekId를 함께 설정해 재기동한다. 단일 활성 KEK만 지원하므로 이전 kekId 객체는 503 `DOWNLOAD_KEY_UNAVAILABLE`로 닫히며 삭제 작업은 키 없이 계속 가능하다. 운영에서는 KMS의 키 버전별 unwrap/rewrap와 접근 감사·권한 분리를 구현해야 한다.

## P0-3 감사 체인·복제·복구

`audit.jsonl`은 단일 프로세스 직렬 큐로 기록하고 레코드마다 append 후 fdatasync를 완료한 뒤 응답한다. seq는 1부터 연속, 첫 prevHash는 64자리 0이며 hash는 hash 필드를 제외한 재귀 키 정렬 canonical JSON의 SHA-256이다. proxy·capability·preview-session·approval·download-create·download-fetch·membership-denied를 기록한다. 다운로드 서명 query와 ZIP 비밀번호는 감사에 넣지 않는다. 기존 해시 없는 파일은 `audit.legacy.<sha256>.jsonl`로 보존하고 새 체인의 첫 MIGRATE 레코드 `legacySha256`으로 연결한다. legacy 파일도 시작/검증 시 hash를 확인한다.

기본 1000건 또는 5분마다 `audit/segments/<firstSeq>-<lastSeq>-<lastHash>.jsonl`을 MinIO로 복제한다. `If-None-Match: *` 조건부 생성으로 기존 키를 덮어쓰지 않는다. 이미 존재하는 키는 바이트가 같은 경우에만 재시도 성공으로 인정한다. 로컬 `audit-segments.json`은 이미 복제한 세그먼트를 기억하므로 원격 삭제도 탐지한다. 복제 실패는 최대 10초마다 재시도하며 `/healthz`의 `audit.replicationPending`, `replicationLagMs`, `replicationAvailable`로 상태를 보고한다. 저장소 통신 장애는 요청을 계속 처리하지만 체인·복제본 불일치는 계속 처리하지 않는다.

시작 시와 platform-admin의 `GET /audit/verify`에서 로컬 seq/hash/prevHash·legacy·모든 원격 세그먼트·로컬 복제 목록의 일치를 확인한다. 처음 발견한 brokenAt을 고정하고 `/healthz`를 제외한 모든 경로(OPTIONS 포함)를 503 `AUDIT_CHAIN_BROKEN`으로 거부한다. 감지 호출은 `{ok:false, brokenAt, ...}`를 반환하며 이후 오류와 health에서도 위치를 확인할 수 있다. append/fsync 실패도 서비스가 성공 응답을 내지 못하도록 체인을 닫는다. 이미 upstream에 전달된 쓰기 자체를 되돌리지는 못한다.

복구 시 서비스의 쓰기를 중단하고 손상된 로컬 디렉터리를 증거로 보존한다. 별도 신뢰 경로로 WORM 세그먼트의 키·바이트·연속 범위·hash를 검증한 뒤 원래 순서대로 로컬 체인을 복원한다. 마지막 복제 이후 tail은 별도 검증된 백업에서만 복구한다; 불확실한 행 삭제, seq 재번호, hash 재계산으로 검증을 우회하지 않는다. 원격/로컬 파일을 수정해 서비스가 자동으로 체인을 다시 신뢰하게 하지 않으며, 승인된 복구 후 재기동·관리자 verify로 정상 상태를 확인한다.

운영에서는 독립 자격증명과 보존기간이 강제되는 WORM/object-lock compliance 저장소, 감사 체크포인트의 별도 신뢰 앵커, 영속 데이터 볼륨과 백업, 디렉터리 메타데이터 내구성, 복제 지연 알림, TLS, KMS, 용량/동시 작업 상한을 갖춰야 한다. 이 구현은 단일 policy-proxy 프로세스가 한 데이터 디렉터리를 소유한다. 여러 프로세스가 같은 파일을 쓰는 운영 구성은 분산 순번/저널 저장소 없이 지원하지 않는다. 로컬 tail과 원격 저장소·관리자 권한을 모두 탈취한 공격까지 hash 체인만으로 증명할 수는 없다.

검증은 `test/downloads.test.ts`, `test/audit.test.ts`와 기존 정책 테스트를 포함한다. 로컬 한 줄 변조·원격 불일치·삭제·truncation fail-closed 테스트는 모두 임시 디렉터리와 격리 HTTP 인스턴스에서 실행해 공용 서비스를 손상시키지 않는다. 실제 Keycloak·MinIO·브라우저 T–W는 `e2e/tests/downloads.spec.ts`가 담당한다.

라이브러리/프로토콜 근거: [zip.js AE-2와 AES](https://gildas-lormeau.github.io/zip.js/), [ZIP 암호화 옵션](https://gildas-lormeau.github.io/zip.js/api/interfaces/ZipWriterAddDataOptions.html), [S3 조건부 생성](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).
