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

export interface BuildInput {
  token: RevisionToken;
  layers: Partial<Record<VfsLayer, VfsFiles>>;
  manifest: PackageSetManifest;
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

/** iframe 메시지 프로토콜. 양쪽 모두 event.origin과 event.source를 검증한다. */
export type ParentToFrame = {
  kind: "load";
  token: RevisionToken;
  importMap: { imports: Record<string, string> };
  /** esbuild 산출 ESM 번들 */
  code: string;
  mountId: string;
  /** 정책 프록시 호출용 capability 토큰(read-only 기본) */
  capabilityToken?: string;
};

export type FrameToParent =
  | { kind: "frame_ready" }
  | { kind: "rendered"; token: RevisionToken; bootMs: number }
  | { kind: "error"; token: RevisionToken; error: Diagnostic };
