# 스튜디오 전체 E2E

실제 로컬 서비스와 시스템 Google Chrome을 사용하는 Playwright 테스트다. mock 에이전트를 사용하며 네트워크 API를 테스트용 가짜 구현으로 대체하지 않는다.

```sh
node scripts/dev-up.mjs
npm --prefix e2e ci
npm --prefix e2e run test:repeat
```

`test:repeat`는 worker 1개로 A–F 전체를 세 번 연속 실행한다. 각 테스트는 새 브라우저 컨텍스트와 새 프로젝트를 만든다. policy-proxy와 mock-backend의 개발용 고객 데이터 및 감사 로그는 보존된다. D는 C001 상태를 suspended로 설정하므로 로컬 모의 데이터가 변경된다.

## 검증 결과

2026-09-13, 시스템 Chrome, Node 22.14.0에서 **18 passed (43.6s), 실패 0, 재시도 0**. 세 라운드 모두 A–F 6/6 통과했다. 원시 Playwright 결과는 [`artifacts/results.json`](artifacts/results.json), A의 정상 커밋·마스킹 조회 직후 화면은 [`artifacts/studio.png`](artifacts/studio.png)다. `npm --prefix apps/studio run typecheck` 및 `npm --prefix apps/studio run build`도 통과했다.

| 시나리오 | 검증 |
| --- | --- |
| A | UI 프로젝트 생성 → “고객 목록 화면 만들어줘” 요청 → 역질문 “아니요” → revision 2 커밋 → 사유 누락 입력 요구 → 사유 입력 → `010-****-5678` 표시 → allowed 감사 기록 |
| B | 문법 오류를 UI로 저장 → 이전 화면 유지 안내 → 기존 iframe 본문 동일, 마지막 커밋 revision 유지 |
| C | revision 2에 2초 top-level await를 넣어 실행 검증을 지연 → 숨김 프레임 생성 확인 후 revision 3 저장 → revision 3만 커밋, revision 2 stale_discarded |
| D | 프리뷰의 viewer 세션으로 POST /capabilities 시 403 및 roles 확인 → read capability의 PATCH 차단 안내 → 쓰기 토글 → viewer 세션 토큰 동일 확인 → PATCH 성공과 감사 기록 |
| E | 같은 프로젝트를 두 탭에서 열고 동일 baseRevision으로 동시 저장 → 정확히 한 탭 409 안내 → 최신 내용 불러오기 |
| F | 앱의 React 본체와 TDS의 React 본체 identity 확인 → TDS ToastProvider/useToast 동작 → pageerror 및 runtime_failed 0 |

React ESM namespace wrapper 자체는 비교하지 않는다. 공개 CJS facade의 React default 본체와 `reactInstance.default ?? reactInstance`를 비교하여 실제 singleton을 확인한다. C는 Worker 연산을 흉내 내지 않고 실제 프레임의 모듈 평가를 지연한다.

`playwright.config.ts`는 `channel: 'chrome'`을 지정한다. Playwright 번들 Chromium을 다운로드할 필요가 없다. `npm --prefix e2e test`는 한 라운드를 실행한다. 실패 시 trace는 `test-results/`에 보관된다. 스튜디오는 COOP/COEP를 설정하지 않는다.
