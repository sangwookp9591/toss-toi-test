# FX2-B: QA2 잔여 — QA-04 런타임 오류 위치 (packages/preview-runtime)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 수정할 곳: `packages/preview-runtime/`
- 반드시 읽을 것: `docs/qa/qa2/QA2-REPORT.md` §2 QA-04, `contracts/src/runtime.ts`(`runtime_failed.error: Diagnostic`, `FrameToParent.error`), `packages/preview-runtime/README.md`

## Change
1. 프리뷰 frame에서 잡은 런타임 오류(동기 throw, React 렌더 오류, 처리되지 않은 promise rejection)의 stack을 **원본 VFS 파일·행·열**로 매핑해 `Diagnostic.file/line/column`을 채운다.
   - esbuild 번들에 source map을 포함하거나(인라인 또는 부모가 보관한 external map), 부모 쪽에서 bundle과 map을 revision 토큰별로 보관해 frame이 보낸 stack의 번들 위치를 매핑한다. 매핑 라이브러리는 버전을 고정하고 번들 크기 영향을 README에 적는다.
   - 사용자 코드가 아닌 위치(React 내부, import map 외부 모듈)는 건너뛰고, 가장 가까운 사용자 VFS 프레임을 선택한다. 사용자 프레임이 없으면 위치를 비워 둔다(추측 금지).
   - `file`은 build 진단과 같은 표기(`/src/App.tsx`)로 통일한다.
2. 성능: 첫 커밋과 수정 커밋 시간을 기존 브라우저 벤치로 다시 측정한다. 중앙값이 기존 대비 20% 넘게 나빠지면 map을 오류 발생 시에만 생성하는 방식 등으로 조정하고 결과를 README에 기록한다.
3. 보안: map 내용이나 VFS 원문이 스튜디오 origin 외부로 전송되지 않는지 확인한다(postMessage 대상 origin 고정 유지).
4. 테스트(기존 23 단위 + 15 브라우저 유지):
   - `throw new Error('x')`가 `/src/App.tsx` 해당 행 반환.
   - 하위 컴포넌트 파일(`/src/Table.tsx`)에서 난 오류는 그 파일 반환.
   - 비동기 rejection, React 렌더 오류.
   - 사용자 프레임이 없는 오류는 위치 없음.
   - 줄바꿈·주석이 앞에 있는 파일에서도 행 정확.

## Constraints
- `packages/preview-runtime/**` 밖 수정 금지. 계약 변경 금지(부족하면 ask).
- 브라우저 테스트는 패키지 자체 테스트 서버만 쓰고 원본 서비스 포트(4873·9000·5173·5174·7100·7200·7300·7400)를 점유하지 않는다. FX2-A가 그 포트로 E2E를 돌린다.
- 전역 설치 금지, git commit 금지.

## Ownership
- 편집 가능: `packages/preview-runtime/**`

## Observable acceptance
- `cd packages/preview-runtime && npm run typecheck && npm test` 통과(추가 포함).
- 벤치 전후 비교를 `bench/results.json`과 README에 기록.
