# F1 정책 경계 강화 검증 (2026-09-13)

C1/H1/H2/M1을 수정하고 원래 repro 01~03을 보존한 채 다시 실행했다. 실제 7200/7300은 gitignore된 루트 `.env`의 새 무작위 공유 upstream 키로 재시작했고, 누락되었던 5173/5174 개발 서버를 기동했다. 키·토큰 원문은 이 증거에 포함하지 않는다.

| 검증 | 결과와 증거 |
|---|---|
| C1: preview의 세션·capability·registry·audit 접근 | 서버 403, ACAO 없음, 토큰 발급 없음 — [01-02-assertions.out](01-02-assertions.out) |
| C1: text/plain 발급, 브라우저 admin, 프로젝트 없는 일반 감사 조회 | 각각 415, 403, 400 — 같은 출력 |
| H1: 운영 기본값·짧은 키·dev auth·admin token | 설정 가드 모두 기동 거부; 실제 main 종료 코드 1도 테스트 — [policy-tests.out](policy-tests.out) |
| H1: 저장소에 공개된 과거 기본키로 위조한 admin 세션 | 실행 중 :7200이 모든 위조 토큰을 401로 거부 — [01-02-assertions.out](01-02-assertions.out) |
| H2: 이중·삼중 인코딩 경로 탈출 | 400, upstream 요청 0건 — [03-assertions.out](03-assertions.out) |
| M1: Phone, contact.phone, phones 배열, phone 객체 | 모두 마스킹, 탐지 경로 및 unregistered_pii_field 감사 — 같은 출력 |
| M1: unmatched 규칙, 루트·중첩 문자열, 이메일·계좌·주민번호, 비 JSON PII | 경고·마스킹·비 JSON 502 및 감사 단언 통과 — [policy-tests.out](policy-tests.out) |
| 타입 검사 및 정책 테스트 | typecheck 통과, 기존 12개 거부 판정 포함 67/67 — [typecheck.out](typecheck.out), [policy-tests.out](policy-tests.out) |
| Chrome E2E A~F 3회 반복 | **18/18 통과 (42.8초)** — [e2e-repeat.out](e2e-repeat.out), [e2e-results.json](e2e-results.json), [스튜디오 화면](studio.png) |

E2E D는 정상 생성된 프리뷰 iframe에 악의적 생성 코드를 나타내는 별도 ES 모듈을 실행한다. 모듈은 Content-Type을 지정하지 않은 `fetch('http://localhost:7200/dev/session', {method:'POST', body:...})` 및 `/capabilities` 요청을 실제 Chrome에서 보내고 두 응답 모두 토큰을 얻지 못함을 검사한다. F2의 raw-fetch 저장 검사에 먼저 막혀 프록시 검증이 생략되지 않도록 iframe의 모듈 실행 경로를 직접 사용한다. 이어 viewer의 인증된 capability 요청 차단, read로 PATCH 차단, 호스트가 명시적으로 발급한 write capability로 PATCH 성공도 검사한다.

원래 스크립트 재실행 출력은 `*.original.out`에 있다. 01은 ACAO가 있을 것이라는 `grep` 가정에서 종료 코드 1로 중단되고, 02는 production 설정이 실제로 거부되어 종료 코드 1로 중단된다. 이것만으로 모든 공격을 검증했다고 보지 않고, 중단 이후 케이스까지 독립적인 단언 스크립트로 검증했다. 03 원본은 정상 종료하며 변경된 400과 마스킹 결과를 출력한다.

재실행(저장소 루트, 서비스 기동 상태):

```sh
node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/after/verify.mts
node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/after/03-assertions.mts
npm --prefix services/policy-proxy run typecheck
npm --prefix services/policy-proxy test -- --reporter=verbose
npm --prefix e2e run test:repeat
```

`policyWarnings`는 서비스 내부 선택적 `PolicyAuditRecord extends AuditRecord` 필드로 구현했고 계약 파일은 수정하지 않았다. Origin 없는 서버 간 호출과 스튜디오 Origin 발급은 유지된다. 개발 bootstrap은 실제 SSO·프로젝트 membership 검증을 대신하지 않으며 잔여 PII 정규식은 보조 탐지이므로 등록 정책·스키마 검토가 여전히 필요하다.
