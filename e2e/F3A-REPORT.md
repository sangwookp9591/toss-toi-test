# F3-A — 프리뷰 자격 증명 제거와 브로커

2026-09-13. `@toi/fetch@1.1.0`을 로컬 Verdaccio에 게시했고 기본 packageSet을 갱신했다. 프리뷰 설정은 `{ projectId, env, transport: "broker" }`만 포함한다. 프리뷰 세션·capability는 StudioController의 비공개 메모리에 보관하고 만료 시 재발급한다. 쓰기 권한 만료 카운트다운·사용자 재허용은 유지한다.

## 내비게이션 유출 전후

| 검증 | 수정 전 | 수정 후 |
| --- | --- | --- |
| 프리뷰 자격 증명 위치 | `__TOI_FETCH_CONFIG__`와 load payload에 session/capability 토큰 | frame 설정·전역·DOM·storage·메시지에 실제 스튜디오 토큰 없음(AC, Keycloak 포함 S) |
| 실제 스튜디오 생성 코드 `location.href` | R3-M2가 읽을 수 있는 토큰의 쿼리 유출 가능성을 지적 | AD에서 실제 발급 토큰과 수신 쿼리를 Node 메모리에서 대조: credentialLeaks=0; frame 제거·revision 1 복구·한국어 안내 확인 |
| 최소 부모의 R3 재현 | `/exfil-location?d=SESSION.CAP.TOKENS` 1건 수신 | 바이트가 같은 스크립트의 합성 마커 1건 수신. 합성 마커를 실제 토큰으로 해석하지 않음 |
| 반복 내비게이션 | 제거·복구 감지 없음 | 1분 내 세 번째 이동이면 자동 복구 중단(런타임 브라우저 테스트) |

`docs/review/**`를 수정하지 않기 위해 원본 `p02-nav-egress.mjs`를 바이트 그대로 `artifacts/f3a-r3/`에 복사하여 실행했다. 원본 스크립트는 실제 토큰을 읽지 않고 상수 `SESSION.CAP.TOKENS`를 보낸다. 수정 후에도 이 상수는 최소 부모 환경에서 수신되므로 **내비게이션 자체를 완전히 봉쇄했다고 주장하지 않는다**. 실제 스튜디오는 부모의 `frame-src`도 유지하여 AD 수신 요청이 0건일 수 있고, 어느 경우에도 실제 세션·capability 토큰 유출은 0건이어야 한다. AC는 테스트 자체가 비밀을 frame에 전달하지 않도록 Node에서만 실제 값과 대조한다.

## CSP

| 항목 | 수정 전 | 수정 후 |
| --- | --- | --- |
| connect-src | `http://localhost:7200` | `'none'` |
| script-src | `'self' http://localhost:7100 data: 'nonce-…'` | `'self' http://localhost:7100 'nonce-…'` |
| 앱 번들 실행 | URI 인코딩 data module | nonce inline module의 `textContent`; `</script>`와 Unicode 보존 |
| 부트 인자·import map | JSON `<`·U+2028·U+2029 escape | 유지 |
| default-src / worker-src / object-src / form-action / base-uri | `'none'` | 유지 |
| style-src / img-src / font-src | self+inline style / data+blob image / data font | 유지 |
| frame-ancestors | 스튜디오 origin | 유지 |
| iframe sandbox | `allow-scripts allow-same-origin` | 유지 |
| 스튜디오 embedding | SAMEORIGIN, frame-ancestors self, 프로젝트 preview frame-src | 유지 |

헤더 CSP는 document.open 이후에도 유지한다. data:와 blob: module 차단 및 nonce module 성공을 실제 브라우저에서 검증했다. AE는 policy-proxy 직접 fetch의 CSP 차단과 브로커 성공을 함께 검사한다.

## 브로커 검증 규칙

| 규칙 | 구현과 검증 |
| --- | --- |
| frame 식별 | 현재 커밋 frame 또는 검증 중 후보의 contentWindow·프로젝트 origin·revision·attemptId 비교; 잘못된 token은 NOT_ALLOWED_SOURCE, 외부 source/origin은 무시 |
| 폐기·취소·내비게이션 | listener 제거, AbortController 취소, 늦은 응답 폐기; 단위 테스트와 AF |
| 부모 응답 | 부팅 시 동결한 부모 origin·parent source·requestId 일치만 처리; 단위 테스트 |
| 클라이언트 호환 | 공개 toiFetch/오류 타입 유지; 1.0.0 토큰 설정은 CLIENT_NOT_CONFIGURED; 응답 없음 30초 BROKER_TIMEOUT |
| 프로젝트 API | 프로젝트 apiIds allowlist, API_NOT_IN_PROJECT |
| 경로 | `/` 시작, `//`·역슬래시·fragment·제어문자 금지, URL 정규화 후 `/proxy/:apiId/` 접두사 유지 |
| 메서드·쓰기 | GET·POST·PUT·PATCH·DELETE만; 사용자 허용·유효 write capability·API 범위 확인; 미허용 403 WRITE_NOT_ALLOWED(AG) |
| 헤더 | Content-Type만 요청에서 전달; Authorization·X-Toi-Project·X-Toi-Capability·X-Toi-Env·X-Toi-Reason은 호스트가 구성 |
| 요청 크기 | 문자열 body ≤1 MiB UTF-8; 초과·비문자열 BODY_TOO_LARGE; 헤더 CR/LF와 비정상 reason 거부 |
| 동시성·속도 | frame당 진행 중 8건, rolling 1초 50건; 초과 429 TOO_MANY_REQUESTS(AH) |
| 응답 크기 | stream을 최대 5 MiB까지 읽고 초과 즉시 cancel, 413 RESPONSE_TOO_LARGE(AH) |
| redirect·오류 | upstream fetch redirect:error; 네트워크 예외는 UPSTREAM_UNREACHABLE로 정제 |
| 직접 preview 요청 | F3-B 서버 변경: 모든 경로 403 PREVIEW_DIRECT_FORBIDDEN, CORS 없음(Z) |

## 실행 증거

- Verdaccio: `Published @toi/fetch@1.1.0; anonymous metadata is blocked`.
- `node scripts/dev-up.mjs --e2e --restart`: 23.918초, 저장소 retention probe 포함 성공. F3-B 최종 코드 체크포인트 뒤 policy-proxy만 다시 재기동했다(`artifacts/f3a-dev-up-final.log`).
- 첫 1.1.0 packageSet 사용의 X 테스트는 로그인·두 프로젝트 생성·두 프리뷰 커밋을 합쳐 6.7초였다. cold 구성 요소 준비는 이 전체 시간 이하이며 기존 30초 expect/90초 의존성 대기를 넘지 않았다. 버전 변경은 lockfile 및 deps-builder 캐시 키에 반영된다.
- preview-runtime: typecheck 성공, 단위 40개 성공, 브라우저 26개 성공(`artifacts/f3a-runtime-browser.log`).
- studio: typecheck 성공, 단위 16개 성공. 별도 실제 브라우저 검증에서 첫 응답의 호스트 만료 메타데이터만 지난 시각으로 바꿨고, 동시 8개 요청이 실제 재발급 1회를 공유해 모두 200을 받았다(`scripts/f3a-broker-renewal.mts`, `artifacts/f3a-renewal.log`).
- agent-server: typecheck 성공, 119개 성공·기존 1개 skipped.
- scripts: 9개 성공, 변경 스크립트 Node syntax checks 성공.
- AF frame detach 관측은 Playwright 프로토콜 통지를 기다리도록 검증하며 별도 10회 반복 모두 성공했다(`artifacts/f3a-af-repeat.log`).
- 최종 통합 `npm --prefix e2e run test:repeat`: **117 passed (8.1m)**, 실패·flaky·skipped 0. 기존 A–AB 및 신규 AC–AH가 각각 3회 통과했다(`artifacts/f3a-repeat.log`, `artifacts/results.json`). AD의 세 회차 모두 `requests=0, credentialLeaks=0`이었다.

## 남은 위험

이미 렌더링되거나 브로커 응답으로 받은 **마스킹 데이터**는 생성 코드가 `location.href` 쿼리에 넣어 단방향으로 보낼 수 있다. frame 제거는 load 뒤에 작동하므로 이미 전송된 데이터를 회수하지 못한다. 이번 변경은 자격 증명을 프리뷰에서 제거하고 네트워크 브로커의 정책 경계를 강화한다. 스튜디오 origin 자체의 XSS나 사용자에게 허용된 데이터의 악의적 사용을 해결했다고 주장하지 않는다.
