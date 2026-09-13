# FX-A QA1 스튜디오 수정 결과

2026-09-13, `/Users/psw/Projects/toss-toi-test`. QA-02·03·04·05·06·08 수정 완료. 서비스는 코디네이터 지시에 따라 기본 `toi-lite` 구성으로 기동했고 실행 상태로 남겼다. git commit은 하지 않았다.

- QA-02: 프로젝트별 sessionStorage에 generationId·seq·대화·미답변 질문·진행 상태·staging 파일 보존, fetch SSE Last-Event-ID 재구독, 답변·취소 재개, 종결/404 안내와 저장값 삭제.
- QA-03: 기본 write TTL 120초 유지, 실제 JWT exp 기반 남은 시간, 만료 시 토글 off·안내·read capability 재빌드. 테스트용 TTL은 기본값보다 짧게만 설정 가능.
- QA-04: 파일·행·열·메시지 최대 5개와 초과 건수, axios 등 금지 패키지 한국어 안내, 문법 오류와 패키지 오류 요약 구분, runtime 오류 원인 표시.
- QA-05: 최신 내용 불러오기 전에 로컬 파일 보관, 파일별 열기·복사, 같은 탭 세션에서 새로고침 후 유지.
- QA-06: 최초 준비 실패/이전 정상 화면 보존 구분, 프리뷰·상태 바의 동일 revision 재시도, failed·연결 실패·잘못된 버전·90초 초과 원인 분류. 원문 내부 주소와 로그는 표시하지 않음.
- QA-08: 답변 버튼 최소 너비 48px·nowrap·한 줄 높이, 입력칸 flex 배분. 400px에서는 세로 패널 배치.

검증 결과:

| 검증 | 결과 |
|---|---|
| `npm --prefix apps/studio run typecheck` | 통과 |
| `npm --prefix apps/studio run build` | 통과 |
| `npm --prefix e2e run test:repeat` | **45 passed, 106.584초** |
| 실패 / skip / flaky | **0 / 0 / 0** |
| 독립 SSE 검증 | 저장 seq 헤더, 중복 제거, 종결 종료, 404, 분할 청크 재연결 통과 |
| `git diff --check -- apps/studio e2e/tests` | 통과 |

E2E 최종 실행 시작: 2026-09-13T08:17:37.652Z. 기존 A–F 6개와 새 G–K/레이아웃 9개, 총 15개를 각각 3회 실행했다. K는 실제 존재하지 않는 `@toi/tds` 버전으로 deps-builder 실패를 재현하고, 별도 브라우저 라우팅으로 failed/연결/timeout 오류 후 동일 revision의 정상 commit을 확인한다. 서비스 중단·공용 데이터 삭제는 하지 않았다.

증거: [원시 결과](results.json), [기존 생성 화면](studio.png), [1600px 질문](question-1600.png), [400px 질문](question-400.png). 상세 동작과 테스트 설정은 [스튜디오 README](../../apps/studio/README.md)에 기록했다.

검증 중 400px에서 스크롤 밖 cross-origin iframe의 requestAnimationFrame 지연이 확인됐다. 스튜디오 CSS가 런타임의 `data-state="candidate"`를 사용하여 투명·inert·입력 차단된 준비 프레임만 뷰포트 안에 실제 프리뷰 크기로 배치하고, commit 뒤 원래 영역으로 돌린다. 패키지 런타임 코드는 수정하지 않았으며, 최종 A–F 반복도 통과했다.

브라우저가 sessionStorage를 차단하거나 저장 공간이 부족하면 새로고침 복구를 보장할 수 없다는 제한은 README에 명시했다. FX-A가 편집한 범위는 `apps/studio/`, `e2e/tests/`, `e2e/artifacts/`이며 다른 작업자의 서비스·스크립트 변경은 수정하지 않았다. 남은 FX-A 작업은 없다.
