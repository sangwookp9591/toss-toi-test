# TOI-lite 아키텍처

토스 TOI("AI 시대 어드민")를 재현하는 실험 구현입니다. 뼈대는 토스와 같고, 분석에서 합의한 개선을 반영했습니다. 문제 정의와 제약은 [`intent/INTENT.md`](../intent/INTENT.md), 근거는 저장소 루트의 분석 보고서에 있습니다.

## 해결하려는 토스의 문제

| 토스가 겪은 문제 | 이 구현의 해법 | 담당 |
|---|---|---|
| 서버 dev 서버 공유 → 한 사용자의 에러가 전체로 번짐 | 사용자 브라우저 안에서 빌드하고, 시도마다 새 iframe을 만듦 | `packages/preview-runtime` |
| Sandpack이 런타임에 의존성을 받음 → 첫 화면 47초 | 의존성은 서버가 조합 단위로 **미리** 빌드 → 객체 저장소 → import map. 브라우저는 앱 코드만 번들 | `services/deps-builder` |
| 사내 레지스트리 인증·tarball URL·CORS/PNA | 레지스트리 자격증명은 빌드 워커만 가짐. 브라우저는 산출물 URL만 받음 | `services/deps-builder` + `infra/verdaccio` |
| 조합을 따로 번들하면 싱글톤이 깨짐 | 조합 전체를 한 번에 빌드, React 등은 import map의 단일 URL | `services/deps-builder` |
| AI 코드가 데이터 정책을 우회할 수 있음 | 생성 UI는 정책 프록시만 호출. 마스킹·사유·감사·권한을 서버가 강제 | `services/policy-proxy` |
| 채팅으로 요구를 받아 코드 생성 | SSE 이벤트 스트림, 역질문, revision 단위 반영 | `services/agent-server` |

## 분석에서 합의한 개선 (토스 공개 설계에 추가)

1. **캐시 키 이원화**: 토스 원형 `tossPackageSetHash`(16 hex)는 그대로 계산해서 기록하고, 실제 캐시 조회에는 빌드 도구·설정 지문을 포함한 `artifactKey`를 씁니다. 산출물 파일마다 sha256을 manifest에 기록하고 검증합니다.
2. **manifest는 업로드가 끝난 뒤에 publish**: 파일을 전부 올린 다음 manifest를 마지막에 씁니다. 같은 `artifactKey`로 동시에 들어온 요청은 single-flight로 합칩니다.
3. **revision guard**: 프리뷰는 "실행까지 검증됐고 여전히 최신 의도 revision인 후보"만 커밋합니다. 늦게 끝난 이전 빌드, 취소된 빌드, manifest가 다른 attempt는 폐기합니다.
4. **소스 저장 CAS**: `baseRevision`이 다르면 409를 돌려줍니다.
5. **프리뷰 capability**: 프리뷰는 기본 read-only입니다. 쓰기는 서버가 발급한 범위 한정 토큰으로만 허용합니다. 화면 롤백이 API 쓰기의 롤백이 아니라는 점을 전제로 합니다.

## 구성과 포트

```
                         ┌──────────────── apps/studio (5173) ────────────────┐
 사용자 ── 채팅 ────────▶ │ ChatPanel ─SSE─▶ agent-server (7400) ─▶ Claude API  │
                         │ PreviewPane ─ preview-runtime (Worker+esbuild-wasm)  │
                         │      └ iframe (preview origin 5174)                  │
                         └──────────────────────────────────────────────────────┘
 preview-runtime ─ GET manifest/assets ─▶ deps-builder (7100) ─▶ MinIO (9000)
 deps-builder ─ yarn install (npmAuthToken) ─▶ Verdaccio (4873): @toi/* 인증 필수, 그 외 npmjs 프록시
 생성 UI (iframe) ─ fetch /proxy/:apiId/* ─▶ policy-proxy (7200) ─▶ mock-backend (7300)
 agent-server ─ GET /apis, /apis/:id ─▶ policy-proxy (API 레지스트리)
```

| 컴포넌트 | 경로 | 포트 |
|---|---|---|
| Verdaccio (사내 레지스트리 흉내) | `infra/verdaccio` | 4873 |
| MinIO (S3 흉내) | `infra/docker-compose.yml` | 9000 / 9001 |
| 의존성 빌더 | `services/deps-builder` | 7100 |
| 정책 프록시 + API 레지스트리 | `services/policy-proxy` | 7200 |
| mock 업무 백엔드 | `services/mock-backend` | 7300 |
| 에이전트 서버 | `services/agent-server` | 7400 |
| 스튜디오 (채팅 + 프리뷰) | `apps/studio` | 5173 |
| 프리뷰 iframe origin | `apps/studio` 두 번째 서버 | 5174 |
| 브라우저 런타임 라이브러리 | `packages/preview-runtime` | — |
| 가짜 사내 디자인시스템 | `packages/fake-tds` → Verdaccio에 `@toi/tds`로 publish | — |

## 저장소 규칙

- **패키지마다 독립 `package.json`과 lockfile**을 둡니다. 루트 workspace는 두지 않습니다. 병렬 워커가 같은 lockfile을 동시에 고치지 않게 하기 위해서입니다.
- **`contracts/`는 계약입니다.** 모든 서비스가 따르고, 변경은 코디네이터만 합니다. 워커는 `import type`으로 참조하고, 계약과 다르게 구현해야 하면 멈추고 질문합니다.
- **git commit은 코디네이터가 합니다.** 워커는 커밋하지 않습니다.
- 서비스 런타임은 Node 22 + TypeScript(ESM)입니다. 실행은 `tsx`, 타입 검사는 `tsc --noEmit`으로 합니다.
- 비밀값은 `.env`(gitignore)로 받고, 예시는 `.env.example`에 둡니다.
