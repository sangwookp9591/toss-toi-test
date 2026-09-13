# F3-A: 프리뷰 자격 증명 제거와 @toi/fetch 브로커 (R3-M2, R3-L2)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`. 서비스는 떠 있다(`node scripts/dev-up.mjs --e2e`).
- 반드시 읽을 것:
  - `docs/review/REVIEW-R3.md`의 R3-M2·R3-L2
  - `docs/review/repro/r3/p02-nav-egress.mjs`와 출력
  - `contracts/src/runtime.ts`: `PreviewHostConfig`, `FrameToHostFetch`/`HostToFrameFetch`, 프리뷰 서버·CSP 규칙
  - `contracts/src/policy.ts`: R3-M2 이후 CORS
  - `packages/preview-runtime/src/{index,frame}.ts`, `apps/studio/src/{preview-auth,controller}.ts`, `apps/studio/scripts/security.mjs`
  - `services/policy-proxy/client/toi-fetch.ts`, `services/policy-proxy/scripts/publish-client.mjs`
  - `services/agent-server/src/{templates,system-prompt,source-policy}.ts`
- 병렬 워커 F3-B(감사 앵커·retention, `docs/tasks/F3B-audit-anchor.md`)가 `services/policy-proxy/src/**`와 `scripts/storage.mjs`를 동시에 수정한다.

## Change
1. **frame에서 토큰 제거**: 스튜디오가 frame에 넘기는 `hostConfig.toiFetch`는 `{ projectId, env, transport: "broker" }`뿐이다. frame은 토큰 필드가 있으면 부팅을 거부한다.
2. **@toi/fetch 1.1.0** (`services/policy-proxy/client/toi-fetch.ts`, `publish-client.mjs`)
   - `toiFetch` 공개 API(apiId, path, init, 오류 타입)는 유지한다. transport broker일 때 `FrameToHostFetch`를 parent에 postMessage로 보내고 `HostToFrameFetch`로 Response를 만든다.
   - 부모 origin은 frame이 부팅 때 받은 스튜디오 origin만 쓴다. 응답은 origin·source·requestId로 검증한다. 시간 초과(30초)는 `ToiFetchError(0, 'BROKER_TIMEOUT')`.
   - 1.0.0 호환: 토큰 방식 설정이 오면 `CLIENT_NOT_CONFIGURED`로 거부한다.
   - Verdaccio에 1.1.0을 게시한다. 기본 packageSet(`templates.ts`)과 관련 fixture·테스트를 1.1.0으로 올린다. deps-builder 캐시 키가 바뀌므로 E2E의 cold 빌드 시간을 확인한다.
3. **호스트 브로커** (`packages/preview-runtime`: 메시지 수신·frame 식별·토큰 대조, `apps/studio`: 자격 증명 첨부·정책 판단)
   - `runtime.ts` 호스트 검증 규칙을 모두 구현한다: source·origin·token, apiIds, path, method·write, 헤더·크기, 동시성·속도, redirect error.
   - 교체·폐기·내비게이션된 frame의 요청은 거부한다. 진행 중인 요청의 응답은 버린다.
   - 프리뷰 세션·capability는 스튜디오 메모리에만 둔다. 만료되면 브로커가 재발급한다. capability 카운트다운 UI는 유지한다.
4. **내비게이션 감지**
   - 커밋 뒤 frame의 두 번째 `load`를 감지하면 frame을 제거하고 `runtime_failed("preview navigated away")`를 낸다.
   - 마지막 정상 revision을 새 frame으로 복구한다. 반복되면(예: 3회/분) 복구를 멈추고 사용자에게 알린다.
   - 스튜디오는 "프리뷰가 외부로 이동하려 해서 차단했습니다" 안내와 진단을 표시한다.
5. **CSP**(`apps/studio/scripts/security.mjs`, `frame.ts`)
   - frame `connect-src 'none'`, `script-src`에서 `data:` 제거. 번들은 nonce 인라인 `<script type="module">`로 실행한다. `</script>` 이스케이프는 기존 JSON 인코딩 방식과 같은 수준으로 안전하게 한다.
   - iframe sandbox는 `allow-scripts allow-same-origin`만 둔다(변경 없음 확인).
6. **생성 규칙 갱신**: `system-prompt.ts`·`templates.ts`의 토큰 언급을 제거하고 브로커 방식으로 바꾼다. source-policy의 `__TOI_FETCH_CONFIG__` 쓰기 금지는 유지한다.
7. **E2E**
   - 기존 스펙을 브로커 방식에 맞춘다.
   - `e2e/tests/isolation.spec.ts`에 다음을 추가한다.
     - AC: frame 전역·DOM·storage 어디에도 sessionToken·capabilityToken이 없음(스튜디오가 보유한 실제 토큰 값과 대조)
     - AD: 생성 코드의 `location.href` 외부 이동 → 로컬 수신기에 토큰 0건, frame 제거·복구, 안내 표시. 수신기에 도달하는 쿼리에는 토큰이 없음
     - AE: frame에서 policy-proxy 직접 fetch는 CSP 차단, 브로커 요청은 성공
     - AF: 폐기된 frame(이전 revision)의 브로커 요청 거부
     - AG: write capability 없이 PATCH → 403 WRITE_NOT_ALLOWED, 허용 후 성공
     - AH: 동시성·속도 한도 429, 5MiB 초과 응답 413
   - R3 재현 스크립트 `docs/review/repro/r3/p02-nav-egress.mjs`를 다시 실행해 토큰 유출이 없어진 것을 보고서에 적는다(스크립트는 수정하지 말고, 형식이 바뀌어 실패하면 같은 의도의 검증을 E2E로 대체한다).

## 조율
- policy-proxy에서 프리뷰 origin 직접 요청을 403 `PREVIEW_DIRECT_FORBIDDEN`으로 바꾸는 서버 코드는 F3-B가 구현한다. 전환 시점을 `orca orchestration send`로 F3-B와 맞춘다.
- 서비스 재기동은 이 워커가 소유한다. 재기동 전에 F3-B에 알린다.
- 계약 변경이 필요하면 코디네이터에게 ask.

## Constraints
- 수정 금지: `contracts/`, `services/policy-proxy/src/**`, `services/policy-proxy/test/**`, `scripts/storage.mjs`, `services/deps-builder/src/**`, `evals/**`, `docs/review/**`, `e2e/tests/downloads.spec.ts`.
- 전역 설치 금지, git commit 금지, 비밀값을 로그·문서·스크린샷에 남기지 않는다.
- 기존 보안 강화를 약화시키지 않는다: 프로젝트별 origin, Host 검사, nonce CSP, revision guard, Origin, CAS, 인증 흐름.

## Ownership
- 편집 가능:
  - `packages/preview-runtime/**`, `apps/studio/**`
  - `services/policy-proxy/client/**`, `services/policy-proxy/scripts/publish-client.mjs`
  - `services/agent-server/src/{templates,system-prompt,source-policy}.ts`와 관련 테스트·fixture
  - `scripts/**`(단 `storage.mjs` 제외)
  - `e2e/**`(단 `downloads.spec.ts` 제외)
  - `evals/cases/**`의 packageSet 버전 문자열(필요할 때만)

## Observable acceptance
- preview-runtime·studio·agent-server·scripts typecheck·test 통과. 브로커 검증 규칙별 단위 테스트가 있어야 한다.
- F3-B와 합친 뒤 `node scripts/dev-up.mjs --e2e` → `npm --prefix e2e run test:repeat` 전부 3회 통과(기존 A~AB + AC~AH).
- 보고서 `e2e/F3A-REPORT.md`:
  - 수정 전후 `location.href` 유출 비교(토큰 0건)
  - CSP 표
  - 브로커 규칙 표
  - 남은 위험(렌더링된 마스킹 데이터의 내비게이션 유출)
