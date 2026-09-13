# F4 — Compose 프로젝트 격리 및 볼륨 인증 진단

검증일: 2026-09-13. 저장소: `/Users/psw/Projects/toss-toi-test`. 결과: **요청 범위 완료**, `node --test scripts/*.test.mjs` **17/17 통과**. commit하지 않았다.

## 변경

- `scripts/service-env.mjs`: Docker 자식 allowlist에 `COMPOSE_PROJECT_NAME`을 추가했다. 앱·설치 자식에는 전달하지 않는다.
- `scripts/compose.mjs`: 기본 `toi-lite` 또는 검증된 `COMPOSE_PROJECT_NAME`으로 공통 `docker compose -p <이름> -f infra/docker-compose.yml` 인자를 구성한다. dev-up, dev-down, storage의 `mc`용 compose exec가 이 함수를 공유한다. Keycloak provisioning 자체는 Docker 자식을 만들지 않으며 고정된 로컬 HTTP endpoint를 사용하고, 인증 진단에 같은 프로젝트명을 적용한다.
- `scripts/dev-up.mjs`: 실제 up 인자 구성 함수를 내보내 단위 테스트하고, 기본값이 아닌 프로젝트명을 시작 로그에 표시한다.
- `scripts/dev-down.mjs`: `.env`를 읽고 같은 Docker allowlist·프로젝트 선택을 사용한다. 기존에 무시되던 `--volumes`를 명시적으로 지원하며 잘못된 옵션은 종료 작업 전에 거부한다. 기본 down은 볼륨을 보존한다.
- `scripts/keycloak.mjs`, `scripts/storage.mjs`: 인증 거부를 식별해 해당 프로젝트의 볼륨명, `.env` 변수명, 자격 증명 복원 / 같은 프로젝트 `dev-down --volumes` / 다른 `COMPOSE_PROJECT_NAME`이라는 복구 방법을 안전한 stage 요약에 표시한다. 서버 오류·연결 오류는 인증 불일치와 구분한다. MinIO SDK root 인증을 provisioning 전에 검사하고, 컨테이너 내부 `mc alias` 인증 오류도 같은 진단으로 변환한다. 비밀번호 및 원시 인증 응답을 출력하지 않고 볼륨을 자동 삭제하지 않는다.
- 루트 README 실행 절에 프로젝트 분리, 동일 이름으로 시작·종료, 자격 증명 복구, COMPLIANCE와 Docker 볼륨 삭제의 차이를 기록했다.

`COMPOSE_FILE`은 이미 고정 `-f`가 있으므로 지원하지 않으며, 현재 compose 파일에 profiles가 없으므로 `COMPOSE_PROFILES`도 전달하지 않는다. 이 선택은 공통 명령 함수·README·테스트에 명시했다. QA3 보고서는 모든 시작·종료에 `COMPOSE_PROJECT_NAME=toi-qa3`를 사용해 전용 볼륨을 생성했다고 기록한다. 이번 수정은 이후 자식 환경 allowlist 도입으로 끊긴 프로젝트명 전달을 복구하고, `-p`로 명시적으로 고정한다.

## 실제 기동

첫 실행은 요청된 명령 그대로 수행했다.

```sh
COMPOSE_PROJECT_NAME=toi-f4 node scripts/dev-up.mjs
```

[첫 기동 로그](f4-evidence/dev-up.txt): 시작 로그에 `Docker Compose project: toi-f4`가 표시됐고 새 컨테이너 4개·볼륨 4개만 생성됐다. Keycloak identity provisioning과 MinIO storage provisioning은 성공했다. **기존 개발 `.env`의 Verdaccio 토큰이 새 프로젝트의 registry 볼륨과 맞지 않아 registry setup에서 exit 1**이었다. 이 별도 문제를 숨기거나 서비스 소스를 수정하지 않았다.

전체 기동 검증에서는 `.env` 바이트를 메모리에 보관하고 기존 registry 토큰 항목만 임시로 제외한 후, 같은 `COMPOSE_PROJECT_NAME=toi-f4`와 `node scripts/dev-up.mjs`를 실행했다. 새 프로젝트에서 토큰이 자동 발급됐고 **25.757초, exit 0**으로 모든 서비스와 preview health가 준비됐다. [성공 로그](f4-evidence/dev-up-success.txt). 검증·정리 후 보관했던 `.env` 바이트를 복원했다. 이미지·설치 의존성 캐시는 사용했으므로 새 머신 성능 측정은 아니다.

실행 중 추가된 자원은 다음과 같다. `verdaccio-init`은 초기화 후 정상 exit 0, 나머지 3개는 실행 상태였다.

| 컨테이너 | 볼륨 |
|---|---|
| `toi-f4-keycloak-1` | `toi-f4_keycloak-data` |
| `toi-f4-minio-1` | `toi-f4_minio-data` |
| `toi-f4-verdaccio-1` | `toi-f4_verdaccio-storage` |
| `toi-f4-verdaccio-init-1` | `toi-f4_verdaccio-auth` |

위 두 열은 각각의 자원 목록이며 일대일 mount 대응표는 아니다. 전체 `docker ps -a` 기록: [작업 전](f4-evidence/docker-before.txt), [기동 중](f4-evidence/docker-running.txt), [정리 후](f4-evidence/docker-after.txt). 전체 `docker volume ls` 기록: [작업 전](f4-evidence/volumes-before.txt), [기동 중](f4-evidence/volumes-running.txt), [정리 후](f4-evidence/volumes-after.txt). **`toi-lite-*` 컨테이너는 생성되지 않았다.**

## 실제 인증 불일치 및 COMPLIANCE

성공 기동한 `toi-f4`의 Keycloak과 MinIO에 각각 메모리에서 만든 잘못된 비밀번호를 전달해 실제 인증 거부를 유발했다. `.env`에 잘못된 비밀번호를 저장하지 않았다. Keycloak은 `provisionIdentity`, MinIO는 provisioning이 사용하는 `verifyStorageCredentials`를 호출했다. 두 오류 모두 `safeSummary`에 인증 실패, `toi-f4_keycloak-data` / `toi-f4_minio-data`, 복구 명령이 들어 있음을 assert했다. [실제 진단](f4-evidence/live-credential-diagnostics.txt). 서버 비밀번호를 바꾸거나 기존 다른 프로젝트 볼륨을 재사용하지 않았다.

MinIO 감사 버킷에는 별도의 검증 객체를 COMPLIANCE 모드·10분 보존으로 기록했다. root의 특정 버전 S3 삭제가 실제로 거부됐음을 확인한 뒤 객체를 남긴 상태에서 `dev-down --volumes`를 수행했다. **Docker 볼륨 삭제는 성공했다.** S3 object lock은 Docker 볼륨 자체의 삭제를 막지 않는다. README에 객체 삭제는 보존 만료를 기다려야 하고, 개발 데이터 전체 폐기는 명시적인 해당 프로젝트의 볼륨 삭제라는 점을 기록했다. [보존 검증](f4-evidence/compliance.txt), [볼륨 삭제 로그](f4-evidence/dev-down.txt).

## 정리 및 다른 프로젝트 무변경 증거

```sh
COMPOSE_PROJECT_NAME=toi-f4 node scripts/dev-down.mjs --volumes
```

**exit 0**. `toi-f4` 컨테이너 4개·볼륨 4개·네트워크가 제거됐으며 관리 서비스도 종료됐다. 최종 개발 포트 8080·4873·9000·9001·5173·5174·7100·7200·7300·7400의 리스너는 0이다. [리스너 기록](f4-evidence/listeners-after.txt).

자동 비교 [결과](f4-evidence/comparison.txt):

- 기존 컨테이너 **10개**의 ID·이름·상태·StartedAt·FinishedAt이 작업 전후 완전히 동일하다. [전 상세 상태](f4-evidence/container-state-before.txt), [후 상세 상태](f4-evidence/container-state-after.txt).
- 기존 볼륨 **29개** 목록은 작업 전후 바이트 단위로 동일하다. `toi-lite`, `toi-qa*`, `toi-fxb`를 포함한다.
- 기동 중 추가 자원은 `toi-f4`의 컨테이너 4개와 볼륨 4개뿐이며 정리 후 모두 0이다.
- `.env`의 비밀값 16개를 전체 검증 evidence와 비교한 원문 일치는 0이다. 잘못된 비밀번호와 raw admin 응답은 기록하지 않았다.

## 테스트와 남은 사항

[테스트 출력](f4-evidence/tests.txt): `node --test scripts/*.test.mjs`, **17 passed, 0 failed**. Docker allowlist, dev-up의 실제 명령 구성 함수, default/custom 프로젝트명, dev-down 볼륨 옵션, storage exec 구성, Keycloak 401/400 invalid_grant 진단, Keycloak 503 구분, MinIO 인증 오류·연결 오류 구분, mc 오류 코드 매핑과 기존 스크립트 회귀를 검사한다. `git diff --check`도 통과했다.

요청된 F4 수정·실기동·정리는 완료됐다. 별도 발견은 기존 `.env`를 새 Verdaccio 볼륨에 그대로 재사용할 때의 registry 토큰 불일치이며, 현재 setup-registry는 운영자 rotation을 요구한다. 이번 범위에서는 서비스 파일을 수정하지 않았으며, 전체 기동 검증에만 임시 새 토큰을 사용했다. 시작 시 이미 있던 미추적 `test-results/`도 변경하지 않았다.
