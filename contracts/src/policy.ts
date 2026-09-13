// 정책 프록시 + API 레지스트리 계약. services/policy-proxy가 구현한다.

export type MaskKind = "none" | "name" | "phone" | "email" | "rrn" | "account";

export interface ApiPolicy {
  /** JSON 응답 필드 마스킹. 키는 JSON Pointer 패턴("*"는 배열 인덱스 와일드카드). 예: "/items/*\/phone" */
  mask: Record<string, MaskKind>;
  /** true면 조회에 X-Toi-Reason 헤더(5자 이상)가 필요하다 */
  requireReason: boolean;
  /** 이 API를 호출할 수 있는 역할 */
  allowedRoles: string[];
  /** 쓰기 메서드(POST/PUT/PATCH/DELETE) 허용 여부. true여도 write capability가 필요하다 */
  allowWrite: boolean;
}

export interface RegisteredApi {
  /** 예: "customers" */
  apiId: string;
  name: string;
  description: string;
  /**
   * 환경별 upstream. 브라우저에 노출하지 않는다.
   * preview capability는 preview upstream(합성·샌드박스 데이터)만, live capability는 live upstream만 호출한다.
   * 예: { preview: { upstreamBaseUrl: "http://localhost:7300/preview" }, live: { upstreamBaseUrl: "http://localhost:7300/live" } }
   */
  environments: Record<"preview" | "live", { upstreamBaseUrl: string }>;
  /** 이 API의 소유 조직 사용자(Keycloak sub). live 쓰기 승인 권한자 */
  owners: string[];
  /** OpenAPI 3.1 문서 */
  openapi: Record<string, unknown>;
  policy: ApiPolicy;
  schemaVersion: number;
}

/** 에이전트·스튜디오에 보여 주는 형태. environments(upstream 주소)는 빠진다. */
export type PublicApi = Omit<RegisteredApi, "environments">;

export interface CapabilityRequest {
  projectId: string;
  mode: "read" | "write";
  env: "preview" | "live";
  /** write면 허용 apiId 목록이 필요하다 */
  apiIds?: string[];
  ttlSec: number;
}

export interface CapabilityClaims extends CapabilityRequest {
  sub: string;
  exp: number;
  jti: string;
}

export interface AuditRecord {
  /** 감사 로그 내 순번(1부터, 빈틈 없음) */
  seq: number;
  /** 직전 레코드의 hash. 첫 레코드는 64자리 0 */
  prevHash: string;
  /** sha256(canonicalJson(이 레코드에서 hash 필드를 뺀 값)) */
  hash: string;
  ts: string;
  /** 요청 종류 */
  action: "proxy" | "capability" | "preview-session" | "approval" | "download-create" | "download-fetch" | "membership-denied";
  user: string;
  projectId: string;
  apiId: string;
  method: string;
  path: string;
  status: number;
  reason?: string;
  capability?: { mode: "read" | "write"; env: "preview" | "live"; jti: string };
  maskedFields: string[];
  decision: "allowed" | "denied";
  denyReason?: string;
}

/** P0-3 다운로드. 서버 보관은 봉투 암호화, 전달은 AES-256 ZIP + 1회 표시 비밀번호 */
export type DownloadFormat = "csv" | "xlsx";
export interface DownloadRequest {
  projectId: string;
  apiId: string;
  /** 등록 API의 GET 경로. 예: "/customers?size=200" */
  path: string;
  format: DownloadFormat;
  /** 5자 이상. requireReason과 무관하게 다운로드는 항상 필요 */
  reason: string;
}
export interface DownloadTicket {
  downloadId: string;
  /** ZIP 비밀번호. 이 응답에서 한 번만 제공하고 서버는 해시만 보관한다 */
  zipPassword: string;
  /** 단기 서명 URL(최대 60초, 1회 사용). 경로와 만료·서명만 담고 비밀은 담지 않는다 */
  url: string;
  expiresAt: string;
  rowCount: number;
  /** 서버 보관 만료(ISO). 지나면 암호문과 데이터 키를 삭제한다 */
  retainUntil: string;
}
/** 서버 보관 형식(객체 저장소). 데이터는 파일마다 새 256비트 데이터 키로 AES-256-GCM, 데이터 키는 KEK로 감싼다 */
export interface EncryptedDownloadRecord {
  downloadId: string;
  projectId: string;
  apiId: string;
  requestedBy: string;
  format: DownloadFormat;
  createdAt: string;
  retainUntil: string;
  kekId: string;
  wrappedDataKey: string;
  iv: string;
  authTag: string;
  ciphertextSha256: string;
  /** scrypt 해시. 평문 비밀번호는 보관하지 않는다 */
  zipPasswordHash: string;
  maskedFields: string[];
  fetchCount: number;
}

/**
 * HTTP API (services/policy-proxy, 포트 7200)
 *
 * 인증(P0-1, contracts/src/auth.ts): 사용자 요청은 Keycloak 액세스 토큰, 프리뷰는 policy-proxy가 발급한 프리뷰 세션.
 *   dev session 발급은 제거한다.
 *
 * POST /apis                         body: RegisteredApi  → 201   (realm role platform-admin)
 * GET  /apis                         → PublicApi[]
 * GET  /apis/:apiId                  → PublicApi
 * POST /preview-sessions             contracts/src/auth.ts
 * POST /approvals, /approvals/:id/decision, GET /approvals   contracts/src/auth.ts
 * POST /capabilities                 body: CapabilityRequest → { token, claims }  (프로젝트 역할표, live는 승인 필요)
 * ANY  /proxy/:apiId/*               헤더: Authorization, X-Toi-Project, X-Toi-Capability, [X-Toi-Reason]
 *   판정 순서: 인증 → 멤버십 → API 존재 → capability(서명·만료·sub·project 일치) → 환경(capability.env의 upstream만)
 *              → 메서드(쓰기는 mode=write·apiIds 포함·allowWrite) → requireReason → upstream → 마스킹 → 감사
 * POST /downloads                    body: DownloadRequest → DownloadTicket  (editor 이상, read capability 필요, 프리뷰 origin 거부)
 * GET  /downloads/:id?exp=&sig=      → application/zip (AES-256, 비밀번호는 ticket의 zipPassword). 1회 사용, 만료·서명 검증
 * GET  /audit?projectId=&limit=      → AuditRecord[]  (자기 기록 또는 project owner·platform-admin)
 * GET  /audit/verify                 → { ok, lastSeq, lastHash, brokenAt? }  (platform-admin)
 * GET  /healthz
 *
 * 규칙
 * - 쓰기 권한은 요청마다 서버가 판정한다. 클라이언트 플래그를 믿지 않는다.
 * - upstream 자격증명·주소, 데이터 키·KEK·ZIP 비밀번호는 로그·감사·오류 응답에 넣지 않는다.
 * - 감사 로그는 해시 체인 append-only, 레코드마다 fsync. 세그먼트는 객체 저장소에 불변 키로 복제한다.
 *   체인 검증 실패 시 서비스는 새 요청을 거부(fail-closed)하고 /healthz에 degraded를 보고한다.
 * - CORS는 스튜디오 origin과 프리뷰 origin만 허용하고, 프리뷰 origin은 /proxy/*만 허용한다.
 *   P0-2: 프리뷰 origin은 previewOriginForProject(projectId) 형식만 인정하고, 그 projectId가
 *   X-Toi-Project·프리뷰 세션 projectId·capability projectId와 모두 같아야 한다. 다르면 403 PREVIEW_ORIGIN_MISMATCH.
 *   R3-M2 이후: frame은 policy-proxy에 직접 요청하지 않는다(브로커가 스튜디오 origin에서 요청). 프리뷰 origin 요청은
 *   경로와 무관하게 403 PREVIEW_DIRECT_FORBIDDEN이며 CORS 헤더를 내지 않는다. 프리뷰 세션 토큰은 계속 aud toi-preview·viewer로 제한한다.
 * - P0-3 다운로드
 *   - 대상은 등록 API의 GET 경로만, 행 최대 10000. 데이터는 /proxy와 같은 마스킹·잔여 PII 검사를 거친다.
 *   - 봉투 암호화: 파일마다 새 256비트 데이터 키 AES-256-GCM, 데이터 키는 KEK(AES-256-KW 또는 GCM)로 감싼다.
 *     KEK는 env(dev-up이 무작위 생성)에서만 읽고 kekId로 회전을 구분한다. 암호문은 객체 저장소(MinIO)에 둔다.
 *   - GET /downloads/:id는 서명(exp·downloadId·requestedBy에 대한 HMAC) + 만료 60초 + 1회 + Keycloak 토큰 sub === requestedBy를 모두 요구한다.
 *     실패는 만료·사용됨 410, 서명 불일치 403, 다른 사용자 404.
 *   - 첫 성공 전달 또는 retainUntil(기본 24시간) 중 먼저 오는 시점에 암호문과 wrappedDataKey를 삭제하고 메타데이터만 남긴다.
 *   - ZIP은 AES-256(WinZip AE-2) 암호화. ZIP 비밀번호는 24자 이상 무작위, 응답에 한 번만 담고 scrypt 해시만 보관한다.
 * - P0-3 감사
 *   - 레코드마다 hash = sha256(canonicalJson(hash 제외 레코드)), prevHash 연결, append 후 fsync(fdatasync).
 *   - 세그먼트(기본 1000건 또는 5분)를 객체 저장소에 `audit/segments/<firstSeq>-<lastSeq>-<lastHash>.jsonl`로 복제하고 기존 키는 덮어쓰지 않는다.
 *   - 시작 시와 /audit/verify에서 체인·세그먼트 일치를 검증한다. 불일치면 /healthz 외 모든 요청 503 AUDIT_CHAIN_BROKEN(fail-closed).
 *   - 복제 실패는 재시도하고 지연을 /healthz에 보고한다(요청은 계속 처리).
 *   - R3-M1 외부 앵커: 체인 head(seq·hash)를 `audit/anchors/<seq 20자리 0채움>-<hash>`로 객체 저장소에 기록한다
 *     (덮어쓰기 금지, 1초 또는 50건마다, 종료 시그널 때 즉시). download-create·download-fetch·approval 레코드는
 *     앵커 기록이 끝난 뒤 응답한다. 시작 시 가장 큰 앵커보다 로컬 체인이 짧거나 그 seq의 hash가 다르면 brokenAt(fail-closed).
 *     앵커 기록 실패가 5초를 넘으면 /healthz degraded, 30초를 넘으면 새 요청을 503 AUDIT_ANCHOR_UNAVAILABLE로 거부한다.
 *   - R3-L1: 세그먼트·앵커 객체는 ObjectLockMode COMPLIANCE와 RetainUntilDate(env TOI_AUDIT_RETENTION_DAYS, 개발 기본 1일)를 설정해 올린다.
 */
export const POLICY_PROXY_PORT = 7200;
export const MOCK_BACKEND_PORT = 7300;
