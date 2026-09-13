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
  /** 프록시 대상 upstream. 브라우저에 노출하지 않는다. 예: "http://localhost:7300" */
  upstreamBaseUrl: string;
  /** OpenAPI 3.1 문서 */
  openapi: Record<string, unknown>;
  policy: ApiPolicy;
  schemaVersion: number;
}

/** 에이전트·스튜디오에 보여 주는 형태. upstreamBaseUrl은 빠진다. */
export type PublicApi = Omit<RegisteredApi, "upstreamBaseUrl">;

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
  ts: string;
  user: string;
  projectId: string;
  apiId: string;
  method: string;
  path: string;
  status: number;
  reason?: string;
  capability: { mode: "read" | "write"; env: "preview" | "live"; jti: string };
  maskedFields: string[];
  decision: "allowed" | "denied";
  denyReason?: string;
}

/**
 * HTTP API (services/policy-proxy, 포트 7200)
 *
 * 인증: Authorization: Bearer <dev session JWT> (sub, roles). 로컬 개발용 발급: POST /dev/session {user, roles}
 *
 * POST /apis                         body: RegisteredApi  → 201   (roles에 "platform-admin" 필요)
 * GET  /apis                         → PublicApi[]
 * GET  /apis/:apiId                  → PublicApi
 * POST /capabilities                 body: CapabilityRequest → { token, claims }  (write는 roles에 "editor" 필요)
 * ANY  /proxy/:apiId/*               헤더: Authorization, X-Toi-Project, X-Toi-Capability, [X-Toi-Reason]
 *   판정 순서: 세션 → API 존재 → 역할 → capability(서명·만료·project 일치) → 메서드(쓰기는 mode=write·apiIds 포함·allowWrite)
 *              → requireReason → upstream 호출 → JSON 응답 마스킹 → 감사 기록(허용·거부 모두)
 * GET  /audit?projectId=&limit=      → AuditRecord[]
 * GET  /healthz
 *
 * 규칙
 * - 쓰기 권한은 요청마다 서버가 판정한다. 클라이언트 플래그를 믿지 않는다.
 * - upstream 자격증명·주소는 응답에 넣지 않는다.
 * - CORS는 프리뷰 origin(5174)과 스튜디오 origin(5173)만 허용한다.
 */
export const POLICY_PROXY_PORT = 7200;
export const MOCK_BACKEND_PORT = 7300;
