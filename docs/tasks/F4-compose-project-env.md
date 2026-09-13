# F4: compose 프로젝트명 전달 누락과 Keycloak 볼륨 자격 증명 불일치 (QA4 Q4-N01)

## Target
- 저장소: `/Users/psw/Projects/toss-toi-test`. 원본 개발 환경은 내려가 있다. 포트 9개는 QA4 클론이 쓸 수 있으므로, 이 작업에서 전체 스택을 띄울 때는 반드시 **`COMPOSE_PROJECT_NAME=toi-f4`**를 쓰고 끝나면 `dev-down`으로 정리한다.
- QA4 발견:
  - 새 클론에서 `COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-up.mjs`를 실행했다.
  - `scripts/service-env.mjs`의 docker allowlist에 `COMPOSE_PROJECT_NAME`이 없어서, docker compose가 기본 프로젝트 `toi-lite`로 컨테이너 4개를 만들었다.
  - 그 결과 기존 `toi-lite_keycloak-data` 볼륨(다른 admin 비밀번호)이 재사용됐고, 10초 만에 Keycloak provisioning이 실패했다.
  - 다른 프로젝트의 볼륨을 오염시킬 수 있는 결함이다.
- 반드시 읽을 것: `scripts/service-env.mjs`, `scripts/dev-up.mjs`, `scripts/dev-down.mjs`, `scripts/storage.mjs`, `scripts/keycloak.mjs`, `infra/docker-compose.yml`, `docs/qa/qa3/QA3-REPORT.md`(QA3에서 프로젝트명이 동작하던 방식)

## Change
1. docker 계열 자식 프로세스에 compose 동작에 필요한 env를 넘긴다. 최소한 `COMPOSE_PROJECT_NAME`이다. `COMPOSE_FILE`·`COMPOSE_PROFILES`가 필요하면 근거를 적는다.
   - dev-up·dev-down·storage·keycloak이 쓰는 모든 docker/`mc` 경로에서 같은 프로젝트명이 쓰이는지 확인한다.
   - 가능하면 compose 호출에 `-p <이름>`을 명시해 env 전달에 의존하지 않게 한다.
2. 프로젝트명이 기본값이 아닐 때 dev-up이 시작 로그에 실제 compose 프로젝트명을 한 줄 출력한다.
3. **자격 증명 불일치 감지**
   - 기존 Keycloak·MinIO 볼륨이 현재 `.env`의 admin 비밀번호와 맞지 않으면, 무엇이 왜 실패했는지 알려 준다: 어느 볼륨인지, 해결 방법(`dev-down --volumes`, 다른 `COMPOSE_PROJECT_NAME`).
   - 비밀번호 값은 출력하지 않는다. 볼륨을 자동으로 삭제하지 않는다.
4. 테스트(`scripts/*.test.mjs`)
   - docker allowlist에 프로젝트명이 포함되는지
   - dev-up이 만드는 compose 명령에 프로젝트명이 반영되는지(명령 구성 단위 테스트)
   - 불일치 감지 메시지
5. 실제 확인
   - `COMPOSE_PROJECT_NAME=toi-f4 node scripts/dev-up.mjs`로 `toi-f4-*` 컨테이너만 생기고 `toi-lite-*`는 생기지 않는지 확인한다. `docker ps -a`와 volume 목록을 보고서에 남긴다.
   - 끝나면 `COMPOSE_PROJECT_NAME=toi-f4 node scripts/dev-down.mjs --volumes`(옵션 이름은 실제 스크립트 기준)로 toi-f4 자원만 정리한다.
   - 감사 버킷 COMPLIANCE 객체가 볼륨 삭제를 막으면 그 사실과 대처를 README에 적는다.

## Constraints
- 수정 금지: `scripts/**`·`infra/**`·루트 README 실행 절·`.env.example` 외 전부.
- 다른 compose 프로젝트(`toi-lite`, `toi-qa*`, `toi-fxb`)의 컨테이너·볼륨은 조작하지 않는다.
- git commit 금지. 비밀값 출력 금지.

## Ownership
- 편집 가능: `scripts/**`, `infra/**`, 루트 `README.md` 실행 절, `.env.example`

## Observable acceptance
- `node --test scripts/*.test.mjs` 통과.
- toi-f4 실제 기동·정리 증거가 `scripts/F4-REPORT.md`에 있다.
- 다른 프로젝트 자원에는 변화가 없다(작업 전후 `docker ps -a`·`docker volume ls` 비교).
