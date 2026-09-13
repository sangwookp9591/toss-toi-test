# P0 설계: TOI-lite를 실사용 수준으로 올리기

출처는 [`docs/compare/TOSS-GAP.md`](compare/TOSS-GAP.md) §5의 P0 우선순위이며, 이용자가 다음 결정을 내렸다.

| 결정 | 선택 |
|---|---|
| 식별(IdP) | Keycloak (Docker, realm `toi`) |
| 다운로드 보호 | 서버 봉투 암호화 보관 + 단기 서명 URL + AES-256 ZIP·1회 표시 비밀번호 (둘 다) |
| 모델 평가 | 로컬 모델 Ollama + `qwen2.5-coder:7b`로 실제 실행. 평가셋은 모델 중립(키가 생기면 Claude로 같은 평가) |
| 진행 | Opus 계약·명세 → Astra/high 병렬 구현 → 코디네이터 재실행 → Opus/high 독립 보안 리뷰 → 수정 → 새 클론 QA |

## 범위와 계약

| P0 | 결과 | 계약 | 웨이브 |
|---|---|---|---|
| P0-1 | Keycloak 로그인(PKCE), 프로젝트 멤버십(owner/editor/viewer), live 쓰기 4-eyes 승인, preview/live upstream 분리, 프리뷰 하향 세션, dev session 제거 | `contracts/src/auth.ts`, `policy.ts` `environments`·`owners` | 1 |
| P0-4 | agent-server 로컬 모델 드라이버(Ollama tool calling), 모델 중립 평가 하네스(다중 업무 API·스키마·프롬프트 인젝션·취소·실패), 비용·시간 한도 | 드라이버는 기존 `AgentDriver` 인터페이스 | 1 |
| P0-3 | `POST /downloads` → CSV/XLSX 생성 → AES-256-GCM 봉투 암호화 저장 → 60초·1회 서명 URL → AES-256 ZIP. 감사 해시 체인·fsync·세그먼트 복제·검증 API·fail-closed | `policy.ts` `Download*`, `AuditRecord.seq/prevHash/hash` | 2 |
| P0-2 | 프로젝트별 프리뷰 origin(`p-<id>.preview.localhost`), 프리뷰 CSP(connect-src·frame-ancestors), 5174는 frame 자산만, 스튜디오 frame-ancestors 'self', 서비스별 env allowlist, mock-backend 기본 토큰 제거 | `runtime.ts` 확장(웨이브 2에서 추가) | 2 |

## 의도적 제외와 이유

- **HTTPS**: 로컬에서 신뢰할 수 있는 인증서를 쓰려면 시스템 신뢰 저장소에 CA를 추가해야 한다. 사용자 머신 설정을 바꾸는 일이라 이번 범위에서 제외하고, 배포 구성 문서에 TLS 종단 요구사항으로 남긴다. `*.localhost`는 브라우저에서 secure context로 취급된다.
- **Keycloak 운영 구성**(외부 DB, HA, 실제 사내 IdP 연동)은 제외한다. realm은 import JSON으로 재현한다.

## 테스트 사용자 (realm import, 비밀번호는 dev-up이 무작위 생성해 `.env`에 저장)

| 사용자 | group | realm role | 용도 |
|---|---|---|---|
| `alice` | `/team-a` | builder | 프로젝트 owner |
| `bob` | `/team-a` | builder | 멤버 추가 후 editor/viewer 전환 |
| `carol` | `/team-b` | builder | 비멤버 접근 거부 |
| `dana` | `/risk` | api-owner | customers API live 쓰기 승인자 |
| `root` | `/platform` | platform-admin | API 등록·감사 검증 |
