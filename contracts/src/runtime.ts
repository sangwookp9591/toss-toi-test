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
  /** 프리뷰 iframe origin. 스튜디오 origin과 달라야 한다. 예: "http://localhost:5174" */
  previewOrigin: string;
  /** 프리뷰 iframe 문서 URL(previewOrigin 아래). 예: "http://localhost:5174/frame.html" */
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
 * 생성 코드(@toi/fetch configureToiFetch)는 이 전역만 읽고 토큰을 하드코딩하지 않는다.
 */
export interface PreviewHostConfig {
  toiFetch?: {
    /**
     * 반드시 viewer 역할만 가진 세션. editor 세션은 호스트(스튜디오)에만 둔다.
     * 생성 코드가 editor 세션을 받으면 POST /capabilities로 스스로 write capability를 발급할 수 있다.
     * 쓰기 허용은 호스트가 editor 세션으로 범위·TTL을 제한한 write capability를 발급해 capabilityToken으로만 넘긴다.
     */
    sessionToken: string;
    /** 기본 read capability. write는 사용자가 명시적으로 허용했을 때만 */
    capabilityToken: string;
    projectId: string;
    /** 예: "http://localhost:7200" */
    proxyBaseUrl: string;
    env: "preview" | "live";
  };
}

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
export const PREVIEW_PORT = 5174;
export const PREVIEW_HOST_SUFFIX = ".preview.localhost";
/** projectId는 UUID(소문자). 그 밖의 값은 거부한다. DNS label: "p-" + 36자 = 38자(≤63) */
export const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function previewOriginForProject(projectId: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("invalid projectId for preview origin");
  return `http://p-${projectId}${PREVIEW_HOST_SUFFIX}:${PREVIEW_PORT}`;
}
/** previewOriginForProject의 역함수. 형식이 아니면 null */
export function projectIdFromPreviewOrigin(origin: string): string | null {
  const match = /^http:\/\/p-([0-9a-f-]{36})\.preview\.localhost:5174$/.exec(origin);
  return match && PROJECT_ID_PATTERN.test(match[1]) ? match[1] : null;
}

/**
 * 프리뷰 서버(5174) 규칙
 * - Host 헤더가 `p-<uuid>.preview.localhost:5174`가 아니면 421. 이 포트는 frame 문서와 frame 스크립트만 제공한다
 *   (스튜디오 번들·벤치·esbuild.wasm·임의 파일 없음). 스튜디오(5173)는 프리뷰 자산을 제공하지 않는다.
 * - frame 문서 응답 CSP(헤더, document.open 뒤에도 유지되어야 한다). 최소 요구:
 *     default-src 'none'; connect-src <policy-proxy origin>; script-src 'self' <패키지 자산 origin> data: + 인라인 부트 허용 방식;
 *     style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none';
 *     frame-ancestors http://localhost:5173; worker-src 'none'; object-src 'none'
 *   'unsafe-eval' 금지. connect-src에 'self'·와일드카드 금지(상대 URL 요청도 차단되어야 한다).
 *   인라인 부트 스크립트·import map 허용은 응답마다 새 nonce 또는 동등한 방식으로 하고, 'unsafe-inline' script는 금지.
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
