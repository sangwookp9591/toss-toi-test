# FX-B: QA1 기동·mock 템플릿 수정 — QA-01·QA-07·QA-03(템플릿 문구) (scripts, deps-builder scripts, agent-server)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`
- 수정할 곳: `scripts/dev-up.mjs`, `scripts/dev-down.mjs`(필요 시), `services/deps-builder/scripts/setup-registry.mjs`, `services/agent-server/src/templates.ts`와 테스트, 루트 `README.md`의 「TOI-lite 실행」 절
- 반드시 읽을 것: `docs/qa/qa1/QA-REPORT.md` QA-01, QA-03, QA-07, 로그 `docs/qa/qa1/logs/cold-start.log`, `fake-tds-build-failure.log`

## Change
1. **QA-01 (blocker) 새 클론 단일 기동**
   - dev-up 설치 대상에 `packages/fake-tds`를 넣는다. 그 밖에 dev-up이 빌드·실행하는 모든 패키지(`packages/preview-runtime`, `apps/studio` 등)도 lockfile 기준 설치 대상에 빠짐없이 들어 있는지 **스크립트 전체를 점검**한다.
   - `setup-registry.mjs`는 build 전에 `node_modules`가 없으면 스스로 `npm ci`를 실행하거나, 명확한 오류("packages/fake-tds 의존성이 없어요. npm --prefix packages/fake-tds ci")를 낸다.
   - dev-up 실패 메시지는 실패한 **단계 이름과 원인 요약**(예: `fake-tds build failed: tsc not found`)을 보여 준다. 로그 파일 경로도 함께 보여 준다. 비밀값은 출력하지 않는다.
   - **검증은 반드시 새 클론에서 한다**: 커밋되지 않은 변경이 있으므로, 작업 결과를 임시 디렉터리(`/private/tmp/...` 대신 `~/Projects/toi-lite-fx-verify`)로 `git worktree add` 없이 `rsync --exclude node_modules --exclude .env --exclude data --exclude .run --exclude dist` 복사한다. 그 사본에서 `COMPOSE_PROJECT_NAME=toi-fxb node scripts/dev-up.mjs`가 **추가 조치 없이** 스튜디오 준비 완료까지 가는지 확인한다. 끝나면 `dev-down` 후 사본을 지운다. 포트가 겹치므로 원본 서비스가 떠 있으면 먼저 내린다.
2. **QA-07 mock 템플릿 조회 상태** (`services/agent-server/src/templates.ts`)
   - 조회 전: 테이블 대신 "조회 사유를 입력하고 조회를 눌러 주세요" 안내.
   - 조회 중: 조회 버튼 비활성화와 "조회 중…" 표시(중복 클릭 방지).
   - 결과 없음: "조건에 맞는 고객이 없어요".
   - 오류 구분(`@toi/fetch` 오류 타입과 HTTP 상태 기준):
     - `ToiReasonRequiredError`(428) → 사유 안내
     - `ToiForbiddenError`(403) → 권한 안내
     - 네트워크 실패(프록시 연결 불가) → "정책 서버에 연결하지 못했어요. 잠시 후 다시 시도하세요."
     - 5xx(업무 시스템 장애) → "고객 시스템이 응답하지 않아요. 잠시 후 다시 시도하세요."
   - 목록·상세·상태 변경 템플릿 모두에 적용한다. 생성 코드는 F2 소스 검사(raw fetch 금지 등)를 계속 통과해야 한다.
3. **QA-03 템플릿 쓰기 권한 오류 문구**
   - 403 시 "쓰기 권한이 없거나 허용 시간이 끝났어요. 스튜디오에서 쓰기 테스트를 다시 허용하세요."
   - E2E D가 `쓰기 권한`을 포함 문자열로 단언하므로 이 단어는 유지한다.
   - `상태를 정지로 바꿨어요`, `고객 상태를 정지로 변경` 문구도 유지한다.
4. **테스트**
   - agent-server: 템플릿이 조회 전/중/없음/오류 4분기를 포함하는지, 소스 검사 통과를 확인한다. 기존 48개 테스트를 유지한다.
   - dev-up: 설치 대상 목록이 저장소의 package.json 보유 디렉터리 중 실행에 필요한 것을 모두 포함하는지 확인하는 간단한 검사(스크립트 테스트 또는 `--check` 모드).
5. **README 「TOI-lite 실행」**: 새 클론 첫 기동 절차가 dev-up 한 줄로 끝남을 명시하고, 실패 시 보이는 메시지와 로그 위치를 적는다.

## Constraints
- 편집 범위 밖(`apps/`, `e2e/`, `packages/`, `contracts/`, `services/policy-proxy`, `services/mock-backend`, deps-builder의 `src/`) 수정 금지.
- 전역 설치 금지, git commit 금지.
- FX-A가 병렬로 `apps/studio/**`, `e2e/tests/**`를 수정한다. 검증용 사본을 띄울 때 FX-A가 원본 서비스를 쓰는 중일 수 있으니, 원본 포트를 내리기 전에 ask로 코디네이터와 조율한다.

## Ownership
- 편집 가능: `scripts/**`, `services/deps-builder/scripts/**`, `services/agent-server/**`, 루트 `README.md`의 「TOI-lite 실행」 절, `docs/qa/fx/**`, 검증용 임시 사본 `~/Projects/toi-lite-fx-verify`(끝나면 삭제)

## Observable acceptance
- `cd services/agent-server && npm run typecheck && npm test` 통과(추가 테스트 포함).
- 새 클론 사본에서 dev-up 단일 명령 성공 로그(단계별 시간 포함)를 `docs/qa/fx/cold-start-after.log`에 저장.
- mock으로 생성한 목록 화면이 조회 전 안내 → 조회 중 → 결과·오류 분기로 동작함을 설명하는 캡처 또는 로그.
