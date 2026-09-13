# TOI Studio

React 19 스튜디오가 채팅 생성, 파일 CAS 저장, 조합 빌드, 트랜잭션 프리뷰를 연결한다. 스튜디오 origin은 `http://localhost:5173`, 프리뷰 origin은 `http://localhost:5174`다.

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

## 세션과 쓰기

같은 사용자 sub에 editor+viewer 세션과 viewer 전용 세션을 별도 발급한다. editor 세션은 controller의 JS private field에만 두고 프리뷰에 보내지 않는다. 프리뷰에는 viewer 세션과 기본 read capability만 `BuildInput.hostConfig.toiFetch`로 전달한다. 프레임은 이를 동결된 `__TOI_FETCH_CONFIG__`로 주입한다.

“쓰기 테스트 허용”을 켜면 editor 세션으로 현재 프로젝트의 `apiIds`만 포함하는 120초 write capability를 발급한다. viewer 세션은 유지하고 capability만 교체해 새 프레임에 반영한다. 끄면 새 read capability로 반영한다. 화면 상태는 새 프레임에서 초기화된다. `POST /capabilities`를 viewer 세션으로 직접 호출하면 403이다.

## 검증과 한계

통합 검증은 루트 `e2e/`에서 실행한다. `npm run typecheck`, `npm run build` 통과. E2E A–F는 생성·마스킹·사유·감사, 문법 오류 보존, 오래된 실행 폐기, 권한 경계, CAS, React singleton을 확인한다.

로컬 실험용이며 `/dev/session`은 개발용 인증 경로다. 실제 사용자 인증·배포용 CSP·네트워크 격리를 제공하는 제품용 보안 경계는 아니다. capability는 만료 후 쓰기를 자동 갱신하지 않으며, 다시 켜야 허용된다. 좁은 화면에서는 패널을 세로로 배치한다. 스크롤 바깥 iframe의 requestAnimationFrame 지연을 피하도록, 투명하고 inert인 candidate 프레임만 검증 중 뷰포트 안에 실제 프리뷰 크기로 배치한다. committed 이후에는 원래 프리뷰 영역으로 돌아간다. 이 스튜디오 CSS는 런타임의 `data-state="candidate"` 표시를 소비한다.

## QA1 복구와 오류 안내

진행 중 생성은 프로젝트별 `sessionStorage` 키 `toi-studio-generation-v1:<projectId>`에 generationId, 마지막 처리 seq, 대화, 미답변 질문, 진행 문구와 staging 파일을 함께 저장한다. 프로젝트를 다시 열면 저장한 UI를 복원하고 `GET /generations/:id/events`에 `Last-Event-ID` 헤더를 보내 해당 seq 이후부터 이어 받는다. EventSource는 임의의 헤더를 지정할 수 없으므로 기존 fetch 스트리밍 SSE 파서를 사용한다. 서버의 헤더 replay 계약을 그대로 소비하며 agent-server 변경은 없다. 답변 후 staging 이벤트에서 질문을 지우고, done/failed/canceled에서는 저장값을 제거한다. 복구한 생성의 종결이나 404는 “진행 중이던 생성이 끝났어요: <결과>”로 안내한다. 탭 세션 종료 시 복구 기록도 끝나며, 브라우저가 저장을 차단하거나 용량이 가득 찬 경우 라이브 생성은 계속되지만 새로고침 복구는 보장하지 않는다.

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
