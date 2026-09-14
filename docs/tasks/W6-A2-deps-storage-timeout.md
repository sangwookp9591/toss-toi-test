# W6-A2: deps-builder storage 타임아웃과 cleanup 순서 (FOLLOWUPS L5, TOSS-GAP P1-4)

공통 제약: [`W6-common.md`](W6-common.md)

## Target
`services/deps-builder/src/builder.ts`(`builds` 맵, 123행 `finally`), `services/deps-builder/src/store.ts`(`MinioStore.get/stream/put`).

## Change
- `finally`에서 `this.builds.delete(key)`를 cleanup보다 **먼저** 실행한다. cleanup 실패는 로그만 남기고 빌드 결과를 바꾸지 않는다.
- store 조회·업로드에 타임아웃을 둔다(기본 조회 10초, 업로드 60초, env로 조정). 타임아웃은 기존 오류 분류의 `storage`로 보고한다.
- 타임아웃 후 같은 key 재요청이 새 빌드로 진행되는지 보장한다(맵에 걸린 항목 없음).

## Constraints
manifest-last publish, 해시 재검증, single-flight 동작은 유지. 계약 수정 금지. MinIO·Verdaccio 없이 도는 단위 테스트로 검증한다(응답하지 않는 fake store).

## Ownership
`services/deps-builder/src/**`, `services/deps-builder/test/**`, `services/deps-builder/README.md`(env 설명).

## Observable acceptance
- 테스트: cleanup throw 시 맵 비워짐, 무응답 store get이 타임아웃으로 `storage` 오류, 타임아웃 후 재요청 성공.
- `npm --prefix services/deps-builder run typecheck` 통과, 서비스 없이 도는 단위 테스트 통과(통합 테스트는 서비스가 없어 skip/실패하면 그 사실만 보고).
