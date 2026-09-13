# W1b: 프리뷰 런타임 hostConfig 주입 (packages/preview-runtime)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 수정할 곳: `packages/preview-runtime/` (특히 `src/index.ts`, `src/frame.ts`, 테스트)
- 반드시 읽을 것: `contracts/src/runtime.ts`의 `PreviewHostConfig`, `BuildInput.hostConfig`, `ParentToFrame.hostConfig`(커밋 `1865486`에서 추가), `packages/preview-runtime/README.md`

## Change
1. `build(input)`이 받은 `input.hostConfig`를 `ParentToFrame.load` 메시지의 `hostConfig`로 그대로 전달한다.
2. frame은 import map과 번들을 실행하기 **전에** `globalThis.__TOI_FETCH_CONFIG__ = Object.freeze({ ...hostConfig.toiFetch })`를 설정한다. `hostConfig`가 없으면 전역을 만들지 않는다. 문자열 삽입은 기존 `json()` 이스케이프 경로를 재사용해 `</script>`·U+2028 주입에 안전해야 한다.
3. `sourceDigest`와 revision guard 판정에는 hostConfig를 넣지 않는다(토큰 교체만으로 소스가 달라지지 않음). 단, 같은 토큰에서 hostConfig만 바뀐 빌드도 정상 커밋되어야 한다.
4. 테스트 추가(기존 전부 유지):
   - 단위: load 메시지에 hostConfig가 실린다.
   - 브라우저: 생성 코드가 `globalThis.__TOI_FETCH_CONFIG__.projectId`를 화면에 렌더 → 커밋 확인. 전역이 frozen(쓰기 무시/에러)인지 확인. 토큰 문자열에 `</script>`가 들어가도 실행이 깨지지 않음. hostConfig 없으면 전역 undefined.
5. README의 iframe 프로토콜 절에 hostConfig 주입 순서와 보안 메모(생성 코드가 토큰을 읽을 수 있으므로 capability는 기본 read·짧은 TTL)를 추가.

## Constraints
- `packages/preview-runtime/**` 밖 수정 금지. `contracts/`는 읽기 전용. 전역 설치 금지, git commit 금지.
- 기존 공개 API와 테스트 동작을 깨지 않는다.

## Ownership
- 편집 가능: `packages/preview-runtime/**`

## Observable acceptance
- `cd packages/preview-runtime && npm run typecheck && npm test` 전부 통과(기존 22+12개 + 추가분), 요약을 README에 갱신.
