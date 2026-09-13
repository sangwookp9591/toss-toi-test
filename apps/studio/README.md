# TOI Studio

React 19 스튜디오가 채팅 생성, 파일 CAS 저장, 조합 빌드, 트랜잭션 프리뷰를 연결한다. 스튜디오 origin은 `http://localhost:5173`, 프리뷰 origin은 `http://localhost:5174`다.

## 실행

저장소 루트에서 `node scripts/dev-up.mjs`를 실행한다. 서비스가 이미 준비됐다면 이 디렉터리에서 `npm ci && npm run dev`만 실행할 수 있다. `npm run typecheck`와 `npm run build`로 정적 검증한다.

프로젝트를 만들고 “고객 목록 화면 만들어줘”를 보내면 조회 사유에 관한 질문이 표시된다. 답변 후 생성된 파일이 저장되고 정상 실행된 화면만 반영된다. 가운데 코드 편집 후 “저장하고 반영”을 누른다. 두 탭의 저장이 충돌하면 최신 내용 불러오기로 명시적으로 갱신한다.

## 구조와 이벤트

- `src/api.ts`: HTTP, SSE 스트림 파싱, seq 중복 제거, `Last-Event-ID` 재연결. 동일 페이지의 연결 단절을 복구한다.
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

로컬 실험용이며 `/dev/session`은 개발용 인증 경로다. 실제 사용자 인증·배포용 CSP·네트워크 격리를 제공하는 제품용 보안 경계는 아니다. capability는 만료 후 자동 갱신하지 않으므로 다시 반영하거나 토글해야 한다. SSE 연결 재시도는 페이지를 유지할 때 지원하며 페이지 새로고침 후 진행 중 generation 자동 재개는 구현하지 않았다. UI는 데스크톱 1280px 이상을 기준으로 한다.
