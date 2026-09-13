// 의존성 조합(Package Set) 계약. services/deps-builder가 구현하고
// packages/preview-runtime, services/agent-server, apps/studio가 소비한다.

/** 조합 빌드 요청. entries는 앱 코드가 import할 수 있는 공개 specifier 목록이다. */
export interface PackageSetRequest {
  /** 예: ["react", "react/jsx-runtime", "react-dom/client", "@tanstack/react-query", "@toi/tds"] */
  entries: string[];
  /** package.json dependencies와 같은 형식. 예: { react: "19.3.0", "@toi/tds": "^1.0.0" } */
  dependencies: Record<string, string>;
}

/** 산출물에 영향을 주는 빌드 조건. artifactKey 입력에 포함된다. */
export interface BuildProfile {
  builder: "vite" | "esbuild";
  builderVersion: string;
  packageManager: "yarn-berry";
  packageManagerVersion: string;
  /** 예: "es2022" */
  target: string;
  nodeEnv: "development" | "production";
  /** 예: ["browser", "import", "module", "default"] */
  conditions: string[];
  /** 빌드 설정(플러그인, define, external 규칙 등)을 정규화 JSON으로 만든 sha256 */
  configDigest: string;
  /** 레지스트리 해석 정책 식별자. 토큰 원문은 절대 넣지 않는다. 예: "verdaccio-local-v1" */
  registryNamespace: string;
}

export interface ManifestFile {
  /** 조합 루트 기준 상대 경로. 예: "chunks/react-abc123.js" */
  path: string;
  sha256: string;
  bytes: number;
}

export interface PackageSetManifest {
  schemaVersion: 1;
  /**
   * 토스 공개 규칙 원형:
   * sha256(JSON.stringify({ entries: [...entries].sort(), lockfileHash: sha256(rawLockBytes) })).slice(0, 16)
   * 기록·비교용이며 캐시 조회 키로 쓰지 않는다.
   */
  tossPackageSetHash: string;
  /**
   * 개선 키(전체 64 hex):
   * sha256(JSON.stringify({ entries: sorted, lockfileSha256, buildProfile })) — 키 순서를 고정한 정규화 JSON
   */
  artifactKey: string;
  lockfileSha256: string;
  entries: string[];
  /** 브라우저 import map. 값은 assetBaseUrl 기준 절대 URL이다. */
  importMap: { imports: Record<string, string> };
  files: ManifestFile[];
  buildProfile: BuildProfile;
  /** 예: "http://localhost:7100/assets/<artifactKey>/" */
  assetBaseUrl: string;
  createdAt: string;
}

/** manifest 자체의 식별자: sha256(정규화 JSON(manifest)). RevisionToken.manifestDigest에 쓴다. */
export type ManifestDigest = string;

export type PackageSetStatus =
  | { status: "ready"; artifactKey: string; manifestDigest: ManifestDigest; manifestUrl: string; manifest: PackageSetManifest }
  | { status: "building"; artifactKey: string; startedAt: string }
  | { status: "failed"; artifactKey: string; error: string };

/**
 * HTTP API (services/deps-builder, 포트 7100)
 *
 * POST /package-sets                body: PackageSetRequest
 *   → 200 PackageSetStatus(ready)   캐시 적중
 *   → 202 PackageSetStatus(building) 새 조합. 같은 artifactKey 동시 요청은 single-flight로 합친다.
 *   → 400 { error }                  entries가 dependencies로 해석되지 않음
 * GET  /package-sets/:artifactKey    → PackageSetStatus
 * GET  /package-sets/:artifactKey/wait?timeoutMs=  → ready/failed가 될 때까지 대기(최대 timeoutMs)
 * GET  /assets/:artifactKey/*         → 산출물. Cache-Control: immutable, CORS: 스튜디오·프리뷰 origin 허용
 * GET  /healthz
 *
 * 규칙
 * - manifest는 모든 파일 업로드와 sha256 검증이 끝난 뒤 마지막에 쓴다.
 * - React, react-dom, @tanstack/react-query 같은 공유 상태 패키지는 import map에서 단일 URL로 해석되어야 한다.
 * - 레지스트리 토큰은 빌드 워커 프로세스 환경변수로만 받는다. 응답·manifest·로그에 남기지 않는다.
 */
export const DEPS_BUILDER_PORT = 7100;
