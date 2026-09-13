# FX-B — QA-01 / QA-07 / QA-03 템플릿 수정

2026-09-13, `/Users/psw/Projects/toss-toi-test`. FX-B 범위 작업 완료. 커밋·전역 설치 없이 진행했다.

## 변경

- `dev-up` 설치 대상에 `packages/fake-tds`를 추가했다. `apps/`, `services/`, `packages/`의 package.json 디렉터리와 설치 목록을 대조하고, 대상마다 lockfile이 있는지 검사하는 `--check`를 제공한다. 현재 대상은 fake-tds, preview-runtime, mock-backend, policy-proxy, deps-builder, agent-server, studio 7개다. contracts는 타입 소스만 참조하므로 별도 설치가 필요 없고 bench/e2e/poc는 기동 대상이 아니다.
- 레지스트리 스크립트도 fake-tds의 node_modules가 없으면 스스로 `npm ci` 후 빌드한다. 단계·소요 시간·안전한 오류 요약을 출력하며 dev-up은 전체 로그와 서비스 로그 경로를 안내한다. 기동 출력의 환경 비밀값·인증 헤더·URL 자격증명을 가린다.
- 목록·상세·상태 변경 mock 템플릿에 조회 전/중/성공/오류 상태를 추가했다. 조회 전에는 표를 표시하지 않고, 요청 중에는 조회 버튼을 비활성화하며 ref로 동일 렌더 내 중복 호출도 차단한다. 빈 배열·null 및 HTTP 404는 빈 결과 안내를 표시한다.
- 실제 `@toi/fetch` 오류 타입과 HTTP 상태로 428 사유, 403 권한, native TypeError 연결 실패, 5xx 업무 시스템 장애를 구분한다. 쓰기 403에는 재허용 안내를 표시하고 기존 `쓰기 권한`, `상태를 정지로 바꿨어요`, `고객 상태를 정지로 변경` 문구를 보존했다. 접근성 status 영역은 하나로 유지했다.
- 루트 README의 「TOI-lite 실행」 절에 새 클론 단일 명령과 설치 검사·오류·로그 위치를 명시했다.

## 검증

| 검사 | 결과 | 증거 |
|---|---|---|
| agent-server typecheck | exit 0 | `npm run typecheck` |
| agent-server 테스트 | 87 passed, 1 skipped; 기존 48개 유지 + 신규 39개 | [로그](mock-template-states.log) |
| F2 소스 정책 | 목록·상세·상태 변경 생성 소스 및 HTTP save 검증 통과 | 기존 source-policy 테스트 + 신규 템플릿 실행 테스트 |
| 설치 목록 / 오류 요약 / 비밀값 마스킹 | node test 4/4, `--check` 7개 대상 통과 | `node --test scripts/dev-up.test.mjs`, `node scripts/dev-up.mjs --check` |
| 새 클론 상당 사본 단일 기동 | exit 0, **22.604초**, 스튜디오 5173·프리뷰 5174 ready | [단계별 기동 로그](cold-start-after.log), [사전 조건](cold-start-preconditions.json) |
| 컴파일러 실패 주입 | exit 1, `registry setup failed: fake-tds build failed: tsc not found`와 로그 경로 출력 | [오류 로그](fake-tds-failure-after.log) |
| standalone registry 자체 설치 | fake-tds node_modules 삭제 후 추가 조치 없이 install/build 성공, exit 0 | [자체 설치 로그](setup-registry-self-install.log) |
| 실제 Chrome 프리뷰 | 초기·중·결과·빈 결과·428·403·503·network·복구 통과 | [브라우저 로그](mock-browser-states.log) |
| 비밀값 검사 | 사본 .env의 비밀값 4개와 로그/JSON 6개 대조, 일치 0 | [검사 결과](secret-scan.json) |
| 정리 | dev-down exit 0, 8개 포트 해제, toi-fxb 컨테이너 0, 사본 삭제 | [종료 로그](cold-start-down.log), [정리 결과](cleanup.json) |

기존 실제 Claude smoke 1개는 명시적 opt-in 테스트라 기존대로 skip했다. 신규 테스트는 생성된 TSX를 컴파일·실행해 deferred 응답과 실제 클라이언트 오류 클래스를 적용한다. 실제 브라우저 검사도 현재 `mockFiles` 출력물을 스튜디오 save/F2 경계로 저장해 프리뷰에서 실행했다.

## 새 클론 검증 방법

코디네이터로부터 포트 사용 권한을 받은 뒤, 원본 포트가 모두 비어 있는 상태에서 아래와 같이 미커밋 변경을 포함한 사본을 만들었다. `.git`과 `.cache`도 제외했으며 git worktree는 사용하지 않았다.

```sh
mkdir -p ~/Projects/toi-lite-fx-verify
rsync -a --exclude node_modules --exclude .env --exclude data --exclude .run --exclude dist --exclude .git --exclude .cache ./ ~/Projects/toi-lite-fx-verify/
cd ~/Projects/toi-lite-fx-verify
COMPOSE_PROJECT_NAME=toi-fxb node scripts/dev-up.mjs
```

첫 기동에 복구 명령은 필요 없었다. 이후 별도 오류 검증에서 fake-tds의 tsc 실행 파일을 사본 안에서 exit 127의 실패 shim으로 잠시 교체했다. 단순히 파일만 숨기면 nested npm이 deps-builder의 `.bin/tsc`를 찾아 실행하므로 명시적인 shim으로 실패를 주입했다. 자체 설치 검증은 사본의 fake-tds node_modules를 실제 삭제한 뒤 registry 명령을 실행했다.

검증 후 `COMPOSE_PROJECT_NAME=toi-fxb node scripts/dev-down.mjs`를 실행하고 사본을 삭제했다. 볼륨은 보존했고 `toi-lite_*`, `toi-qa_*` 볼륨에는 손대지 않았다. 포트 8개 해제를 확인한 직후 코디네이터에 `port lock released`를 보냈다.

## 브라우저 증거

[초기 안내](mock-initial.png) → [조회 중](mock-loading.png) → 실제 backend 마스킹 목록 → [빈 결과](mock-empty.png). [업무 시스템 장애](mock-backend.png)와 [정책 서버 연결 실패](mock-network.png)를 구분하고 재조회하면 실제 목록이 복구됐다.

브라우저의 빈 결과/HTTP 오류/연결 실패는 Playwright 네트워크 주입으로 재현했고 서비스 자체를 중단한 실험은 아니다. 재현 스크립트는 `services/agent-server/scripts/fx-template-browser.ts`이며 dev-up과 기존 E2E 의존성 설치 후 `npm --prefix services/agent-server exec -- tsx services/agent-server/scripts/fx-template-browser.ts`로 실행한다. FX-A의 앱·E2E 변경은 편집하지 않았고 전체 E2E 반복 실행은 FX-A 통합 검증 범위다.
