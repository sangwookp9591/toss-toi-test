// P0-1 식별·멤버십·승인 계약. 사내 SSO를 흉내 내는 Keycloak(OIDC)을 신뢰 원점으로 쓴다.
import type { CapabilityClaims } from "./policy.ts";

/** Keycloak realm "toi". 서비스는 JWKS로 RS256 서명·iss·aud·exp를 검증한다. */
export interface IdentityConfig {
  /** 예: "http://localhost:8080/realms/toi" */
  issuer: string;
  /** 예: "http://localhost:8080/realms/toi/protocol/openid-connect/certs" */
  jwksUri: string;
  /** 스튜디오 공개 클라이언트(Authorization Code + PKCE, client secret 없음) */
  studioClientId: "toi-studio";
  /** 서비스 API 액세스 토큰의 audience */
  apiAudience: "toi-api";
}
export const KEYCLOAK_PORT = 8080;

/** realm role. 프로젝트 권한과 별개인 조직 권한 */
export type RealmRole = "platform-admin" | "api-owner" | "builder";

/** Keycloak 액세스 토큰에서 서비스가 사용하는 클레임(검증 후) */
export interface AccessClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  preferred_username: string;
  email?: string;
  realm_access: { roles: string[] };
  /** Keycloak group path. 예: ["/team-a"] */
  groups: string[];
  /** 서비스 계정(client credentials) 토큰이면 해당 client id */
  azp: string;
}

export type ProjectRole = "owner" | "editor" | "viewer";

export interface ProjectMember {
  sub: string;
  username: string;
  role: ProjectRole;
  addedAt: string;
  addedBy: string;
}

export interface ProjectMembership {
  projectId: string;
  /** Keycloak group path. 프로젝트 생성자의 팀. 예: "/team-a" */
  teamId: string;
  members: ProjectMember[];
  /** 멤버십이 바뀔 때마다 1 증가. 캐시 무효화 기준 */
  version: number;
}

/**
 * 프로젝트 역할별 허용 동작(서버가 요청마다 판정한다)
 * - viewer: 프로젝트 열기, 프리뷰(read capability), 감사 기록 중 자기 기록 조회
 * - editor: viewer + 생성·답변·취소, 소스 저장, preview 환경 write capability
 * - owner:  editor + 멤버 추가·역할 변경·제거, live 환경 write 승인 요청
 * live 환경 write capability는 해당 API의 api-owner(요청자와 다른 사람)의 승인 기록이 있어야 발급된다.
 */
export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** 프리뷰 전용 하향 세션. Keycloak 토큰은 절대 프리뷰로 넘기지 않는다. */
export interface PreviewSessionClaims {
  sub: string;
  projectId: string;
  roles: ["viewer"];
  aud: "toi-preview";
  exp: number;
  jti: string;
}

export interface PreviewSessionRequest {
  projectId: string;
  /** 없으면 read capability. 있으면 editor 이상만, apiIds·ttlSec(≤120) 범위의 preview write */
  write?: { apiIds: string[]; ttlSec: number };
}

export interface PreviewSession {
  sessionToken: string;
  sessionClaims: PreviewSessionClaims;
  capabilityToken: string;
  capability: CapabilityClaims;
}

export interface ApprovalRequest {
  projectId: string;
  apiId: string;
  /** 승인 대상: live 환경 쓰기 */
  scope: "live-write";
  justification: string;
}

export interface Approval extends ApprovalRequest {
  approvalId: string;
  requestedBy: string;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedBy?: string;
  decidedAt?: string;
  /** 승인 유효 기간(ISO). 지나면 expired */
  expiresAt: string;
}

/**
 * HTTP 규칙 (P0-1)
 *
 * 공통: 사용자 요청은 Authorization: Bearer <Keycloak access token>. 서비스 간 요청은 client credentials 토큰.
 * dev session 발급(POST /dev/session)은 제거한다. 테스트는 Keycloak 테스트 사용자로 로그인한다.
 *
 * services/agent-server (멤버십의 원천)
 *   POST   /projects                         → 생성자를 owner로, 생성자의 첫 group을 teamId로 기록
 *   GET    /projects/:id/membership          → ProjectMembership (멤버만)
 *   PUT    /projects/:id/members/:sub        body { role } → ProjectMembership (owner만, 마지막 owner 강등 금지)
 *   DELETE /projects/:id/members/:sub        → ProjectMembership (owner만, 마지막 owner 제거 금지)
 *   GET    /internal/projects/:id/membership → ProjectMembership (client "toi-policy-proxy" 서비스 토큰만)
 *   그 밖의 프로젝트·생성 API는 위 역할표로 판정한다. 멤버가 아니면 404(존재 노출 금지).
 *
 * services/policy-proxy
 *   POST /preview-sessions  body PreviewSessionRequest → PreviewSession (Keycloak 사용자 토큰, 스튜디오 origin만)
 *   POST /approvals         body ApprovalRequest → Approval (프로젝트 owner)
 *   POST /approvals/:id/decision body { decision: "approved" | "rejected" } → Approval (해당 API의 api-owner, 요청자 본인 금지)
 *   GET  /approvals?projectId= → Approval[] (프로젝트 멤버 또는 api-owner)
 *   POST /capabilities      env=live는 유효한 approved Approval이 있어야 한다
 *   멤버십은 agent-server internal API로 조회하며 캐시는 최대 5초. 멤버 제거·계정 비활성화 후 5초 안에 거부되어야 한다.
 *   /proxy/*는 프리뷰 세션(aud toi-preview) 또는 Keycloak 사용자 토큰을 받는다. 어느 쪽이든 capability의 sub·projectId와 일치해야 한다.
 */
