# W6-D0: Git 연결 → PR 리뷰 → immutable release → 배포·rollback 설계 (TOSS-GAP P1-1, E2~E5)

공통 제약: [`W6-common.md`](W6-common.md). **설계만** 한다. 코드·계약 수정 금지.

## Target
현재: 소스는 agent-server 로컬 JSON + rename + baseRevision CAS(`services/agent-server/src/store.ts`), Project는 source revision만 가짐(`contracts/src/generation.ts`). release·배포·Git 연동 없음. INTENT의 "라이브 어드민 역추적"(앱 ↔ API 스키마 버전 ↔ 패키지 조합)과 열린 질문 #8(CODEOWNERS·필수 승인자), FOLLOWUPS의 INTENT #8(archive).

## Change
산출물 `docs/P1-RELEASE-DESIGN.md`:
1. source revision ↔ Git commit 매핑 방식 비교(플랫폼이 repo를 소유/사용자 repo 연결/둘 다)와 추천. 로컬 재현은 Gitea 등 Docker 대체물을 쓸 수 있는지.
2. PR·리뷰: 생성 코드 변경이 PR이 되는 조건, CODEOWNERS·API owner 필수 승인, 기존 live 쓰기 4-eyes와의 관계.
3. immutable release record: 포함 필드(source digest, commit, manifest/artifactKey, 사용 API와 스키마 버전, 승인자), 저장 위치, provenance 검증.
4. 배포 대상(로컬에서는 정적 호스팅 + policy-proxy live env)과 promotion·rollback 절차. "화면 rollback ≠ API 쓰기 rollback" 전제 유지.
5. 앱 inventory와 archive/restore(INTENT #8: 알림 → 보존 기간 → 복구 가능한 archive).
6. P1-2(소스 영속화·분산 CAS·빌드 lease)와의 경계와 순서.
7. 작업 그래프: 노드별 범위·계약 변경·수용 기준·의존 관계. 각 노드가 한 작업자 규모가 되게 나눈다.
8. 결정이 필요한 질문 목록(이용자에게 물을 것)과 추천안.

## Constraints
토스 비공개 사항을 사실로 쓰지 않는다(`docs/compare/TOSS-GAP.md` §6). 기존 보안 경계를 약화시키지 않는다.

## Ownership
`docs/P1-RELEASE-DESIGN.md`만.

## Observable acceptance
1~8 절이 있고, 7의 각 노드에 수용 기준이 있다. 8의 질문마다 추천안과 근거가 있다.
