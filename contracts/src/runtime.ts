// 브라우저 프리뷰 런타임 계약. packages/preview-runtime이 구현하고 apps/studio가 소비한다.
import type { PackageSetManifest, ManifestDigest } from "./package-set.ts";

/** VFS 계층. 우선순위: user > project > template > runtime (같은 경로면 앞쪽이 이긴다) */
export type VfsLayer = "user" | "project" | "template" | "runtime";
export const VFS_PRECEDENCE: readonly VfsLayer[] = ["user", "project", "template", "runtime"];

/** 경로는 "/"로 시작하는 POSIX 경로. 예: "/src/App.tsx" */
export type VfsFiles = Record<string, string>;

/** 한 번의 빌드 시도를 식별한다. 커밋 판정은 전부 이 토큰으로 한다. */
export interface RevisionToken {
  projectId: string;
  /** 서버가 발급한 소스 revision(단조 증가 정수) */
  revision: number;
  /** 같은 revision의 재시도·설정 변경을 구분 */
  attemptId: string;
  /** sha256(정규화 JSON(병합된 VFS 파일)) */
  sourceDigest: string;
  manifestDigest: ManifestDigest;
}

export interface Diagnostic {
  file?: string;
  line?: number;
  column?: number;
  message: string;
}

export type PreviewEvent =
  | { type: "build_started"; token: RevisionToken }
  | { type: "build_failed"; token: RevisionToken; diagnostics: Diagnostic[] }
  | { type: "runtime_failed"; token: RevisionToken; error: Diagnostic }
  | { type: "committed"; token: RevisionToken; timings: { bundleMs: number; bootMs: number; totalMs: number } }
  | { type: "stale_discarded"; token: RevisionToken; reason: "superseded" | "canceled" | "manifest_mismatch" };

export interface PreviewRuntimeOptions {
  /** 프리뷰 iframe을 붙일 요소 */
  container: HTMLElement;
  /** 프리뷰 iframe origin. 스튜디오 origin과 달라야 한다. 예: "http://localhost:5274" */
  previewOrigin: string;
  /** 프리뷰 iframe 문서 URL(previewOrigin 아래). 예: "http://localhost:5274/frame.html" */
  frameUrl: string;
  esbuildWasmUrl: string;
  /** 앱 진입점 VFS 경로. 예: "/src/main.tsx" */
  entry: string;
  /** 앱이 붙을 DOM id (frame.html 안). 기본 "root" */
  mountId?: string;
  /** 실행 검증 대기 시간. 이 안에 rendered가 오지 않으면 runtime_failed. 기본 5000 */
  bootTimeoutMs?: number;
}

/**
 * 호스트(스튜디오)가 프리뷰 실행 전에 주입하는 설정.
 * frame은 번들을 실행하기 전에 `globalThis.__TOI_FETCH_CONFIG__ = Object.freeze({...toiFetch})`를 설정한다.
 * 생성 코드(@toi/fetch configureToiFetch)는 이 전역만 읽는다.
 *
 * R3-M2 수정: frame에는 어떤 자격 증명도 넣지 않는다. frame은 CSP로 네트워크가 막혀 있어도
 * top-level이 아닌 자기 내비게이션(location.href)으로 쿼리스트링을 외부에 보낼 수 있기 때문이다.
 * 프리뷰 세션·capability 토큰은 호스트(스튜디오)에만 두고, @toi/fetch는 postMessage 브로커로 요청한다.
 */
export interface PreviewHostConfig {
  toiFetch?: {
    projectId: string;
    env: "preview" | "live";
    /** 항상 "broker". 토큰 필드(sessionToken·capabilityToken)가 있으면 frame은 부팅을 거부한다 */
    transport: "broker";
  };
}

/**
 * @toi/fetch 브로커 메시지(frame ↔ 호스트). 양쪽 모두 origin·source를 검증한다.
 * 호스트 검증 규칙(스튜디오):
 * - source가 현재 커밋된 frame 또는 검증 중인 frame의 contentWindow이고, origin이 해당 프로젝트 프리뷰 origin이며,
 *   token(revision·attemptId)이 그 frame의 토큰과 같을 때만 처리한다. 교체·폐기된 frame의 요청은 거부한다.
 * - apiId는 프로젝트 apiIds에 있어야 한다. path 규칙은 @toi/fetch와 같다(`/` 시작, `//`·`\`·`#` 금지, 정규화 후 접두사 유지).
 * - method는 GET·POST·PUT·PATCH·DELETE. 쓰기 method는 사용자가 허용한 write capability가 있을 때만 전달하고, 없으면 403 WRITE_NOT_ALLOWED.
 * - 요청 헤더는 Content-Type만 전달한다. body는 문자열 ≤ 1MiB. 응답 body ≤ 5MiB(초과 시 413 RESPONSE_TOO_LARGE).
 * - frame당 동시 8건, 초당 50건 초과 시 429. redirect는 error.
 * - 호스트가 Authorization·X-Toi-Project·X-Toi-Capability·X-Toi-Env·X-Toi-Reason을 붙여 policy-proxy에 보낸다.
 * 내비게이션 규칙:
 * - 커밋 뒤 frame에서 load 이벤트가 다시 발생하면(자기 내비게이션) 호스트는 그 frame을 즉시 제거하고
 *   runtime_failed("preview navigated away")를 내며, 마지막 정상 revision을 새 frame으로 다시 띄운다.
 * - 잔여 위험: 화면에 이미 렌더링된 마스킹 데이터는 내비게이션 쿼리스트링으로 단방향 유출될 수 있다. 토큰은 유출되지 않는다.
 */
export type FrameToHostFetch = {
  kind: "toi_fetch";
  token: Pick<RevisionToken, "revision" | "attemptId">;
  requestId: string;
  apiId: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  contentType?: string;
  body?: string;
  reason?: string;
};
export type HostToFrameFetch = {
  kind: "toi_fetch_result";
  requestId: string;
  status: number;
  contentType?: string;
  body: string;
  /** 브로커가 거부한 경우의 코드. policy-proxy 오류는 status·body 그대로 */
  brokerError?: "NOT_ALLOWED_SOURCE" | "API_NOT_IN_PROJECT" | "INVALID_API_PATH" | "WRITE_NOT_ALLOWED" | "TOO_MANY_REQUESTS" | "BODY_TOO_LARGE" | "RESPONSE_TOO_LARGE" | "UPSTREAM_UNREACHABLE";
};

export interface BuildInput {
  token: RevisionToken;
  layers: Partial<Record<VfsLayer, VfsFiles>>;
  manifest: PackageSetManifest;
  hostConfig?: PreviewHostConfig;
}

export interface PreviewRuntime {
  /** 사용자의 최신 의도. 이것과 다른 토큰의 결과는 커밋하지 않는다. */
  setDesiredRevision(token: RevisionToken): void;
  /** 빌드 → 새 iframe에서 실행 검증 → 조건을 만족할 때만 기존 iframe과 교체 */
  build(input: BuildInput): Promise<PreviewEvent>;
  cancel(token: RevisionToken): void;
  on(listener: (event: PreviewEvent) => void): () => void;
  dispose(): void;
}

/**
 * 규칙
 * - esbuild-wasm은 Web Worker에서 실행한다. context를 유지하고 rebuild로 증분 빌드한다.
 * - external은 manifest.importMap.imports의 키와 정확히 일치하는 specifier만 허용한다.
 *   그 외 bare import는 빌드 실패 Diagnostic: "package not in package set: <specifier>".
 * - 커밋 조건: 새 iframe이 rendered를 보냈고(오류 없음), 토큰이 desired와 완전히 같고, 취소되지 않았음.
 *   조건 불충족이면 새 iframe을 버리고 마지막 정상 iframe을 유지한다.
 * - 격리 헤더(COOP/COEP) 없이 동작해야 한다.
 */

/**
 * P0-2 프로젝트별 프리뷰 origin과 CSP
 *
 * 프리뷰 origin은 프로젝트마다 다르다. 같은 origin을 공유하면 한 프로젝트의 생성 코드가
 * 다른 프로젝트 프리뷰의 storage·BroadcastChannel·열린 창에 닿을 수 있다.
 * `*.localhost`는 브라우저가 loopback으로 해석하고 secure context로 취급한다.
 */
export const PREVIEW_PORT = 5274;
export const PREVIEW_HOST_SUFFIX = ".preview.localhost";
/** projectId는 UUID(소문자). 그 밖의 값은 거부한다. DNS label: "p-" + 36자 = 38자(≤63) */
export const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function previewOriginForProject(projectId: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("invalid projectId for preview origin");
  return `http://p-${projectId}${PREVIEW_HOST_SUFFIX}:${PREVIEW_PORT}`;
}
/** previewOriginForProject의 역함수. 형식이 아니면 null */
export function projectIdFromPreviewOrigin(origin: string): string | null {
  const match = /^http:\/\/p-([0-9a-f-]{36})\.preview\.localhost:5274$/.exec(origin);
  return match && PROJECT_ID_PATTERN.test(match[1]) ? match[1] : null;
}

/**
 * 프리뷰 서버(5274) 규칙
 * - Host 헤더가 `p-<uuid>.preview.localhost:5274`가 아니면 421. 이 포트는 frame 문서와 frame 스크립트만 제공한다
 *   (스튜디오 번들·벤치·esbuild.wasm·임의 파일 없음). 스튜디오(5273)는 프리뷰 자산을 제공하지 않는다.
 * - frame 문서 응답 CSP(헤더, document.open 뒤에도 유지되어야 한다). 최소 요구:
 *     default-src 'none'; connect-src 'none'; script-src 'self' <패키지 자산 origin> 'nonce-<응답별>';
 *     style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none';
 *     frame-ancestors http://localhost:5273; worker-src 'none'; object-src 'none'
 *   'unsafe-eval' 금지. connect-src는 'none'(R3-M2: 데이터 요청은 브로커만). script-src에 data:·blob: 금지(R3-L2):
 *   번들은 nonce가 붙은 인라인 module 스크립트로 실행한다.
 *   인라인 부트 스크립트·import map 허용은 응답마다 새 nonce 또는 동등한 방식으로 하고, 'unsafe-inline' script는 금지.
 * - frame iframe sandbox는 allow-scripts allow-same-origin만. allow-top-navigation·allow-popups·allow-forms 금지.
 * - frame의 studio-origins 목록은 스튜디오 origin 하나만 둔다.
 * - 스튜디오 응답: CSP frame-ancestors 'self', X-Frame-Options: SAMEORIGIN, frame-src는 프리뷰 origin 패턴만.
 * - PreviewRuntimeOptions.previewOrigin은 previewOriginForProject(projectId)여야 한다. 프로젝트가 바뀌면 런타임을 새로 만든다.
 */

/** iframe 메시지 프로토콜. 양쪽 모두 event.origin과 event.source를 검증한다. */
export type ParentToFrame = {
  kind: "load";
  token: RevisionToken;
  importMap: { imports: Record<string, string> };
  /** esbuild 산출 ESM 번들 */
  code: string;
  mountId: string;
  /** BuildInput.hostConfig 그대로. frame이 번들 실행 전에 전역으로 주입한다 */
  hostConfig?: PreviewHostConfig;
};

export type FrameToParent =
  | { kind: "frame_ready" }
  | { kind: "rendered"; token: RevisionToken; bootMs: number }
  | { kind: "error"; token: RevisionToken; error: Diagnostic };
