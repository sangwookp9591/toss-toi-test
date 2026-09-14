// 채팅 생성 + 프로젝트 소스 계약. services/agent-server가 구현하고 apps/studio가 소비한다.
import type { VfsFiles } from "./runtime.ts";
import type { PackageSetRequest } from "./package-set.ts";
import type { ProjectApiBinding } from "./registry.ts";

export interface Project {
  projectId: string;
  name: string;
  /** 서버가 발급하는 소스 revision. 저장할 때마다 1 증가 */
  revision: number;
  /** project 계층 VFS 파일 */
  files: VfsFiles;
  packageSet: PackageSetRequest;
  /** 이 프로젝트가 쓰는 등록 API */
  apiIds: string[];
  /** P1-3: apiIds 각각의 고정 버전(apiIds와 같은 순서). 없는 기존 프로젝트는 버전 1로 이관한다 */
  apiBindings?: ProjectApiBinding[];
  updatedAt: string;
}

export interface CreateGenerationRequest {
  projectId: string;
  prompt: string;
  /** 생성을 시작한 시점의 revision. 저장 시 CAS 기준 */
  baseRevision: number;
  /** 클라이언트 멱등 키 */
  requestId: string;
}

export type GenerationState =
  | "requested" | "staging" | "awaiting_answer" | "revision_ready" | "done" | "failed" | "canceled";

/** SSE 이벤트. id: seq, event: type, data: JSON(GenerationEvent) */
export type GenerationEvent = { seq: number; generationId: string } & (
  | { type: "state"; state: GenerationState }
  | { type: "text"; delta: string }
  | { type: "question"; questionId: string; question: string; options?: string[] }
  | { type: "file"; path: string; content: string }
  | { type: "file_deleted"; path: string }
  | { type: "packages_requested"; packageSet: PackageSetRequest }
  /** staging 파일이 서버에 CAS 저장됨. 스튜디오는 이 revision으로 빌드한다 */
  | { type: "revision_ready"; revision: number; sourceDigest: string; files: VfsFiles; packageSet: PackageSetRequest }
  | { type: "failed"; message: string; code?: "conflict" | "model_error" | "tool_error" | "internal" }
  | { type: "canceled" }
  | { type: "done"; summary: string }
);

/**
 * HTTP API (services/agent-server, 포트 7400)
 *
 * POST /projects                          body: { name, apiIds } → Project (템플릿 파일로 revision 1 생성)
 * GET  /projects/:projectId               → Project
 * PUT  /projects/:projectId/source        body: { baseRevision, files, packageSet? }
 *   → 200 Project | 409 { error: "conflict", currentRevision }   (CAS)
 * POST /generations                       body: CreateGenerationRequest → 202 { generationId }  (requestId 멱등)
 * GET  /projects/:projectId/generations/active → 200 ActiveGeneration { generationId, state, lastSeq, prompt, createdAt } | 404 (진행 중 생성 없음)
 *                                         다른 탭·새 창에서 같은 프로젝트의 진행 중 생성을 발견하는 용도
 * GET  /generations/:id/events            SSE. Last-Event-ID 헤더로 끊긴 지점 이후 replay. 종결 이벤트(done/failed/canceled) 후 종료
 * POST /generations/:id/answers           body: { questionId, answer } → 204
 * POST /generations/:id/cancel            → 204. 이후 도착하는 결과는 저장·전송하지 않는다
 * GET  /healthz                           → { ok, agentMode: "claude" | "mock" | "local" | "gemini" }
 *
 * 에이전트
 * - 모델: claude-opus-5, thinking { type: "adaptive" }, 스트리밍 tool runner(@anthropic-ai/sdk betaZodTool).
 * - 도구: list_registered_apis, get_api_schema(apiId), list_files, read_file, write_file, delete_file,
 *         ask_user(question, options?) — answers 도착까지 대기, request_packages(packageSet), finish(summary)
 * - 생성 코드 규칙은 시스템 프롬프트로 준다: 데이터는 반드시 `/proxy/:apiId/...`(policy-proxy)로만 호출,
 *   @toi/tds 컴포넌트 우선, 패키지는 packageSet.entries에 있는 것만 import.
 * - finish 시 staging 파일을 PUT source와 같은 CAS 규칙으로 저장 → revision_ready → done.
 * - 자격증명이 없으면(AGENT_MODE=mock 또는 인증 실패) 같은 이벤트 형태를 내는 결정적 mock 생성기로 동작한다.
 */
export const AGENT_SERVER_PORT = 7400;
export const STUDIO_PORT = 5173;
export const PREVIEW_ORIGIN_PORT = 5174;

export interface ActiveGeneration {
  generationId: string;
  state: GenerationState;
  lastSeq: number;
  /** 생성을 시작한 사용자 요청 원문. 다른 탭에서 대화 첫 메시지를 복원하는 용도 */
  prompt: string;
  /** 생성 시작 시각(ISO) */
  createdAt: string;
}
