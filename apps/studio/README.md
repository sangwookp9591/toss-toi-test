# TOI Studio

React 19 스튜디오가 채팅 생성, 파일 CAS 저장, 조합 빌드, 트랜잭션 프리뷰를 연결한다. 스튜디오 origin은 `http://localhost:5173`, 프리뷰 origin은 프로젝트 UUID마다 다른 `http://p-<projectId>.preview.localhost:5174`다.

## 실행

저장소 루트에서 `node scripts/dev-up.mjs`를 실행한다. 서비스가 이미 준비됐다면 이 디렉터리에서 `npm ci && npm run dev`만 실행할 수 있다. `npm run typecheck`와 `npm run build`로 정적 검증한다.

프로젝트를 만들고 “고객 목록 화면 만들어줘”를 보내면 조회 사유에 관한 질문이 표시된다. 답변 후 생성된 파일이 저장되고 정상 실행된 화면만 반영된다. 가운데 코드 편집 후 “저장하고 반영”을 누른다. 두 탭의 저장이 충돌하면 최신 내용 불러오기로 명시적으로 갱신한다.

## 구조와 이벤트

- `src/api.ts`: HTTP, SSE 스트림 파싱, seq 중복 제거, `Last-Event-ID` 재연결. 동일 페이지의 연결 단절과 새로고침 후 진행 중 생성을 복구한다.
- `src/controller.ts`: 프로젝트와 채팅 상태, CAS 저장, deps-builder ready 대기, 최신 의도 토큰, 프리뷰 이벤트를 관리한다. 새 요청은 의존성 준비 전에 이전 토큰을 무효화한다.
- `src/main.tsx`: 채팅/질문/취소, 파일 트리/코드 편집, 프리뷰/권한 토글/감사 기록 UI. `useSyncExternalStore`로 상태를 구독한다.
- `scripts/build.mjs`: 런타임의 공개 소스를 읽어 스튜디오 `dist/`에 Worker·frame·라이브러리를 빌드한다. 런타임 소스나 산출물 폴더를 수정하지 않는다.
- `scripts/dev.mjs`: 두 origin의 정적 파일 서버. `frame.html`은 런타임 구현을 그대로 사용한다. COOP/COEP 헤더를 설정하지 않는다.

`revision_ready` → deps-builder POST/long poll → source/manifest digest 확정 → `setDesiredRevision` → `build` 순서다. `committed`, `build_failed`, `runtime_failed`, `stale_discarded`를 사용자 문구로 표시하고 최근 커밋 시간을 보여 준다. 원시 이벤트와 세부 timings는 `window.studio.getSnapshot().events`에서 확인할 수 있다. 이 디버그 객체에는 세션·capability를 저장하지 않는다.

## 로그인과 토큰 보관

“Keycloak으로 로그인”을 누르고 `.env`의 `TOI_PASSWORD_ALICE` 등 사용자별 비밀번호를 입력한다. 계정은 alice·bob·carol·dana·root이며 비밀번호는 문서에 복사하지 않는다. “로그아웃”은 Keycloak SSO 세션을 종료하고 스튜디오 인증 상태를 지운다.

OIDC 클라이언트는 버전을 고정한 `oidc-client-ts@3.3.0`이며 Authorization Code + PKCE S256을 사용한다. 공개 설정은 `VITE_OIDC_ISSUER`(기본 `http://localhost:8080/realms/toi`), `VITE_OIDC_CLIENT_ID`(기본 `toi-studio`)다. 기존 esbuild 스크립트가 루트 `.env`와 프로세스 환경에서 이 두 Vite 형식 변수만 읽어 `import.meta.env`로 주입한다. client secret은 스튜디오에 필요하지 않다.

access·refresh·ID 토큰은 `InMemoryWebStorage` 기반 OIDC user store와 비공개 인증 객체 메모리에만 둔다. localStorage에 토큰을 쓰지 않는다. sessionStorage에는 리다이렉트 왕복에 필요한 일회용 PKCE verifier·state·nonce와 복귀 경로만 잠깐 저장하며 callback 처리 뒤 소비한다. 새로고침·새 탭은 Keycloak의 HttpOnly SSO 쿠키와 `prompt=none` 인증 코드 흐름으로 새 메모리 토큰을 얻는다. silent callback(`/?oidc=silent`)은 인증 코드 응답만 부모에 전달하며 토큰을 교환하거나 스튜디오를 렌더링하지 않는다. 따라서 Playwright storageState의 SSO 쿠키만으로도 새 탭을 복구할 수 있다. 브라우저가 이 SSO 쿠키 사용을 막거나 세션이 끝났으면 로그인 버튼을 안내한다. 토큰을 디스크에 지속하지 않아 탈취 가능한 저장 범위를 줄이지만 같은 스튜디오 origin의 악성 스크립트에 대한 방어를 대신하지는 않는다. [oidc-client-ts 저장소 설정](https://authts.github.io/oidc-client-ts/interfaces/UserManagerSettings.html)을 따른다.

모든 agent-server·policy-proxy 요청과 fetch SSE에 Bearer를 붙인다. 401이면 동시 요청이 하나의 갱신을 공유하고 원래 요청을 딱 한 번 재시도한다. 재실패나 갱신 실패에는 토큰과 프리뷰를 폐기하고 로그인 안내를 표시한다. builder에는 Keycloak 토큰을 보내지 않는다. 404에는 “이 프로젝트에 접근할 수 없어요. 멤버에서 제거되었거나 권한이 바뀌었을 수 있어요”, 403에는 권한 부족을 안내한다.

## 멤버와 live 승인

“멤버 · live 쓰기 승인”에서 프로젝트 소유자는 사용자 이름으로 멤버를 추가하고 owner(소유자)·editor(편집자)·viewer(조회자) 역할을 바꾸거나 제거한다. 마지막 소유자의 제거·강등은 서버에서 거부하며 화면에 이유를 표시한다. viewer는 조회 프리뷰만 사용할 수 있고 생성·소스 저장·쓰기 테스트·암호화 다운로드는 editor 이상이 필요하다.

프로젝트 owner는 API와 사유로 live 쓰기 승인을 요청한다. dana 같은 해당 API의 api-owner는 프로젝트 ID로 승인 요청을 조회하고 승인·거절한다. 요청자 본인은 승인할 수 없으며 승인 상태와 유효 기한을 표시한다. 승인은 live capability 발급의 전제이며 스튜디오 프리뷰를 live로 전환하지 않는다.

## 프리뷰 세션과 쓰기

스튜디오는 `POST /preview-sessions`로 현재 프로젝트의 하향 세션과 capability를 받아 비공개 메모리에만 보관한다. 프리뷰 `BuildInput.hostConfig.toiFetch`에는 `{ projectId, env, transport: "broker" }`만 전달한다. Keycloak·프리뷰 세션·capability 토큰은 frame 전역·DOM·postMessage·URL·storage·debug snapshot에 없다. `@toi/fetch@1.1.0`이 부팅 시 받은 부모 origin으로 요청하면 runtime이 frame 수명·origin·source·revision·동시성·속도를 확인하고 스튜디오가 API·쓰기·크기를 검증해 자격 증명을 붙인다. 만료된 읽기 세션은 브로커가 재발급하며 쓰기 만료는 기존 카운트다운과 사용자 재허용 흐름을 따른다.

“쓰기 테스트 허용”을 켜면 같은 endpoint에 현재 `apiIds`와 최대 120초 TTL의 `write`를 요청하고 새 하향 세션·capability로 재빌드한다. 끄면 조회 세션을 발급한다. 모든 프리뷰 capability의 환경은 preview이며 합성 upstream만 사용한다. viewer 세션은 직접 capability를 발급할 수 없다.

## 검증과 한계

통합 검증은 루트 `e2e/`에서 실행한다. `npm run typecheck`, `npm run build` 통과. E2E A–F는 생성·마스킹·사유·감사, 문법 오류 보존, 오래된 실행 폐기, 권한 경계, CAS, React singleton을 확인한다.

실제 사용자 인증과 프로젝트 권한은 서버가 판정한다. 로컬 HTTP 구성에서 실행하며 배포용 TLS·CSP 구성은 별도로 적용해야 한다. capability는 만료 후 쓰기를 자동 갱신하지 않으며, 다시 켜야 허용된다. 좁은 화면에서는 패널을 세로로 배치한다. 스크롤 바깥 iframe의 requestAnimationFrame 지연을 피하도록, 투명하고 inert인 candidate 프레임만 검증 중 뷰포트 안에 실제 프리뷰 크기로 배치한다. committed 이후에는 원래 프리뷰 영역으로 돌아간다. 이 스튜디오 CSS는 런타임의 `data-state="candidate"` 표시를 소비한다.

## QA1 복구와 오류 안내

진행 중 생성은 프로젝트별 `sessionStorage` 키 `toi-studio-generation-v1:<projectId>`에 generationId, 마지막 처리 seq, 대화, 미답변 질문, 진행 문구와 staging 파일을 함께 저장한다. 프로젝트를 다시 열면 저장한 UI를 복원하고 `GET /generations/:id/events`에 `Last-Event-ID` 헤더를 보내 해당 seq 이후부터 이어 받는다. EventSource는 임의의 헤더를 지정할 수 없으므로 기존 fetch 스트리밍 SSE 파서를 사용한다. 서버의 헤더 replay 계약을 소비한다. 답변 후 staging 이벤트에서 질문을 답변 완료로 바꾸고, done/failed/canceled에서는 저장값을 제거한다. 복구한 생성의 종결이나 404는 “진행 중이던 생성이 끝났어요: <결과>”로 안내한다. 탭 세션 종료 시 복구 기록도 끝나며, 브라우저가 저장을 차단하거나 용량이 가득 찬 경우 라이브 생성은 계속되지만 서버 전체 replay로 복원한다.

쓰기 capability를 발급받으면 서명된 응답 JWT의 `exp`를 읽어 실제 만료 시각과 남은 시간을 표시한다. 만료 시 토글을 끄고 “쓰기 허용 시간이 끝났어요. 다시 켜면 2분 동안 허용돼요.”를 남기며 같은 revision을 read capability로 재빌드한다. E2E는 페이지 로드 전에 `window.__STUDIO_TEST_CONFIG__ = { writeTtlSec: 4 }`를 주입할 수 있다. 기본값은 120초이며 이 설정은 1~120초로 줄이는 것만 허용한다. 토큰 원문은 상태 스냅샷이나 sessionStorage에 넣지 않는다.

빌드 진단은 파일·행·열·메시지 최대 5개와 “외 N건”으로 표시한다. 금지 import는 패키지 이름을 포함한 한국어 안내로 바꾸며 상태 바에서 문법 오류와 구분한다. 실행 실패도 runtime이 제공한 에러와 위치를 표시한다. 위치가 없는 진단은 위치를 만들어 내지 않고 메시지만 표시한다.

CAS 충돌에서 “최신 내용 불러오기”를 누르면 현재 미저장 파일들을 먼저 “내 편집 보관본”에 보관한다. 보관본은 파일별로 열고 복사할 수 있고, 프로젝트별 `toi-studio-backups-v1:<projectId>` sessionStorage에 저장하여 새로고침 후에도 같은 탭 세션 동안 유지한다. 여러 충돌의 보관본은 차례로 남는다.

조합 준비 실패 시 정상 commit 유무에 따라 “화면을 처음 준비하지 못했어요”와 “이전 화면을 유지했어요”를 구분한다. 프리뷰 영역과 상태 바의 “다시 시도”는 현재 프로젝트의 동일 revision·packageSet으로 조합 POST/long poll과 빌드를 다시 수행한다. 연결 실패, 서버 failed 응답, 잘못된 패키지/버전, 전체 90초 대기 시간 초과를 구분한다. 빌더 원문 오류의 내부 주소나 비밀이 노출되지 않도록 알려진 원인 범주만 표시한다.

## E2E QA1

`npm --prefix e2e run test:repeat`는 기존 A–F와 다음 검증을 각각 3회 실행한다.

- G: 질문 대기 중 새로고침 → 동일 대화·질문과 Last-Event-ID 복구 → 답변 → revision_ready. 복구 후 취소, 이미 종결된 생성 replay, 404 저장값 삭제도 확인한다.
- H: 짧은 실제 write TTL → 카운트다운 → 토글 off·만료 안내 → read capability 프레임 반영.
- I: 문법 오류 파일·행·열, axios 패키지 이름, runtime 오류 원인과 마지막 정상 프레임 보존.
- J: 두 탭 CAS 충돌 → 최신 불러오기 → 로컬 파일 보관·클립보드 복사·새로고침 유지.
- K: 새 프로젝트의 존재하지 않는 패키지 버전으로 실제 deps-builder 실패와 동일 revision 재시도. 별도 브라우저 라우팅으로 failed 응답·연결 실패·대기 시간 초과를 재현한 뒤, 정상 서비스로 복구하여 새로고침 없는 같은 revision commit 및 이전 화면 보존도 확인한다. 서비스 종료나 공용 캐시 삭제는 하지 않는다.
- 레이아웃: 1600px·400px에서 답변 버튼의 한 줄 높이·최소 너비·뷰포트 안 위치를 측정하고 스크린샷을 남긴다.


## QA2: 다른 탭과 외부 저장소 장애

프로젝트를 열 때 `GET /projects/:projectId/generations/active`로 서버의 최신 진행 중 생성을 확인한다. 서버와 sessionStorage의 generationId가 같고 seq가 유효하면 기존 checkpoint 이후부터 이어 받는다. 기록이 없거나 다르면 `Last-Event-ID` 없이 전체 SSE를 구독하고 활성 응답의 `prompt`를 첫 사용자 메시지로, text 이벤트를 assistant 메시지로 복원한다. `createdAt`은 생성 시작 ISO 시각이다. 기존 세션 기록만 남고 활성 생성이 없으면 기록의 SSE를 이어 받아 종결/404 안내를 유지한다.

다른 탭에서 찾은 생성은 “다른 창에서 진행 중인 요청이 있어요”를 표시하고 입력을 잠근다. 이미 열려 있던 탭도 보내기 직전에 서버를 다시 확인하여 기존 생성에 연결한다. 두 탭은 동일 SSE를 받으므로 어느 쪽에서 답변하든 `staging`에서 “답변이 반영됐어요”를 표시하고, 취소하면 양쪽 모두 종결 상태로 돌아간다.

deps-builder HTTP 오류와 `failed` 상태의 `code`를 우선 사용한다. `registry_unavailable`은 “패키지 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.”, `storage_unavailable`은 “구성 요소 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.”, `input`은 “패키지 또는 버전 확인 필요”, `internal`은 “구성 요소 빌드 실패”다. 코드 없는 구버전 응답은 기존 상태/오류 범주 처리를 유지한다. 재시도는 파일·revision을 바꾸거나 새로고침하지 않는다.

`runtime_failed.error`의 file/line/column도 빌드 진단과 동일한 공통 UI에서 `파일 · N행 M열`로 표시한다. 위치를 계산하는 주체는 preview-runtime이며 스튜디오는 제공된 위치를 사용한다.

E2E L은 새 탭과 stale checkpoint의 전체 대화·질문 복원, 답변 완료 동기화, 중복 생성 차단과 취소를 확인한다. M은 별도 builder 프로세스의 레지스트리 프록시에서 실제 Yarn HTTP 503 실패를 일으키고 복구 후 동일 revision 재시도를 확인한다. 메모리 산출물과 임시 Yarn 캐시를 쓰며 공용 레지스트리·MinIO·서비스 포트는 변경하지 않는다.

## 인증 E2E N–S

`npm run typecheck`, `npm test`, `npm run build`로 인증 상태·Bearer 주입·401 갱신 공유/재시도 상한·프리뷰 토큰 격리를 검증한다. `npm --prefix e2e run test:repeat`는 A–M과 N–S(비멤버 404, 멤버 역할/제거, 4-eyes 승인/만료, preview/live 분리, 계정 비활성화, 프리뷰 토큰 미전달)를 각각 3회 실행한다. 자세한 실행 조건과 비밀값 처리 규칙은 `e2e/README.md`를 따른다.

멤버십은 열린 프로젝트에서 30초마다, 창 포커스가 돌아올 때 확인한다. policy-proxy의 `404 PROJECT_NOT_FOUND`는 upstream 리소스 404와 구별하며, 접근 철회 시 프리뷰를 종료하고 편집·생성·저장을 잠근다. 생성·저장·멤버십 사용자 API의 404도 동일한 존재 비공개 안내를 표시한다. viewer의 암호화 다운로드 제한 사유는 패널에서 보이고 비활성 버튼의 `aria-describedby`에 연결한다.
