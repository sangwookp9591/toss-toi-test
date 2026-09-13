# TOI-lite 진행 기록

기준 시점: 2026-09-14, `main` QA5 반영 커밋. 이 문서 커밋 전까지의 상태를 기록한다.

## 한눈에 보기

| 단계 | 상태 | 마지막 커밋 | 근거 |
|---|---|---|---|
| 토스 TOI 영상 분석·비평·INTENT | 완료 | `2284666` | 루트 보고서, [`intent/INTENT.md`](../intent/INTENT.md) |
| TOI-lite M1~M4 구현(프리뷰 런타임·deps-builder·policy-proxy·agent-server·studio) | 완료 | `4f9b42c` 전후 | [`ARCHITECTURE.md`](ARCHITECTURE.md), [`tasks/`](tasks/) |
| 보안 리뷰 R1·R2와 수정 F1~F3 | 완료 | `da0df28` | [`review/REVIEW.md`](review/REVIEW.md), [`review/REVIEW-R2.md`](review/REVIEW-R2.md) |
| 새 클론 QA1~QA3와 수정 FX·FX2 | 완료(QA3: 10건 전부 해결) | `a4f48a2` | [`qa/qa3/`](qa/qa3/) |
| 코드 정리(/simplify) | 완료 | `b5e3786` | |
| 토스와 차이 분석 CMP1 | 완료 | `cdbeaa9` | [`compare/TOSS-GAP.md`](compare/TOSS-GAP.md) |
| **P0 구현(P0-1~P0-4)** | 완료 | `5a76cfb` | [`P0-DESIGN.md`](P0-DESIGN.md) |
| **P0 독립 보안 리뷰 R3와 수정 F3-A·F3-B** | 완료 | `7665546` | [`review/REVIEW-R3.md`](review/REVIEW-R3.md) |
| **새 클론 QA4와 수정 F4·F5** | 완료 | `9851f35` | [`qa/qa4/QA4-REPORT.md`](qa/qa4/QA4-REPORT.md), [`../e2e/F5-REPORT.md`](../e2e/F5-REPORT.md) |
| **새 클론 QA5(F5 재검증)** | **통과: QA4 대상 8항목 전부 해결, E2E 123/123, P0 실사용 검증 "예"** | `0723efb` 기준 검증 | [`qa/qa5/QA5-REPORT.md`](qa/qa5/QA5-REPORT.md) |

## P0에서 한 일

진행 방식: Opus 계약·명세 → Astra/high 병렬 구현 → 코디네이터 재실행 검증 → Opus 독립 보안 리뷰 → 수정 → 새 클론 QA → 수정.

### 구현

| P0 | 결과 | 커밋 | 명세 |
|---|---|---|---|
| P0-1 식별·권한 | Keycloak 26.3.3(PKCE 로그인), 프로젝트 역할 owner/editor/viewer, 비멤버 404, live 쓰기 4-eyes 승인·만료, preview/live 데이터·토큰 분리, dev session 제거 | `788c742` | [`tasks/P0A-identity.md`](tasks/P0A-identity.md), [`tasks/P0A2-studio-e2e.md`](tasks/P0A2-studio-e2e.md) |
| P0-4 로컬 모델 평가 | Ollama 드라이버(native·json-content), 14케이스 모델 중립 평가 하네스 | `d65e7fd` | [`tasks/P0D-local-model-eval.md`](tasks/P0D-local-model-eval.md) |
| P0-2 프리뷰 격리 | 프로젝트별 origin `p-<uuid>.preview.localhost:5174`, 응답별 nonce CSP, AST source policy, 서비스별 env allowlist, mock 토큰 필수 | `5a76cfb` | [`tasks/P0C-preview-isolation.md`](tasks/P0C-preview-isolation.md) |
| P0-3 다운로드·감사 | AES-256 ZIP + AES-256-GCM 봉투 암호화, 60초·1회 서명 URL, 해시 체인 감사·fsync·MinIO 불변 복제·fail-closed | `5a76cfb` | [`tasks/P0B-downloads-audit.md`](tasks/P0B-downloads-audit.md) |

### 리뷰·QA 발견과 처리

| 출처 | ID | 심각도 | 내용 | 처리 커밋 |
|---|---|---|---|---|
| R3 | R3-M1 | medium | 미복제 감사 tail을 잘라내고 재시작하면 탐지 안 됨 | `7665546` 외부 앵커 |
| R3 | R3-M2 | medium | 프리뷰 자기 내비게이션으로 토큰·마스킹 데이터 유출 | `7665546` frame 토큰 제거·@toi/fetch 브로커·`connect-src 'none'`·내비게이션 복구 |
| R3 | R3-L1 | low | 감사 객체 retention 미설정 | `7665546` COMPLIANCE retention |
| R3 | R3-L2 | low | 프리뷰 CSP `script-src data:` | `7665546` nonce 인라인 module |
| QA4 | Q4-N01 | high | docker 자식 env에 `COMPOSE_PROJECT_NAME` 누락 → 다른 프로젝트 볼륨 사용 | `92469f1` compose `-p`·자격 증명 불일치 진단 |
| QA4 | Q4-N02 | medium | 제거된 멤버에게 "고객이 없어요" 표시 | `9851f35` 접근 철회 안내·편집 잠금·주기 확인 |
| QA4 | Q4-N03 | low | viewer 다운로드 비활성 이유 없음 | `9851f35` 권한 안내·aria 설명 |
| QA4 | Q4-D02~D04 | 문서 | README의 옛 토큰·CSP·공유 origin 설명, AES ZIP 해제 안내 없음 | `9851f35` |
| QA5 | Q5-D01 | low(문서) | studio README의 `@toi/fetch` 버전 표기가 1.1.0(실제 1.1.1) | QA5 반영 커밋에서 수정 |
| 구현 중 | E2E K 간헐 실패 | — | R 시나리오의 공유 클라이언트 TTL 누수 + 토큰 갱신 중 만료 이벤트가 앱 상태 초기화 | `788c742` |

[`FOLLOWUPS.md`](FOLLOWUPS.md)의 L2(프리뷰 CSP), L6(자식 프로세스 env), L7(공유 프리뷰 origin·스튜디오 framable)은 P0-2와 R3 수정으로 닫혔다.

## 현재 검증 상태 (`9851f35`, 코디네이터 재실행)

| 대상 | 결과 |
|---|---|
| studio | typecheck·test 25 |
| preview-runtime | typecheck·test 43 + 브라우저 26 |
| agent-server | typecheck·test 125 (+1 선택 실행 skip) |
| deps-builder | typecheck·test 16 (서비스 기동 상태에서) |
| policy-proxy·mock-backend·contracts | typecheck·test 통과 |
| scripts / evals scorer | 17 / 7 |
| E2E `node scripts/dev-up.mjs --e2e` → `npm --prefix e2e run test:repeat` | 123/123 (41 시나리오 × 3) |

주의: preview-runtime 브라우저 테스트와 deps-builder 통합 테스트는 서비스(5173·7100·MinIO·Verdaccio)가 떠 있어야 통과한다.

### QA5 새 클론 재검증 (`0723efb`, `~/Projects/toi-lite-qa5`, `COMPOSE_PROJECT_NAME=toi-qa5`)

| 항목 | 결과 |
|---|---|
| 무준비 기동 | 41.367초, 새 자원은 모두 `toi-qa5`, 다른 프로젝트 자원 전후 동일 |
| Q4-N02 제거된 멤버 | 조회 137ms에 접근 불가 안내, UI 잠금, 주기 감지·처음 화면 복귀 유지 |
| Q4-N03 viewer 다운로드 | 권한 설명·버튼 비활성·aria 연결, editor 승격 후 다운로드 성공 |
| Q4-D02~D04 문서 | README 설명이 실제 frame 검사와 일치, 실제 ZIP이 AES-256 AE-2 |
| 핵심 회귀 스팟 | 통과 |
| E2E 3회 반복 | 123/123 |
| 종료 | 포트 9개·서비스·`toi-qa5` 자원 0, 산출물 비밀값 일치 0 |

## 로컬 모델 실측 (P0-4)

`qwen2.5-coder:7b`(Ollama 0.33.3), 14케이스 1회. 상세: [`../evals/results/comparison-2026-09-13T11-43-16-024Z.md`](../evals/results/comparison-2026-09-13T11-43-16-024Z.md)

| 방식 | 도구 호출 | 생성 완료 | 업무 UI 통과 |
|---|---:|---:|---:|
| native tool calling | 0 | 0/14 | 0/12 |
| json-content | 88 | 7/14 | 0/12 |

7B 로컬 모델로는 업무 화면을 만들지 못했다. Claude 비교는 키·비용 한도가 없어 실행하지 않았다.

## 남은 위험

- 렌더링된 마스킹 데이터는 프리뷰 내비게이션 쿼리스트링으로 단방향 유출될 수 있다(토큰은 유출되지 않음).
- 감사 앵커 주기(1초·50건) 안의 최근 기록은 외부 앵커가 없다.
- 운영에는 KMS와 WORM 저장소가 필요하다(현재 env KEK·로컬 MinIO).
- 로컬 HTTPS, Keycloak 운영 구성(외부 DB·HA)은 범위 밖이다.

## 후속 과제

| 항목 | 출처 |
|---|---|
| root·runtime 성능 벤치의 프로젝트별 origin 이행 | [`../e2e/P0C-REPORT.md`](../e2e/P0C-REPORT.md) |
| 기존 `.env`를 새 Verdaccio 볼륨에 재사용할 때 registry 토큰 불일치(rotation 필요) | [`../scripts/F4-REPORT.md`](../scripts/F4-REPORT.md) |
| 도구 호출이 안정적인 로컬 모델 또는 Claude로 같은 평가 | P0-4 |
| `evals/scorer.test.mjs`는 tsx 로더가 필요하다는 README 보완 | P0-4 검증 |
| FOLLOWUPS의 L1·L4·L5·INTENT #8·운영 항목 | [`FOLLOWUPS.md`](FOLLOWUPS.md) |

## 결정 대기

1. 로컬 모델 교체 실측, Claude 실측, 또는 현재 결과로 종료
2. 로컬 QA 클론(`~/Projects/toi-lite-qa`~`qa5`)과 `toi-qa*`·`toi-fxb` 볼륨 정리 여부

원본 개발 환경은 QA5를 위해 내려 둔 상태다. 다시 쓰려면 `node scripts/dev-up.mjs`.

## 운영 기록

- R3 보안 리뷰는 Opus 5 안전 장치가 사이버 작업으로 분류해 Claude Code가 Opus 4.8로 자동 전환한 상태로 진행했다.
- QA4 자동화 중 이미 만료·미사용 ZIP 비밀번호 1개가 워커 도구 출력에 일시 표시됐다. 보고서·캡처·커밋에는 없다(QA4 보고서 8절).
- 커밋마다 실제 `.env` 값과 대조해 비밀값 포함 여부를 검사했다. 공개 값인 issuer URL 외 일치는 없었다.

## 다시 시작하는 법

```bash
node scripts/dev-up.mjs            # 기본 프로젝트 toi-lite, .env 무작위 비밀값 생성
node scripts/dev-up.mjs --e2e      # 승인 TTL 8초 등 E2E 설정
npm --prefix e2e run test:repeat   # 41 시나리오 × 3
COMPOSE_PROJECT_NAME=<이름> node scripts/dev-up.mjs   # 별도 환경
node scripts/dev-down.mjs [--volumes]
```

테스트 사용자 비밀번호는 `.env`에 있다. 로그인 방법·역할표·승인 흐름은 루트 [`README.md`](../README.md)를 본다.
