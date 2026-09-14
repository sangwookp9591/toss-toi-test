// P1-3 API 등록·선택·스키마 버전 계약. 명세: docs/tasks/W6-B1-api-registry-impl.md
// services/policy-proxy가 레지스트리·버전·영향 분석을, services/agent-server가 프로젝트 API 선택(pin)과 사용 흔적을 구현한다.
import type { ApiPolicy, MaskKind } from "./policy.ts";

/** 스키마 버전 상태. active·deprecated만 새로 pin할 수 있고, retired는 pin된 프로젝트의 /proxy 호출도 거부한다 */
export type ApiVersionStatus = "draft" | "active" | "rejected" | "deprecated" | "retired";

/** 등록 화면이 고르는 upstream 별칭. 실제 URL은 서버 설정(TOI_UPSTREAM_TARGETS)에만 있고 브라우저·에이전트에 노출하지 않는다 */
export interface UpstreamTarget {
  upstreamId: string;
  label: string;
}

export type SchemaChangeSeverity = "breaking" | "caution" | "safe";

export interface SchemaChange {
  severity: SchemaChangeSeverity;
  /** 예: "operation-removed", "response-property-removed", "mask-weakened" */
  rule: string;
  /** "GET /employees/{id}" 형식. 정책 변경이면 "policy" */
  operation: string;
  /** 응답·요청 필드의 JSON Pointer 패턴(마스킹 규칙과 같은 형식). 예: "/items/*\/department" */
  pointer?: string;
  detail: string;
}

/** 이전 active 버전 대비 새 버전 비교 결과. 서버가 계산하며 클라이언트 값은 믿지 않는다 */
export interface CompatibilityReport {
  fromVersion: number | null;
  toVersion: number;
  changes: SchemaChange[];
  breaking: boolean;
  /** 마스킹 제거·약화, requireReason 해제, allowWrite 허용, allowedRoles 확대 중 하나라도 있으면 true */
  policyLoosened: boolean;
}

export interface ApiVersion {
  apiId: string;
  /** 1부터 증가. 활성화되면 RegisteredApi.schemaVersion이 이 값이 된다 */
  version: number;
  status: ApiVersionStatus;
  /** OpenAPI 3.1 문서(servers·security 제거 후 보관) */
  openapi: Record<string, unknown>;
  policy: ApiPolicy;
  /** sha256(canonicalJson({ openapi, policy })) */
  schemaDigest: string;
  changeSummary: string;
  submittedBy: string;
  submittedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  compatibility: CompatibilityReport;
}

/** POST /apis/:apiId/versions 본문. 새 API 등록이면 name·description·upstreamId·owners를 함께 보낸다 */
export interface ApiVersionSubmission {
  apiId: string;
  openapi: Record<string, unknown>;
  policy: ApiPolicy;
  changeSummary: string;
  name?: string;
  description?: string;
  upstreamId?: string;
  owners?: string[];
}

export interface ApiVersionDecision {
  decision: "approved" | "rejected";
  comment?: string;
}

/** 스키마에서 찾은 개인정보 후보. x-toi-pii 확장 또는 필드 이름 규칙으로 찾는다 */
export interface PiiFieldHint {
  operation: string;
  pointer: string;
  suggested: MaskKind;
  source: "x-toi-pii" | "field-name";
  /** policy.mask에 이 pointer를 덮는 규칙이 있는지 */
  covered: boolean;
}

/** 프로젝트가 고정한 API 버전 */
export interface ProjectApiBinding {
  apiId: string;
  version: number;
  pinnedAt: string;
  pinnedBy: string;
}

/** PUT /projects/:projectId/apis 본문. 최대 5개, apiId 중복 금지 */
export interface ProjectApiSelection {
  apis: Array<{ apiId: string; version: number }>;
}

/** GET /internal/projects/:id/api-context 응답(policy-proxy 전용). /proxy·capability 판정에 쓴다 */
export interface InternalProjectContext {
  projectId: string;
  apiBindings: ProjectApiBinding[];
}

export interface ApiOperationUsage {
  method: string;
  /** OpenAPI path 패턴. 예: "/employees/{id}" */
  path: string;
  /** static: 프로젝트 소스의 toiFetch·/proxy 호출 분석, audit: 최근 30일 허용된 proxy 감사 기록 */
  source: "static" | "audit";
}

export interface ApiFieldUsage {
  operation: string;
  pointer: string;
  /** static-match: 사용 operation 응답 스키마의 필드 이름이 소스에 등장. name-only: 이름만 일치 */
  confidence: "static-match" | "name-only";
}

/** agent-server가 revision 저장마다 계산해 보관하는 사용 흔적 */
export interface ProjectApiUsage {
  projectId: string;
  apiId: string;
  version: number;
  revision: number;
  operations: ApiOperationUsage[];
  fields: ApiFieldUsage[];
  /** 호출을 문자열 리터럴로 특정하지 못한 경우 true. 영향 분석은 모든 operation을 쓰는 것으로 본다 */
  dynamicCalls: boolean;
  computedAt: string;
}

export type ProjectImpactLevel = "breaking" | "unknown" | "safe";

export interface ProjectImpact {
  projectId: string;
  projectName: string;
  teamId: string;
  ownerUsernames: string[];
  pinnedVersion: number;
  level: ProjectImpactLevel;
  /** 이 프로젝트가 쓰는 곳에 닿는 변경만 */
  changes: SchemaChange[];
}

/** GET /apis/:apiId/versions/:version/impact (API owner·platform-admin). 소스 코드는 담지 않는다 */
export interface ImpactReport {
  apiId: string;
  toVersion: number;
  compatibility: CompatibilityReport;
  projects: ProjectImpact[];
  computedAt: string;
}

/**
 * HTTP API 추가분 (P1-3)
 *
 * services/policy-proxy
 *   GET  /upstream-targets                        → UpstreamTarget[]   (api-owner·platform-admin)
 *   GET  /apis?query=                             → PublicApi[]  (최신 active. query는 apiId·name·description 부분 일치)
 *   GET  /apis/:apiId/versions                    → ApiVersion[] (active·deprecated·retired는 인증 사용자, draft·rejected는 API owner·platform-admin)
 *   GET  /apis/:apiId/versions/:version           → ApiVersion   (위와 같은 가시성. 서비스 client toi-agent-server 허용)
 *   POST /apis/:apiId/versions   body ApiVersionSubmission → 201 ApiVersion(draft)
 *        새 apiId: api-owner(자신이 owners에 포함)·platform-admin. 기존 apiId: 그 API owner·platform-admin.
 *   POST /apis/:apiId/versions/lint body ApiVersionSubmission → { compatibility, piiHints }  (저장하지 않음, 같은 권한)
 *   POST /apis/:apiId/versions/:version/decision body ApiVersionDecision → ApiVersion
 *        platform-admin, 제출자 본인 금지(FOUR_EYES_REQUIRED). 승인 시 이전 active는 deprecated.
 *   POST /apis/:apiId/versions/:version/retire    → ApiVersion  (API owner·platform-admin, pin한 프로젝트가 있으면 409 VERSION_IN_USE)
 *   GET  /apis/:apiId/versions/:version/impact    → ImpactReport (API owner·platform-admin)
 *   POST /internal/audit/project-apis             (client toi-agent-server 서비스 토큰만) 선택 변경 감사 기록
 *   POST /apis (기존)                             platform-admin 전용 호환 경로. 내부적으로 버전을 만들고 즉시 active
 *
 * services/agent-server
 *   POST /projects                  body { name, apiIds } (기존) → 각 apiId의 최신 active 버전으로 pin
 *   GET  /projects/:id/apis         → ProjectApiBinding[] (멤버)
 *   PUT  /projects/:id/apis         body ProjectApiSelection → Project (owner. 레지스트리 확인·감사 성공 후에만 저장)
 *   GET  /internal/projects/:id/api-context → InternalProjectContext (client toi-policy-proxy)
 *   GET  /internal/api-usage?apiId= → ProjectApiUsage[] (client toi-policy-proxy)
 */
