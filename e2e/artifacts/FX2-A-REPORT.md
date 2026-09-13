# FX2-A 완료 보고

2026-09-13. 작업 범위: agent-server, deps-builder, studio, E2E. 계약 `4030814`와 코디네이터가 보완한 `3fc53a9`를 소비하며 계약 파일은 이 작업에서 수정하지 않았다. FX2-B 완료 알림 후 `96bd53a` 런타임을 스튜디오에 다시 빌드하고 최종 반복 E2E를 실행했다. Git commit과 전역 설치는 하지 않았다.

## 결과

- **N01 해결:** Origin 보호를 유지하는 `GET /projects/:projectId/generations/active` 구현. 가장 최근 nonterminal generation의 id/state/lastSeq/prompt/createdAt을 반환하고 없으면 404. prompt는 request에, ISO createdAt은 generation record에 지속 저장된다. 기존 저장소에는 새 생성부터 createdAt이 생기며 재시작 전 미완료 기록은 기존 규칙대로 failed 처리된다.
- **다른 탭 복원:** 서버 활성 생성과 checkpoint를 비교하고, 없거나 다른 checkpoint이면 `Last-Event-ID` 없이 전체 replay. 사용자 요청·assistant 대화·질문·진행 상태를 복원한다. 같은 checkpoint는 기존 seq 이후 replay를 유지한다. 답변은 기존 staging 이벤트로 양쪽 질문을 answered 표시하고 취소는 양쪽 종결을 반영한다. 다른 창 안내 및 입력 잠금, 이미 열린 탭의 보내기 직전 활성 조회로 중복 요청을 차단한다.
- **N02 해결:** 연결 거부/DNS/타임아웃/5xx와 health 실패를 registry_unavailable, 정상 레지스트리의 패키지·버전 부재를 input, 저장소 동작 오류를 storage_unavailable, 기타 오류를 internal로 분류한다. 모호한 Yarn 실패는 ping health를 확인한다. input=400, 외부 장애=503, internal=500이며 비동기 failed에도 code를 기록한다. 실패 요청/산출물은 다음 POST에서 다시 시도한다.
- **스튜디오 오류 안내:** HTTP 오류 및 failed 객체에서 code를 우선 적용하고 코드 없는 구버전 응답은 기존 처리를 유지한다. 레지스트리와 구성 요소 저장소 안내를 구분한다.
- **QA-04 확인:** 기존 공통 진단 renderer가 runtime_failed.error의 file/line/column을 빌드와 동일하게 표시하는 것을 FX2-B와 통합 검증했다. 실제 화면에서 `/src/App.tsx · 1행 6열`과 원인 메시지, 마지막 정상 화면 유지를 확인했다. 위치 없는 오류를 임의로 채우지 않는다.
- 관련 세 README에 엔드포인트·다른 탭 동작·실패 코드·재시도·테스트 방식을 기록했다.

## 검증

| 검증 | 결과 |
|---|---|
| agent-server typecheck | 통과 |
| agent-server 테스트 | 기존 87 + 추가 3 = **90 통과**, 기존 live Claude opt-in 1개 skip (`RUN_LIVE_CLAUDE` 미설정) |
| deps-builder typecheck | 통과 |
| deps-builder 테스트 | 기존 12 + 추가 3 = **15 통과**, skip/실패 없음 |
| studio typecheck 및 build | 통과 |
| 최종 `npm --prefix e2e run test:repeat` | 기존 15 + L/M = **17 × 3 = 51 통과**, 실패/skip/flaky 0 |
| 최종 E2E 시작/소요 | 2026-09-13T08:55:37.482Z / 132.451초 |
| `git diff --check` | 통과 |

agent-server 추가 검증은 최신 활성 생성 선택, 다른 프로젝트 제외, 완료/취소 후 제외 및 이전 활성 fallback, prompt/createdAt 영속 저장, studio/server Origin 허용을 확인한다. 기존 Origin 공격 테스트에도 새 엔드포인트를 추가했다.

deps-builder는 실제 Yarn을 연결 거부 서버와 정상 ping+패키지 404 서버에 연결하고, DNS/타임아웃/HTTP 5xx/모호한 오류 분류, HTTP 코드, 비동기 실패 코드, 저장소 실패 후 동일 요청 재시도를 확인했다. 기존 Verdaccio/MinIO/Chrome singleton 통합 검사도 통과했다.

E2E L은 sessionStorage 없는 새 탭 및 잘못된 checkpoint를 가진 탭에서 전체 대화를 복원하고, B 답변 → A answered, 이미 열린 B의 새 요청 차단, A 취소 → B 종결을 확인한다. M은 별도 자식 프로세스의 실제 Yarn/builder와 레지스트리 프록시를 사용해 HTTP 503을 주입하고, 같은 프로세스의 프록시만 복구하여 동일 프로젝트/revision/packageSet과 navigation에서 재시도 commit을 확인한다. 산출물은 메모리, Yarn 캐시는 임시 디렉터리이며 종료 시 정리한다. 공용 레지스트리/MinIO를 중단하거나 캐시를 삭제하지 않는다. K에는 모든 failed code 안내와 기존 코드 없는 응답 호환 검증을 추가했다.

초기 집중 검사에서 M 테스트 프록시의 tarball 주소가 upstream으로 빠져 복구 단계가 실패했다. 프록시가 tarball URL도 자기 주소로 매핑하도록 고친 뒤 I/M 집중 검사 2개와 위 전체 51개가 통과했다. 제품 서비스의 추가 장애는 없었다.

## 증거와 실행 상태

- [최종 반복 로그](fx2-a-repeat.log), [원시 Playwright 결과](results.json), [agent-server 로그](fx2-a-agent.log)
- [새 탭 사용자 요청·대화·질문 복원](other-tab-restored.png)
- [레지스트리 장애 안내](registry-unavailable.png), [같은 revision 복구](registry-recovered.png)
- [런타임 파일·행·열](runtime-location.png)

스크린샷의 안내와 위치를 직접 확인했다. 테스트로 갱신된 소유 범위 밖 deps-builder bench 산출물은 원래 바이트로 복원했다. 기본 `toi-lite` Compose 및 dev-up 관리 서비스는 코디네이터의 후속 리뷰를 위해 실행 중으로 남겼다 (`http://localhost:5173`); 추가 작업이나 기능상 잔여는 없다. 종료는 루트에서 `node scripts/dev-down.mjs`로 가능하다.
