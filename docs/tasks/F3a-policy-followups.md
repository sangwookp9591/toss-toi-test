# F3a: R2 후속 — 정책 프록시 N2·N3·N4·N5·L3 (services/policy-proxy)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 수정할 곳: `services/policy-proxy/`, `scripts/dev-up.mjs`(N5의 NODE_ENV 전달만)
- 반드시 읽을 것: `docs/review/REVIEW-R2.md` §4 N2·N3·N4·N5·L3, 재현 `docs/review/repro/r2/04-h2-m1-isolated.*`, `08-h1-config-guard.*`, `11-m1-false-positive.*`

## Change
1. **N2 (회귀)** 잔여 PII 스캔 오탐
   - account 패턴을 좁히고 ISO 날짜·시간(`YYYY-MM-DD`, `YYYY-MM-DDTHH:MM`), UUID, 13자리 epoch, 소수 금액을 제외한다.
   - 값 치환은 **키 이름 휴리스틱**(phone/tel/mobile/rrn/ssn/resident/account/acct/email 등, 대소문자 무시)이 겹칠 때만 한다. 키 힌트 없이 패턴만 맞으면 값은 보존하고 감사에 `policyWarnings: ["possible_unregistered_pii"]`만 남긴다.
   - 음성 표본(날짜·UUID·주문번호·금액·송장번호) 회귀 테스트와 seed `GET /customers/{id}/orders` 실제 응답이 훼손되지 않는 테스트를 추가한다.
2. **N3 (회귀)** upstream base 경로 접두사 보존: `base.pathname`(끝 `/` 제거) + 정규화 경로로 URL을 만들고, 결과 pathname이 정확히 그 값인지 비교한다. 경로 있는 base(`http://localhost:<임시포트>/tenant-a/api`) 등록 회귀 테스트.
3. **N4 + L3** 경로 문자 집합: 디코딩 후 세그먼트에 `;`가 있거나, 세그먼트가 `.`로 끝나거나 점만으로 이뤄지면 400. 템플릿 변수 값은 명시적 허용 집합(영숫자, `_`, `-`, 비ASCII 문자)만 허용. 비교는 **인코딩된 형태끼리** 해서 한글 등 비ASCII id가 400이 되지 않게(L3). `..;`, `..%3b`, `2024./admin.`, 한글 id 테스트.
4. **N5** 운영 가드 fail-closed
   - dev 발급은 opt-in: `TOI_DEV_AUTH_ENABLED === 'true'` **그리고** `NODE_ENV`가 정확히 `development` 또는 `test`일 때만 켠다.
   - 그 밖의 모든 `NODE_ENV`(미설정 제외 — 미설정은 development로 취급하지 않고 **거부**하거나, dev-up이 명시적으로 `NODE_ENV=development`를 넘기도록)에는 production 가드를 적용한다. 선택한 규칙과 근거를 README에.
   - production 가드에 세 시크릿이 서로 다른지 검사 추가.
   - `scripts/dev-up.mjs`가 `NODE_ENV=development`와 `TOI_DEV_AUTH_ENABLED=true`를 명시 전달하도록(스튜디오·E2E 흐름 유지). 테스트: `Production`, `prod`, `staging`, `"production "`, 미설정, 세 시크릿 동일 → 모두 기대대로.
5. `docs/review/repro/r2/`의 04·08·11을 수정 후 다시 실행해 `docs/review/repro/r2/after/`에 저장(원본 보존).

## Constraints
- 편집 범위 밖(`contracts/`, `packages/`, `apps/`, 다른 services, `e2e/`) 수정 금지. 전역 설치 금지, git commit 금지. 7200 재시작 허용(필요하면 7300도 프로세스 재시작만).
- 기존 정책 테스트 67개와 E2E A~F가 계속 통과해야 한다(`npm --prefix e2e run test`로 최소 1회 확인).

## Ownership
- 편집 가능: `services/policy-proxy/**`, `scripts/dev-up.mjs`, `docs/review/repro/r2/after/**`
- F3b가 병렬로 `services/agent-server/**`를 수정한다.

## Observable acceptance
- `cd services/policy-proxy && npm run typecheck && npm test` 통과(추가 테스트 포함).
- `npm --prefix e2e run test` 6/6.
- `docs/review/repro/r2/after/`에서 N2 날짜 보존, N3 접두사 보존, N4 `;`·끝 점 400, L3 한글 id 200, N5 변형 NODE_ENV 전부 fail-closed.
