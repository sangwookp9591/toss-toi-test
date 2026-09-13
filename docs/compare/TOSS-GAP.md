# TOI-lite와 토스 TOI: 구현 대응, 성능, 운영 격차

비교일: 2026-09-13. 대상 HEAD `ef32d7e`는 지정 `b5e3786`에 작업 명세 `docs/tasks/CMP1-toss-gap.md`만 추가한 커밋이다. 제품 소스·설정·계약은 지정 버전과 같다. 이 보고서와 `bench/`만 작성했으며 제품 수정, commit, push는 하지 않았다. [최종 검증](bench/validation.json)은 18개 측정·40개 기능·점수/중앙값·로컬 링크·비밀값 불포함을 확인한다.

**결론:** TOI-lite는 브라우저 프리뷰와 조합 의존성 공급의 구조를 재현했다. 운영 제품으로서의 격차는 생성 품질, 실제 조직 권한, 다운로드 보호, 소스/Git/리뷰/릴리즈 연결, 다수 프로젝트 운영에 집중된다. 일부 동시성·권한 설계는 공개 설명보다 명시적이지만, 토스 내부 구현보다 우수하다고 검증한 것은 아니다.

## 1. 기능 대응표

### 출처와 판정 기준

- **글 A**: 이현재, [AI가 만든 코드가 어드민이 되기까지](https://toss.tech/article/52885), 2026-09-04. 표의 `A / 절 이름`은 이 URL의 해당 소제목이다.
- **편집 E**: [편집 영상](https://www.youtube.com/watch?v=tcGKZANuUVE). **전체 W**: [웨비나와 Q&A](https://youtube.com/live/xDVbTlFfu30). 타임스탬프 링크는 해당 발언의 시작 위치다.
- 두 영상의 한국어 자동자막과 글 HTML을 새로 받아 해당 구간을 확인했다. 원문은 지정된 외부 `scratchpad/cmp1/`에만 보존했다. 자막에는 ASR 오류가 있으므로 제품명·용어는 글과 문맥을 함께 확인했고, 애매한 구현은 확정하지 않았다. 특히 자동자막의 “로그인 증적”은 호출 **로깅** 문맥이며 SSO 증거로 사용하지 않았다.
- 우리 근거는 현재 파일의 `경로:줄` 또는 실제 존재하는 테스트 이름이다. 문서 링크는 저장소 상대 경로이며, `:줄`은 바로 옆에 명시했다. [기존 조사](../../astra-report.md)와 [비판 검토](../../astra-critique.md)는 비교 누락을 찾는 보조 자료로 읽었고, 토스 사실의 최종 출처는 위 1차 자료다.
- `동등`: 명시한 좁은 기능의 작동 원리·관찰 가능한 동작이 대응한다. 운영 품질이나 모든 입력의 동등함을 뜻하지 않는다. `부분`: 기능 일부 또는 실험 대체물만 있다. `다름(의도적 개선)`: 같은 문제에 다른 설계 선택을 적용했고 이유가 있다; 우열의 실증은 아니다. `없음`: TOI-lite에서 구현을 찾지 못했다. `확인 불가(토스 비공개)`: 토스의 세부 정보가 없어 양쪽을 판정하지 않는다.

### 생성·API (A1–A5)

| ID | 토스 기능·출처 위치 | 판정 | TOI-lite 근거와 차이 |
|---|---|---|---|
| A1 | 자연어 채팅 → React 화면, [E 02:08](https://www.youtube.com/watch?v=tcGKZANuUVE&t=128s) | 부분 | [main.tsx](../../apps/studio/src/main.tsx):33, [mock.ts](../../services/agent-server/src/mock.ts):7. 채팅/SSE/UI는 연결되지만 현재는 결정적 템플릿 생성이다. |
| A2 | 역질문·답변, [E 02:15](https://www.youtube.com/watch?v=tcGKZANuUVE&t=135s) | 동등 | [generation.ts](../../contracts/src/generation.ts):34,55, [controller.ts](../../apps/studio/src/controller.ts):218. 질문 대기와 자유 답변 경로; E2E `A: 생성, 역질문, 마스킹, 조회 사유와 감사 기록`. 질문의 지능은 A3/F3에서 별도 평가한다. |
| A3 | 플래닝 → 코드 작성, [E 02:26](https://www.youtube.com/watch?v=tcGKZANuUVE&t=146s) | 부분 | [mock.ts](../../services/agent-server/src/mock.ts):8–19, [system-prompt.ts](../../services/agent-server/src/system-prompt.ts):12. staging/finish는 있으나 mock은 고정 질문·키워드 분기이고 독립 계획 산출물/계획 승인 UI는 없다. |
| A4 | 등록 요청·응답 스키마와 부가 설명 활용, [W 18:00](https://www.youtube.com/watch?v=xDVbTlFfu30&t=1080s) | 부분 | [system-prompt.ts](../../services/agent-server/src/system-prompt.ts):3–4, [generation.ts](../../contracts/src/generation.ts):62. list_registered_apis/get_api_schema와 정제된 registry context 경로가 있으나 mock 생성은 schema tool을 호출하지 않는다. 임의 업무 스키마로 생성 품질을 검증하지 않았다. |
| A5 | API 등록과 사용할 API 선택, [E 02:37](https://www.youtube.com/watch?v=tcGKZANuUVE&t=157s) | 부분 | [server.ts](../../services/policy-proxy/src/server.ts):120–125, [controller.ts](../../apps/studio/src/controller.ts):106. 관리자 등록 API·seed는 있지만 스튜디오 생성은 customers로 고정되고 등록/선택 UI는 없다. |

### 정책 프록시 (B1–B5)

각 토스 항목의 1차 근거는 A / **어드민을 정책과 화면으로 나눠서 생각하기**, 보충은 [E 04:22](https://www.youtube.com/watch?v=tcGKZANuUVE&t=262s)이다.

| ID | 토스 기능 | 판정 | TOI-lite 근거와 차이 |
|---|---|---|---|
| B1 | 등록 API를 서버에서 프록시하고 정책 적용 | 동등 | [policy-proxy README](../../services/policy-proxy/README.md):43–52. 매 요청마다 세션/역할/capability/경로를 검증한다. E2E A/D가 실제 mock upstream 흐름을 검증한다. |
| B2 | 개인정보 마스킹 | 부분 | [policy-proxy README](../../services/policy-proxy/README.md):73–91. JSON Pointer 규칙과 보조 PII 스캔은 있다. 숫자/전각/필드 분할 및 의미 판단은 미완성; [FOLLOWUPS](../FOLLOWUPS.md):7의 L1. 토스의 알고리즘·정확도는 비공개다. |
| B3 | 조회 사유 수취 | 동등 | [policy-proxy README](../../services/policy-proxy/README.md):50, [system-prompt.ts](../../services/agent-server/src/system-prompt.ts):7. 읽기·쓰기 모두 사유를 서버에서 검사하고 누락/짧은 사유는 428; E2E A. 5자 기준 자체가 토스와 같다는 뜻은 아니다. |
| B4 | 다운로드 파일 암호화 | 없음 | [policy-proxy README](../../services/policy-proxy/README.md):52, [policy.ts](../../contracts/src/policy.ts). 현재는 JSON만 허용하고 비 JSON은 차단한다. 파일 생성/암호화/키 전달/다운로드 UI·계약이 없다. 조회 마스킹과 서로 다른 요구다. |
| B5 | 호출 기록·감사 증적 | 부분 | [server.ts](../../services/policy-proxy/src/server.ts):85–88, [policy-proxy README](../../services/policy-proxy/README.md):189. 허용/거부 JSONL 및 사용자별 조회는 있으나 내구성·외부 변조 방지·보존/검색·분산 수집은 없다. 토스의 저장 매체/보존 정책은 비공개다. |

### 프리뷰 런타임 (C1–C8)

| ID | 토스 기능·A의 절 위치 | 판정 | TOI-lite 근거와 차이 |
|---|---|---|---|
| C1 | 4계층 VFS와 우선순위 / 브라우저에는 파일 시스템이 없어요 | 동등 | [vfs.ts](../../packages/preview-runtime/src/vfs.ts):14. user > project > template > runtime 병합; 스튜디오 통합은 project 층만 전달하므로 네 층 편집 UI까지 대응하는 것은 아니다. |
| C2 | 상대/index 경로와 tsconfig paths / esbuild-wasm으로 번들 만들기 | 부분 | [vfs.ts](../../packages/preview-runtime/src/vfs.ts):48, [worker.ts](../../packages/preview-runtime/src/worker.ts):25–36. 상대/확장자/index/명시 JSON은 지원, tsconfig alias·CSS/assets 호환 계층은 없다. |
| C3 | Web Worker로 메인 스레드에서 빌드 분리 / 같은 절 | 동등 | [worker.ts](../../packages/preview-runtime/src/worker.ts):15–18. 자체 Worker에서 worker:false로 초기화한다. 토스 예시의 worker:true와 API 모양은 다르지만 WASM은 둘 다 Worker 실행이다. |
| C4 | esbuild-wasm의 TS/JSX → ESM 앱 번들 / 같은 절 | 동등 | [worker.ts](../../packages/preview-runtime/src/worker.ts):20–40. 앱 그래프만 bundle, 패키지는 별도 공급한다. |
| C5 | import-map key만 external, 미등록 import 실패 / 같은 절 | 동등 | [vfs.ts](../../packages/preview-runtime/src/vfs.ts):44, [worker.ts](../../packages/preview-runtime/src/worker.ts):25–31. exact own-key 확인. 계산식 dynamic import의 임의 통신 차단까지 보장하지 않는다. |
| C6 | HMR 대신 전체 문서·iframe 교체 / 3️⃣ 화면에 보여 주기 | 동등 | [index.ts](../../packages/preview-runtime/src/index.ts):84–116, [frame.ts](../../packages/preview-runtime/src/frame.ts). 새 realm을 만들므로 React 상태/전역 값은 보존하지 않는다. |
| C7 | 빌드·초기 실행 실패 시 마지막 정상 화면 유지·오류 표시 / 같은 절 | 동등 | [index.ts](../../packages/preview-runtime/src/index.ts):96–126. E2E B/I, [QA3](../qa/qa3/QA3-REPORT.md):75–85. source map 기반 원본 위치까지 표시하지만 초기 2 rAF 이후 오류 자동 롤백은 없다. |
| C8 | 성공한 최신 화면만 커밋 / 같은 절 | 다름(의도적 개선) | [guard.ts](../../packages/preview-runtime/src/guard.ts):2–12. project/revision/attempt/sourceDigest/manifestDigest 및 취소 전체 검증을 명문화; E2E C. 토스의 정확한 경합 토큰 설계는 비공개다. |

### 의존성 공급 (D1–D8)

| ID | 토스 기능·A의 절 위치 | 판정 | TOI-lite 근거와 차이 |
|---|---|---|---|
| D1 | 인증된 사내 registry, 브라우저에 인증정보 비노출 / Sandpack, 조합을 만들고 사용하기 | 동등 | [installer.ts](../../services/deps-builder/src/installer.ts):30–47, [deps-builder README](../../services/deps-builder/README.md):54. 실제 인증 Verdaccio, 서버 Yarn 설치만 토큰 보유. 사내 실제 인증체계는 다르다. |
| D2 | entries+lockfile 기반 16-hex Package Set Hash / 조합에 이름 붙이기 | 다름(의도적 개선) | [hash.ts](../../services/deps-builder/src/hash.ts):10–16. 원식 tossPackageSetHash 유지, 실제 artifactKey는 빌드 환경 지문까지 포함한 SHA-256. |
| D3 | 조합별 Yarn 설치·사전 빌드 / 조합을 만들고 사용하기 | 다름(의도적 개선) | [installer.ts](../../services/deps-builder/src/installer.ts):30, [bundle.ts](../../services/deps-builder/src/bundle.ts):22–42. Yarn 실제 설치는 같고 토스 Vite 대신 esbuild multi-entry/splitting을 사용한다. 범위가 좁은 JS 카탈로그에서 구현 비용을 줄인 선택이다. |
| D4 | S3에 조합 산출물 저장 / 같은 절 | 동등 | [store.ts](../../services/deps-builder/src/store.ts):9–29. S3 호환 MinIO에 실제 객체 저장. 클라우드 내구성/리전/CDN 운영의 동등함은 평가하지 않는다. |
| D5 | import map으로 브라우저 패키지 연결 / Import Map으로 패키지 제공하기 | 동등 | [builder.ts](../../services/deps-builder/src/builder.ts):109–112, [frame.ts](../../packages/preview-runtime/src/frame.ts). manifest.importMap을 frame에 삽입한다. 별도 importmap.json 대신 manifest 본문에 포함한다. |
| D6 | 조합 내부 React singleton / 의존성은 패키지 개별 단위로 나뉘지 않아요 | 동등 | [bundle.ts](../../services/deps-builder/src/bundle.ts):38–41. shared chunk와 중복 React 검출; E2E `F: 사내 useToast와 앱 React 인스턴스 공유`. 모든 타사 singleton을 검증한 것은 아니다. |
| D7 | 프로젝트별 조합·같은 조합 재사용·HTTP 캐시 / 모든 프로젝트에 조합 하나로는 부족해요, 조합을 만들고 사용하기 | 동등 | [builder.ts](../../services/deps-builder/src/builder.ts):48–63, [deps-builder README](../../services/deps-builder/README.md):40. 요청 색인, exact/range 재해석, immutable 자산. packageSet 편집 UI는 없다. |
| D8 | 동시 publish 원자성·객체 무결성·분산 lock 상세 | 확인 불가(토스 비공개) | A / 조합을 만들고 사용하기는 업로드 순서/원자성 세부를 공개하지 않는다. 우리 [builder.ts](../../services/deps-builder/src/builder.ts):98–120은 파일 재읽기 해시 확인 후 manifest-last, 프로세스 내 single-flight. 구현 부재를 토스에 추정하지 않는다. |

### 저장·개발/배포 연동 (E1–E8)

| ID | 토스 기능·출처 위치 | 판정 | TOI-lite 근거와 차이 |
|---|---|---|---|
| E1 | 편집 소스는 S3 갱신, VFS는 메모리 / [W 17:21](https://www.youtube.com/watch?v=xDVbTlFfu30&t=1041s) | 부분 | [store.ts](../../services/agent-server/src/store.ts):27–51. 로컬 JSON+rename+CAS 영속화. 의존성 MinIO 저장을 **소스 S3 저장**으로 혼동하면 안 된다. |
| E2 | Git repo 연결 / [W 1:20:13](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4813s) | 없음 | [server.ts](../../services/agent-server/src/server.ts):45–112, [generation.ts](../../contracts/src/generation.ts):45–68의 제공 API에 Git 연결은 없다. 이 구현 자체가 Git 저장소에 있는 것과 제품 Git 연동은 다르다. |
| E3 | PR·컨펌·개발자 리뷰 / [W 1:20:26](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4826s) | 없음 | 위 API 및 [main.tsx](../../apps/studio/src/main.tsx):27–42에 리뷰 workflow 없음. 소스 CAS와 write 테스트 토글은 PR 승인이 아니다. 토스의 모든 변경에 리뷰가 강제되는지는 비공개다. |
| E4 | 릴리즈 가능한 앱 / [W 1:19:28](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4768s) | 없음 | [generation.ts](../../contracts/src/generation.ts):5–16의 Project는 source revision만 가진다. immutable release record, promotion, rollback UI/API는 없다. |
| E5 | 라이브 어드민 배포·운영 / [E 03:28](https://www.youtube.com/watch?v=tcGKZANuUVE&t=208s) | 없음 | [ARCHITECTURE](../ARCHITECTURE.md):23–49는 로컬 개발 서비스/프리뷰 토폴로지. live capability enum은 배포 기능이 아니며 실제 배포 대상·절차는 없다. 토스의 배포 인프라 상세도 비공개다. |
| E6 | MCP 제공 / [W 1:22:24](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4944s) | 없음 | [generation.ts](../../contracts/src/generation.ts):62의 내부 모델 tools는 MCP 서버가 아니다. MCP transport/tool catalog/인증 경로가 없다. |
| E7 | Git 기반 관리·GitOps / [W 1:22:33](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4953s) | 없음 | [server.ts](../../services/agent-server/src/server.ts):45–112. webhook/reconciler/repo 상태 동기화가 없다. 토스의 구체적 GitOps 동작은 비공개다. |
| E8 | 큰 어드민의 TOI 이관 지원 / [W 1:22:21](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4941s) | 없음 | [schema.ts](../../services/agent-server/src/schema.ts), [main.tsx](../../apps/studio/src/main.tsx):27–35. 프로젝트 생성/소스 저장은 있으나 repo import·경로/패키지 분석·이관 workflow가 없다. |

### 디자인·실제 사용 (F1–F6)

| ID | 토스 기능·출처 위치 | 판정 | TOI-lite 근거와 차이 |
|---|---|---|---|
| F1 | 사내 TDS와 디자인 맥락 / [W 1:21:55](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4915s) | 부분 | [fake-tds README](../../packages/fake-tds/README.md):3, [system-prompt.ts](../../services/agent-server/src/system-prompt.ts):8. 6개 export의 작은 대체물. 실제 TDS의 토큰·컴포넌트 규모·접근성·브랜드 품질은 비교하지 못했다. |
| F2 | 테이블·필터·상세 패턴 제공 / [E 04:43](https://www.youtube.com/watch?v=tcGKZANuUVE&t=283s) | 부분 | [templates.ts](../../services/agent-server/src/templates.ts):34–108. 고객 목록/ID 상세/상태 변경, loading/empty/error는 있다. 일반 필터·정렬·페이지네이션/다중 페이지 패턴 카탈로그는 없다. |
| F3 | 실제 모델을 통한 코드 생성 / [E 02:26](https://www.youtube.com/watch?v=tcGKZANuUVE&t=146s) | 부분 | [agent-server README](../../services/agent-server/README.md):16,65–91. Claude driver 코드는 있지만 실제 호출 E2E는 없고 현 서비스는 mock. 토스 TOI의 모델명·버전·프롬프트·평가는 비공개다. |
| F4 | 여러 사용자의 독립 편집 / A / Dev Server | 부분 | [index.ts](../../packages/preview-runtime/src/index.ts):84, [store.ts](../../services/agent-server/src/store.ts):43–51, E2E E/L. 브라우저 격리·두 탭 충돌/복원은 있으나 다수 사용자 identity/프로젝트 membership/분산 동시성은 검증하지 않았다. |
| F5 | 약 440 프로젝트·120 라이브 / [E 03:12–03:34](https://www.youtube.com/watch?v=tcGKZANuUVE&t=192s) | 없음 | [QA3](../qa/qa3/QA3-REPORT.md):100–118은 mock 17케이스×3 반복. TOI-lite에는 실제 운영 프로젝트/라이브 서비스 규모 증거가 없다. A 도입의 439 프로젝트·2,418 페이지는 별도 시점/정밀도의 수치다. |
| F6 | 사내 사용자 인증/SSO의 상세 | 확인 불가(토스 비공개) | 사내 서비스 맥락은 A 도입에서 확인되지만 제공 자료는 SSO protocol/세션·위임 방식을 특정하지 않는다. 우리 [policy-proxy README](../../services/policy-proxy/README.md):185는 dev bootstrap이며 SSO·membership 미구현을 명시한다. |

## 2. 아키텍처 차이와 트레이드오프

같은 문제를 다르게 푼 선택은 아래와 같다. 토스가 설명하지 않은 내부 처리를 우리만 가진 기능으로 단정하지 않는다.

| 문제 | 공개 TOI → TOI-lite 선택 | 이유·이득 | 비용·남은 한계 |
|---|---|---|---|
| 조합 식별과 재현성 | entries+lock 16자리 → 원식 보존 + buildProfile 포함 artifactKey | 빌드 도구 버전·target·조건·설정·registry namespace 변경 시 같은 lock의 다른 결과를 분리한다. [hash.ts](../../services/deps-builder/src/hash.ts):10 | 키/manifest가 복잡해지고 캐시 분산이 늘어난다. 입력 해시는 결과 바이트 무결성 검증을 대신하지 않는다. 토스는 비공개 배포 namespace로 보완할 수도 있다(추정). |
| 사전 빌드 범위 | Yarn+Vite → Yarn+esbuild splitting | 작은 JS 중심 graph에서 명시적인 shared chunk 생성. [bundle.ts](../../services/deps-builder/src/bundle.ts):38 | 일반 CSS/assets·다양한 exports·플러그인 생태계 호환성을 직접 다뤄야 한다. Vite 대비 전반적 성능 우위 실험은 하지 않았다. |
| 화면 경합 | 성공 최신 화면 → 전체 revision guard와 즉시 의도 무효화 | 의존성 준비가 늦는 동안에도 과거 후보를 무효화한다. [controller.ts](../../apps/studio/src/controller.ts):256, [guard.ts](../../packages/preview-runtime/src/guard.ts):2 | 최신 요청이 실패하면 더 오래된 성공 결과도 폐기한다. 사용자에게는 이전 **커밋** 화면이 유지되며 API 부작용은 롤백하지 않는다. 토스의 경합 구현은 비공개다. |
| 빌드 Worker 수명 | 글의 build() 예시 → 전용 Worker/context 유지·직렬 rebuild | 엔진 준비와 문맥 재사용, VFS 요청 혼선 방지. [worker.ts](../../packages/preview-runtime/src/worker.ts):6–9,40,48 | 오래 걸리는 한 번들이 뒤 요청을 지연시킬 수 있다. 토스가 실제로 context/rebuild를 쓰는지는 예시만으로 확정할 수 없다. |
| preview write 부작용 | 프록시 정책 → read 기본·짧은 TTL·API 범위 write capability | 생성 UI가 editor 세션을 가지지 않는다. [controller.ts](../../apps/studio/src/controller.ts):235–253, E2E D/H | 토큰은 frame 코드에서 읽을 수 있다. 서명된 project/env가 실제 membership나 데이터 환경 분리를 만들지는 않는다. 토스의 preview 권한 기본값은 비공개다. |
| 브라우저 권한 경계 | Sandpack의 CORS/PNA 문제 → 별도 origin과 서버 Origin 거부 | frame은 /proxy만 접근, 메시지는 origin+source+token 검증. [policy server](../../services/policy-proxy/src/server.ts):97, [runtime](../../packages/preview-runtime/src/index.ts):119 | HTTP localhost 전제, Origin 없는 서버 요청은 별도 정책에 맡긴다. CSP/프로젝트별 origin/SSO는 남았다. CORS는 인증이 아니고 iframe은 악성 코드의 CPU·데이터 유출 완전 격리가 아니다. |
| 저장/부분 업로드 | S3 업로드 → 객체 재읽기 해시 검증 후 manifest-last | 준비 중 산출물을 ready로 노출하지 않는다. [builder.ts](../../services/deps-builder/src/builder.ts):101–113 | 단일 프로세스 예약뿐이다. 객체 storage timeout/cleanup 실패, replica 경합은 [FOLLOWUPS L5·운영](../FOLLOWUPS.md):10,15. 브라우저는 각 ESM 해시를 별도 검증하지 않는다. |
| 실패 원인과 복구 | 공개 글의 오류 overlay → input/registry/storage/internal 코드와 동일 revision 재시도 | 잘못된 버전과 실제 저장소 장애를 구분한다. [security.ts](../../services/deps-builder/src/security.ts):12–26, [QA3](../qa/qa3/QA3-REPORT.md):40 | health probe는 설치 실패 이후 관측이라 완전한 근본 원인 분석이 아니다. 토스에 같은 진단이 없는지는 모른다. |
| 다른 탭 복원 | 토스 프로토콜 비공개 → active generation 발견+seq replay+CAS 보관본 | 새 탭에서 질문 발견/답변·취소 동기화, 중복 생성 요청 차단. [controller.ts](../../apps/studio/src/controller.ts):114–167, [generation.ts](../../contracts/src/generation.ts):53–57, E2E G/J/L | 서버 재시작 시 진행 모델은 재개하지 않고 실패 종결한다. multi-instance CAS나 협업 CRDT가 아니다. |

> preview write 부작용 항목 — 이후 변경(7665546, R3-M2): frame에는 토큰이 없고 @toi/fetch는 스튜디오 브로커로 요청한다. 멤버십·환경은 policy-proxy가 매 요청 검증한다.

기존 [astra-critique](../../astra-critique.md)의 관점도 유지한다. 패키지별 ESM 자체가 원리적으로 불가능한 것은 아니며 peer external과 일관된 해석 manifest로 singleton을 지킬 수도 있다. 조합 빌드는 의존성 호환성 검증을 묶기 쉽지만 조합이 늘면 중복 바이트·빌드·GC 비용이 커진다. 어느 쪽이 운영상 유리한지는 실제 조합 분포/재사용률이 필요하다.

## 3. 성능 비교

측정 결과와 조건은 아래에 정리한다. 원시값은 [bench/results.json](bench/results.json), 실행 코드는 [bench/run.mts](bench/run.mts)다.

### 토스 공개 수치의 정의

토스는 **페이지 진입 후 Sandpack 프리뷰 47초**, 자체 Preview Runtime의 **첫 화면 1.3초**를 보고했다. 패키지는 미리 조합 빌드·업로드하고 프리뷰에서 가져온다고 설명한다. 따라서 새 조합 설치/사전 빌드를 모두 포함하는 cold-miss보다 **준비된 조합의 첫 화면**이 가까운 비교 대상이다. 정확한 타이머 경계까지 같다고 볼 수는 없다. [A / Sandpack 및 47초에서 1.3초로](https://toss.tech/article/52885).

| 조건 | 공개된 것 | 공개되지 않은 것 |
|---|---|---|
| 시작·끝 | 페이지 진입/Preview 첫 화면이라는 사용자 관점 | navigationStart인지 mount/런타임 호출인지, paint/DOM/commit 중 무엇인지 |
| 의존성 | Sandpack에서 진입 시 다운로드, 새 런타임은 사전 준비 조합 사용 | 패키지 버전·개수·바이트·앱 크기·조합 cache hit율 |
| 환경 | 브라우저 앱 빌드, Worker, S3+import map | 기기/브라우저/CPU/네트워크/CDN 위치·압축·캐시 상태 |
| 통계 | 47초와 1.3초 결과 | 표본수, 중앙값/평균 여부, p95, 분산, 실패율, warmup |

### TOI-lite 재측정

시스템 Chrome **153.0.8010.36** headless, Apple M4/macOS arm64, Node **22.14.0**, viewport 1600×1000. 6개 trial을 순차 실행했고 E2E는 동시에 실행하지 않았다. 각 trial은 동일한 미리 저장된 앱(20개 정적 마스킹 고객 행, private `@toi/tds` Table), 스튜디오 기본 6 entries/5 dependencies로 miss → hit → edit를 측정했다. React/ReactDOM 19.3.0, @toi/tds·@toi/fetch 1.0.0이며 React Query 요청은 `^5.0.0`이다. [실행 중 Yarn cache 관측](bench/dependency-observation.json)에서는 React Query/query-core 5.102.8, scheduler 0.28.0을 확인했다. 범위 버전은 향후 재실행에서 달라질 수 있다.

단위 **ms**, 표시는 소수 첫째 자리, 중앙값은 원시 부동소수 3개를 정렬한 가운데 값이다.

| 네트워크 | 시나리오 | 1회 | 2회 | 3회 | 중앙값 |
|---|---|---:|---:|---:|---:|
| 로컬·인위적 제한 없음 | 기존 프로젝트 열기 → 첫 커밋, 조합 hit | 790.4 | 859.9 | 789.4 | **790.4** |
| 로컬·인위적 제한 없음 | 기존 프로젝트 열기 → 첫 커밋, 새 조합 miss 포함 | 2946.8 | 2912.2 | 2893.5 | **2912.2** |
| 로컬·인위적 제한 없음 | 수정/저장 시작 → 다음 커밋 | 84.1 | 90.5 | 86.0 | **86.0** |
| CDP 느린 연결 | 기존 프로젝트 열기 → 첫 커밋, 조합 hit | 26175.7 | 26129.3 | 26149.3 | **26149.3** |
| CDP 느린 연결 | 기존 프로젝트 열기 → 첫 커밋, 새 조합 miss 포함 | 28123.3 | 28133.8 | 28331.6 | **28133.8** |
| CDP 느린 연결 | 수정/저장 시작 → 다음 커밋 | 1744.1 | 1739.8 | 1738.5 | **1739.8** |

최종 **18/18개 시나리오 측정 성공**, 6개 trial마다 최초 POST **202**, hit **200**, 수정 시 재확인도 **200**. trial마다 실제 install **1회**, bundle **1회**를 기록했다. 실패/timeout을 표에서 성공값으로 바꾸지 않았다. 정식 실행 전 계측 코드의 tsx `__name` 오류로 실패한 2개 점검 기록은 [첫 timeout](bench/failed-probe.json), [원인 확인 후 중단](bench/failed-probe-2.json)에 따로 보존했다. 최종 원문 JavaScript 계측에서는 이 오류가 없었다. 이 점검들은 WASM/OS 등에 사전 실행 영향을 남길 수 있고 이를 비우지 않았으므로 완전한 머신 cold라고 부르지 않는다.

| 측정 조건 | 이번 CMP1 |
|---|---|
| 시작 | 저장된 기존 프로젝트 `/?project=…` URL navigation의 `performance.timeOrigin` |
| 끝 | runtime이 iframe을 교체한 뒤 controller의 새 lastCommit을 동기 subscriber가 관찰한 시각; frame의 초기 성공 검사와 2 rAF 포함 |
| 포함 | HTML/스튜디오 JS·CSS, dev session, project GET, package 요청/준비, capability 발급, Worker JS·WASM 준비, bundle, frame HTML/JS·import-map ESM 평가 |
| 제외 | 서비스 기동·npm 설치·fixture 소스 저장 준비, 모델 생성/채팅 시간, 실제 업무 API 조회, 인간 타이핑 |
| hit 브라우저 | 매회 새 browser context + `Network.clearBrowserCache`; 새 Worker. Chrome 프로세스·OS/DNS/WASM compile cache는 강제 초기화하지 않음 |
| miss 저장소 | 실제 빌더 구현을 원 포트 7100에 띄우되 trial별 빈 MinIO bucket·Yarn cache/workspace·프로세스 내 상태; 기존 서비스 bucket/cache는 보존 |
| 수정 | 같은 context/Worker/esbuild context와 정상 HTTP/module cache 유지. controller.edit/saveFiles에서 시작, CAS 저장+조합 확인+capability+새 frame까지 포함 |
| 느린 연결 | QA1과 동일한 CDP latency **400ms**, down **750,000B/s**, up **250,000B/s**. 서버→Verdaccio/MinIO는 로컬 무제한 |
| 배포·외부 요청 | 개발 서버의 **무압축, no-store** JS/CSS/WASM. 원래 Google Fonts CSS/폰트 외부 요청도 유지; local은 인위적 throttling 없음의 의미 |
| 관측 한계 | 2 rAF는 paint 대리 지표, 실제 compositor paint 보증 아님. 3회는 p95·분포·일반적인 배수의 근거로 부족 |

느린 hit에서 Worker가 받는 `/esbuild.wasm`은 **13,978,850 bytes**이며 다운로드가 약 **19초**였다. down 750,000B/s에서 payload 전송만 약 **18.64초**라는 하한과 일치한다. 따라서 page CDP 제한이 Worker 요청에도 실제 적용됐음을 확인했다. 조합 hit는 **의존성 사전 빌드** 비용을 제거하지만 **엔진/앱 자산의 브라우저 최초 다운로드**를 제거하지 않는다. 이 구현의 WAN 첫 화면에서는 작은 앱의 rebuild보다 WASM 전송이 지배적이었다. [원시 Worker Resource Timing](bench/results.json), [개발 서버 무압축/no-store](../../apps/studio/scripts/dev.mjs):16.

느린 수정은 WASM을 다시 받지 않아 약 1.74초다. 이를 모델 응답 시간 또는 전체 채팅 생성 시간으로 해석하면 안 된다. local hit 0.79초가 수치상 토스 1.3초보다 짧아도 기기/앱/전송/캐시 정의가 같지 않아 토스보다 빠르다거나 동일 결과를 재현했다고 주장할 수 없다. 실제 배포의 압축/CDN/엔진 캐시 전략을 바꾸면 달라질 수 있지만 이번 작업에서 변경·측정하지 않았다.

### 기존 bench/의 Sandpack 비교

기존 [bench/README.md](../../bench/README.md):1–50과 [results.json](../../bench/results.json)을 그대로 인용했다. 이번 CMP1에서 Sandpack을 다시 실행하지 않았다.

| 기존 bench, ms | 1회 | 2회 | 3회 | 중앙값 |
|---|---:|---:|---:|---:|
| Sandpack cold 첫 화면 | 1075.9 | 885.4 | 917.9 | **917.9** |
| TOI-lite cold, 조합 miss 포함 | 2325.1 | 1942.1 | 2069.4 | **2069.4** |
| TOI-lite warm, 브라우저 캐시 비움 | 397.3 | 386.9 | 396.6 | **396.6** |
| TOI-lite 수정 → 커밋 | 114.8 | 114.3 | 131.4 | **114.8** |

| 조건 | 토스 47초 → 1.3초 | 기존 bench/ | 이번 CMP1 |
|---|---|---|---|
| 호스트 경계 | 페이지 진입/첫 화면, 상세 비공개 | host HTML/helper JS 준비 이후 provider/runtime 시작 | 실제 studio navigation부터 |
| 종점 | 첫 화면, 상세 비공개 | marker h1 표시 확인 + 추가 2 rAF | 제품 committed 이벤트 동기 관찰; runtime 자체 2 rAF 포함 |
| 앱/의존성 | 비공개 실제 사내 앱 | 20행, Sandpack 공개 React HTML table / TOI React+사내 Table | 같은 20행 사내 Table + 스튜디오 기본 react-query/fetch 조합 |
| 부가 API | 포함 범위 비공개 | project/session/capability 없음 | 기존 project GET, dev session, capability, source save 포함 |
| 네트워크 | 비공개 | Sandpack 원격 bundler/CDN vs TOI localhost, 무제한 | localhost 서비스 + 원래 폰트 외부 요청; 무제한/명시적 CDP 제한 |
| 저장소 캐시 | 새 TOI의 사전 준비 조합 설명 | TOI miss는 빈 bucket/Yarn; hit는 같은 산출물. 원격 Sandpack 서버 cache 통제 불가 | 같은 공개 구현·포트, trial별 빈 bucket/Yarn; hit와 edit는 직전 산출물 |
| 브라우저 캐시 | 비공개 | 새 context+HTTP clear; edit 유지 | 동일, 단 host 준비도 측정 포함 |
| 도구·기기 | 비공개 | Sandpack React 2.20.0, 기본 bundler origin 2-19-8; M4/Chrome 153 | M4/같은 Chrome 153, 현 스튜디오/런타임 |

기존 작은 앱에서는 **TOI miss 2069.4ms가 Sandpack 917.9ms보다 느렸다**. 반대로 TOI hit 396.6ms와 Sandpack cold를 비교해 설계 전체의 우열을 결론내리면 준비 시점이 다른 값을 섞게 된다. CMP1과 기존 TOI 값의 차이도 navigation/패키지/부가 API/종점이 달라 회귀로 판정할 수 없다. 토스 47초는 특정 실서비스 사례이고 모든 Sandpack 앱의 필연적 비용이 아니다.

## 4. 규모·운영 차이가 결론에 미치는 영향

토스 자료는 여러 사내 팀과 실제 업무 API를 대상으로 하는 제품의 사용 사례다. [E 03:12](https://www.youtube.com/watch?v=tcGKZANuUVE&t=192s), [W 1:21:23](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4883s). TOI-lite는 localhost 단일 사용자 개발 세션과 mock 고객 데이터, 결정적 mock agent에서 검증한 구현이다. 과제에서 제시한 “실서비스의 사내 SSO·실제 Claude급 모델”은 운영 기대 조건으로 취급하되, 제공 TOI 1차 자료에서 **SSO 구현·특정 Claude 모델을 직접 입증한 사실로는 쓰지 않는다**. 전체 웨비나의 다른 제품 세션에서 나온 Claude 발언도 TOI 모델 근거로 전용하지 않았다.

| 아직 검증하지 못한 것 | 현재 근거가 대신하지 못하는 이유 |
|---|---|
| 조직 identity·프로젝트별 membership·퇴사/권한 회수 | 로컬 사용자가 viewer/editor를 선택하는 dev session과 TTL은 SSO·조직 승인 체계가 아니다. |
| 실제 모델 품질·복잡한 스키마·수정 안정성·도구 선택·비용 | mock은 고정 질문과 고객 화면 분기다. 모델 driver 코드 존재는 실제 생성 성공률이 아니다. |
| 여러 사용자/수백 프로젝트의 p50/p95·동시 빌드 대기·hit 분포 | 두 탭 CAS와 3회 성능 표는 부하/장시간/대형 graph 검사가 아니다. |
| 분산 CAS·lease·replica failover·crash recovery | 로컬 파일 rename와 프로세스 내 Map은 분산 트랜잭션이 아니다. |
| 소스/이벤트/릴리즈 일관성·Git merge·승인·rollback | 현재 source save/revision_ready 뒤 프리뷰만 있고 배포 이력이 없다. |
| 실제 개인정보 정책과 다운로드 파일 전체 수명 | 합성 고객 JSON 마스킹은 모든 PII 유형/파일 암호화/키 회수 검증이 아니다. |
| 감사 내구성·보존·조사 가능성 | append-only API는 디스크 관리자 변조 방지나 fsync/외부 보관을 보장하지 않는다. |
| 인터넷/사내망·SSO 쿠키·HTTPS·CSP·브라우저별 보안 | 로컬 서로 다른 port 두 origin은 실제 cross-site·네트워크 경계와 다르다. |
| 패키지 공급망/악성 빌드·대규모 artifact 비용·GC | Verdaccio 작은 승인 카탈로그와 localhost MinIO는 운영 registry 권한·격리·회수 정책을 대신하지 않는다. |

[QA3의 51/51](../qa/qa3/QA3-REPORT.md):102는 17개 동일 mock E2E의 3회 반복이다. 기존 QA1/QA2의 발견 사항이 해결됐다는 근거이지, 토스 기능 전체 동등성·금융 실운영 적합성·실제 모델 정확도를 검증한 결과는 아니다. QA3 후 `b5e3786`의 간소화가 있어 이 보고서는 소스 근거를 현재 버전에서 재확인했고 QA3는 **이전 검증 기록**으로 명시하여 인용한다.

규모 수치는 재고 수량이다. 영상의 120/440 ≈ 27.3%를 제품 전환율로 해석하려면 cohort·기간·휴면/삭제·라이브 정의가 같아야 하는데 공개되지 않았다. 글의 439/2,418과 영상의 약 440/2,400도 오류라고 단정하지 않고 기록 시점·반올림 차이로 구분한다. 미릴리즈 프로젝트는 당시 회수하지 않았다는 [W 1:19:34](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4774s) 답변이 있으므로 자동 archive는 토스에 이미 있는 필수 동등 기능으로 계산하지 않는다.

## 5. 격차 점수와 우선순위

### 계산식

§1의 **40행**을 동일 가중치로 센다. `동등=1`, `부분=0.5`, `다름(의도적 개선)=1`, `없음=0`, `확인 불가=분모 제외`다. 영역 점수는 `100 × 가중점수 합 / 확인 가능한 행 수`, 격차는 `100 − 점수`다. 별도로 엄격 동등 비율은 `동등 행 수 / 확인 가능한 행 수`로 계산하며 의도적 차이는 여기에 넣지 않는다. 이는 요구사항의 구조적 대응 점수이며 개발 진척률·보안 인증·토스의 내부 품질 점수가 아니다. 미공개 항목을 0점 처리하지 않는다.

| 영역 | 동등 | 부분 | 의도적 차이 | 없음 | 확인 불가 | 가중합/분모 | 대응 점수 | 격차 | 엄격 동등 비율 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 생성·API A | 1 | 4 | 0 | 0 | 0 | 3/5 | 60.0% | 40.0% | 20.0% |
| 정책 B | 2 | 2 | 0 | 1 | 0 | 3/5 | 60.0% | 40.0% | 40.0% |
| 프리뷰 C | 6 | 1 | 1 | 0 | 0 | 7.5/8 | 93.8% | 6.3% | 75.0% |
| 의존성 D | 5 | 0 | 2 | 0 | 1 | 7/7 | 100.0% | 0.0% | 71.4% |
| 저장·배포 E | 0 | 1 | 0 | 7 | 0 | 0.5/8 | 6.3% | 93.8% | 0.0% |
| 디자인·실사용 F | 0 | 4 | 0 | 1 | 1 | 2/5 | 40.0% | 60.0% | 0.0% |
| **전체** | **14** | **12** | **3** | **9** | **2** | **23/38** | **60.5%** | **39.5%** | **36.8%** |

영역 백분율의 단순 평균 대신 행 전체를 합산했다. 의존성 100%는 **공개된 7가지 구조 대응**의 점수다. 비공개 D8과 운영 안정성·확장성·패키지 범위는 별도이며 production ready를 뜻하지 않는다. 민감도 참고로 의도적 차이를 각각 0.5점으로 낮추면 전체는 21.5/38 = **56.6%**다. 항목을 얼마나 잘게 나누는지에도 점수가 의존하므로 우선순위 판단에는 §4의 실운영 전제와 E영역의 큰 빈틈을 함께 봐야 한다.

### 토스 수준의 실사용 제품을 향한 우선순위

작업량 S는 한 서비스의 작은 변경, M은 한 기능의 설계·구현·통합, L은 여러 서비스/조직 시스템을 연결하는 단계다. 달력 일정이나 인원 투입 견적이 아니다. 순서는 운영 노출을 위한 전제와 사용자의 제품 여정을 고려했으며 기존 FOLLOWUPS의 low 심각도를 임의로 재분류하지 않는다.

| 우선 | 필요한 결과 | 작업량 | 필요 전제·완료 기준 | 중복/관련 과제 |
|---|---|---|---|---|
| P0-1 | 실제 identity·project membership·승인 권한과 preview/live 데이터 분리 | L | 사내 IdP·API owner·권한 모델, dev auth 제거, 사용자/프로젝트 간 접근 거부 검증 | [FOLLOWUPS 운영](../FOLLOWUPS.md):15; policy README:185–188 |
| P0-2 | 프리뷰 네트워크/임베드 경계와 서비스별 비밀 분리 | M | HTTPS origin·허용 자산/통신 origin 정의, CSP/frame-ancestors·프로젝트별 origin, egress 검증 | [L2·L6·L7·M2](../FOLLOWUPS.md):8–13 |
| P0-3 | 다운로드 파일 암호화와 감사 내구성 | L | 지원 파일형식·키 전달/보존·감사 저장소 owner 합의, 권한/암호화/만료/감사 실패 검사 | B4 신규; 운영 항목 확장. 토스 알고리즘 복제보다 조직 정책 충족이 기준 |
| P0-4 | 실제 모델·다양한 등록 API에서 생성/수정 평가 | M | 유효 모델 인증·비용 한도·허용 데이터, schema/tool/취소/실패/프롬프트 인젝션 평가셋 | [운영·M2](../FOLLOWUPS.md):13,15 |
| P1-1 | Git 연결 → PR 리뷰 → immutable release → 배포/rollback | L | repo app 권한·CODEOWNERS·배포 대상·승인 모델, 한 소스 revision에서 release provenance 추적 | [INTENT](../../intent/INTENT.md):28,38,60; 신규 E2–E5 |
| P1-2 | 소스/생성 이벤트 영속화와 분산 CAS·빌드 lease | L | DB/object storage 일관성 모델·retry/idempotency, replica 경합과 crash 주입 검증 | [운영](../FOLLOWUPS.md):15; E1/D8 |
| P1-3 | API 등록 UI·선택·스키마 버전/영향 분석 | M | API owner 및 schema 형식 합의, 여러 업무 API로 round-trip 생성 검증 | [INTENT](../../intent/INTENT.md):33,57; A4/A5 신규 |
| P1-4 | 무응답 storage·cleanup 및 큰 응답 상한 | S | timeout/취소 예산과 최대 응답 크기 확정, 지연/초과 fixture 검증 | [L4·L5](../FOLLOWUPS.md):9–10. L4의 sanitize 중복은 현 코드가 1회 호출이므로 잔여는 응답 상한 중심 |
| P1-5 | 실제 TDS와 테이블/필터/상세 패턴 | M | 사내 패키지/문서/디자인 접근, 접근성·상태·페이지 이동 포함 reference 앱 | F1/F2 신규 |
| P1-6 | WAN 첫 화면 예산·관측/압축/CDN·대형 graph 부하 | M | §3와 같은 계측, 실제 배포·기기/네트워크 cohort, 성공률과 p95 | [INTENT](../../intent/INTENT.md):59; §3 측정 후 결정 |
| P2-1 | MCP·GitOps·기존 repo 이관 | L | P1-1/2의 source/release 모델, MCP 권한/도구 스키마, 양방향 변경 충돌 기준 | E6–E8 신규 |
| P2-2 | 조합 GC·앱 inventory·archive/restore | M | owner/release/참조 관계·마지막 사용·보존 정책 | [운영·INTENT #8](../FOLLOWUPS.md):14–15. 토스 공개 당시 미회수와 구분 |
| P2-3 | 등록되지 않은 PII 탐지 보강 | S | 숫자·NFKC·필드 분할 샘플과 오탐 기준, 등록 스키마 경고 | [L1](../FOLLOWUPS.md):7. 규칙 마스킹 B2의 보완이며 완전한 의미 탐지가 아님 |

## 6. 토스 비공개로 확인할 수 없는 항목

다음은 “토스에 없다”가 아니라 제공된 공개 자료로 비교할 수 없다는 뜻이다.

| 범주 | 확인 불가 내용 | 공개된 경계 |
|---|---|---|
| 생성 | TOI 모델/버전·prompt·tool schema·temperature·평가 성공률·비용 | 채팅/역질문/플래닝/React 생성 흐름은 공개 |
| 스트림·협업 | SSE/WebSocket 여부·seq/replay/cancel·동시 편집·재시작 복구 | 사용자별 브라우저 실행 분리는 공개 |
| 데이터/인증 | SSO protocol·RBAC/ABAC·project membership·CSRF·API token 위임·preview read 기본 | 등록 API 프록시·정책 적용은 공개 |
| 보안 정책 | PII 탐지 정확도·마스킹 예외·파일 암호 알고리즘/키 전달·감사 보존/내구성 | 마스킹/사유/암호화/호출 기록 제공은 공개 |
| 런타임 | 자체 런타임의 origin/CSP/sandbox 헤더·정확한 revision token·지연 오류·side-effect 정책 | Worker/VFS/external/문서 교체/실패 시 정상 화면 유지 공개 |
| 조합 저장 | upload atomicity·manifest 검증·hash 충돌 처리·S3 권한·CDN/압축·분산 lock·GC | hash 입력·Yarn/Vite/S3/import map 구조 공개 |
| 소스/릴리즈 | 소스 버전 DB·CAS·백업/복구·PR 필수성·CODEOWNERS·배포 target/pipeline·rollback | S3 소스 갱신·Git 연결·PR 리뷰·라이브 존재 공개 |
| MCP/GitOps/이관 | tool 목록·transport·scope·reconciliation/충돌·지원 import 포맷 | 해당 기능 제공과 큰 어드민의 유입 발언 공개 |
| 성능·규모 | 동일 benchmark fixture·p50/p95·실패율·실사용자/동시성·프로젝트 크기·캐시 hit율 | 47초/1.3초, 약 440 프로젝트/120 라이브 공개 |

일반 금융사 관행이나 다른 웨비나 발표의 구현을 TOI 사실로 대신하지 않았다. §2의 대안 설계 해석과 §5의 작업량/우선순위는 이 저장소를 대상으로 한 판단·추정이다. 공개 TOI와 수치 조건이 같지 않으므로 **“토스 1.3초를 재현했다”는 결론은 내리지 않는다**.
