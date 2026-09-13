# F3a — R2 N2·N3·N4·N5·L3 수정 결과

2026-09-13, `services/policy-proxy/` 및 `scripts/dev-up.mjs`의 환경 전달만 수정했다. 커밋하지 않았으며 R2 원본 재현 파일은 보존했다.

| 항목 | 수정과 실제 검증 결과 | 근거 |
|---|---|---|
| N2 | ISO 날짜·시간, UUID, 13자리 epoch/식별자, 소수 금액은 잔여 스캔에서 제외한다. 주문번호·송장번호 등 키 힌트 없는 패턴은 값을 보존하고 `possible_unregistered_pii`로만 경고한다. | [정책 테스트 121/121](policy-validation.out) |
| N2 seed 주문 API | `GET /customers/C002/orders`의 세 날짜가 `2026-08-01/02/03T00:00:00.000Z`로 보존되고 `maskedFields: []`이다. 등록 규칙 미매칭 경고는 기존대로 유지한다. | [11 실행 결과](11-m1-false-positive.out), 실제 mock-backend와 proxy 응답 전체 비교 테스트 |
| N3 | 경로 있는 base의 `/tenant-a/api` 접두사를 보존해 `/tenant-a/api/items/42`로 전달한다. 플랫폼 관리자 API 등록 및 끝 `/` 유무도 테스트한다. | [04 실행 결과](04-h2-m1-isolated.out), [정책 테스트](policy-validation.out) |
| N4 | `..;`, `..%3b`, `2024./admin.`, 점만인 값은 400이며 upstream을 호출하지 않는다. 변수는 영숫자·밑줄·하이픈·비ASCII만 허용한다. | [04 실행 결과](04-h2-m1-isolated.out) |
| L3 | 한글 ID는 200이며 percent-encoded 경로로 전달한다. URL 최종 pathname을 인코딩된 기대값과 비교한다. | [04 실행 결과](04-h2-m1-isolated.out) |
| N5 | 정확한 `development`/`test`와 `TOI_DEV_AUTH_ENABLED=true` 조합만 개발 발급을 켠다. 다른 환경 및 미설정은 운영 가드 대상으로, 미설정 시크릿·dev 발급·dev admin 토큰·서로 같은 시크릿을 거부한다. | [08 실행 결과](08-h1-config-guard.out), 환경 변형 및 시크릿 쌍별 중복 테스트 |
| E2E | 최종 수정본 :7200과 F3b :7400에서 A~F **6/6**, 14초. | [최종 E2E 출력](e2e.out), [스튜디오 화면](e2e-studio.png) |

운영 가드에 필요한 설정을 모두 제공하면 `staging` 등 다른 환경 이름도 devAuth=false로 기동할 수 있다. `dev-up`은 개발 전용 명령이므로 `NODE_ENV=development`와 `TOI_DEV_AUTH_ENABLED=true`를 명시 전달한다. 정책 README에 선택 이유와 단독 실행 명령을 반영했다.

잔여 스캔은 보조 방어다. 구분자 없는 13자리 값은 epoch와 주민번호를 패턴만으로 구분할 수 없어 잔여 단계에서는 보존하며, 민감한 필드는 등록 pointer로 마스킹해야 한다. 등록 마스킹은 제외 토큰보다 먼저 적용한다. N5는 시크릿 길이·기본값·상호 중복을 검사하며 엔트로피 추정은 하지 않는다(08의 반복 문자 표본은 기존대로 수락).

첫 E2E 실행은 :7400이 종료되어 A~D가 프로젝트 생성에서 실패했다([초기 출력](e2e-initial-7400-down.out)). 조정자가 F3b 수정본의 agent-server를 복구한 후 전체를 다시 실행해 6/6 통과했다. F3a는 :7200만 재시작했고 최종 프로세스 PID는 2858이다. E2E가 생성한 기존 `e2e/artifacts/studio.png`는 실행 전 내용으로 복원했으며, 이 작업의 결과는 이 디렉터리에 저장했다.

재현 명령(저장소 루트):

```sh
npm --prefix services/policy-proxy run typecheck
npm --prefix services/policy-proxy test
node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/r2/after/04-h2-m1-isolated.mts
node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/r2/after/08-h1-config-guard.mts
bash docs/review/repro/r2/after/11-m1-false-positive.sh
npm --prefix e2e run test -- --reporter=line --output=/Users/psw/Projects/toss-toi-test/docs/review/repro/r2/after/e2e-test-results
```

추가 필수 작업 없음. 범위 밖 R2 L1(숫자/변형 PII), L4(대형 응답 한도) 등은 이 수정에 포함하지 않았다.
