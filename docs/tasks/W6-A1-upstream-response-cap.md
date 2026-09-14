# W6-A1: policy-proxy upstream 응답 크기 상한 (FOLLOWUPS L4, TOSS-GAP P1-4)

공통 제약: [`W6-common.md`](W6-common.md)

## Target
`services/policy-proxy/src/server.ts`의 `/proxy` upstream 호출(현재 `fetch` 후 `upstream.text()`/JSON 파싱, 83행 부근), 필요하면 `config.ts`.

## Change
- upstream 응답 본문을 스트림으로 읽으며 누적 바이트가 상한을 넘는 즉시 읽기를 중단(abort)하고 `502 UPSTREAM_TOO_LARGE`를 돌려준다. `Content-Length`가 상한보다 크면 본문을 읽기 전에 거부한다.
- 상한 기본 5 MiB, env `POLICY_MAX_UPSTREAM_BYTES`로 조정. 잘못된 값이면 기동 실패.
- 거부도 기존 감사 기록 규칙대로 deny로 남긴다. 응답 본문 일부를 감사·오류에 넣지 않는다.
- `sanitize`/마스킹이 요청당 한 번만 적용되는지 확인하고, 중복이면 제거한다.

## Constraints
기존 마스킹·사유·권한·감사 동작과 오류 코드는 바꾸지 않는다. 계약 수정 금지.

## Ownership
`services/policy-proxy/src/**`, `services/policy-proxy/test/**`, `services/policy-proxy/README.md`(상한 설명 한 단락).

## Observable acceptance
- 테스트: 상한 이하 정상, Content-Length 초과 즉시 거부, Content-Length 없이 chunked로 초과 시 거부, 거부 감사 기록 존재.
- `npm --prefix services/policy-proxy run typecheck` 및 `test` 통과.
