# TOI-lite 후속 과제

1차 범위는 R2 판정(남은 critical/high 없음)과 F3 수정(R2 medium N1~N5, L3)으로 종료했다. 아래는 의도적으로 남긴 항목이다. 출처는 [`docs/review/REVIEW-R2.md`](review/REVIEW-R2.md)와 [`intent/INTENT.md`](../intent/INTENT.md)이다.

| ID | 심각도 | 내용 | 권고 방향 | 담당 |
|---|---|---|---|---|
| L1 | low | 잔여 PII 스캔이 문자열만 검사한다. 숫자 타입 주민번호·계좌, 전각 숫자, 필드 분할은 탐지하지 못한다. | 숫자 노드도 `String()`으로 스캔하고 NFKC 정규화한다. 등록 스키마에 없는 응답 키를 경고한다. | policy-proxy |
| L2 | low | 생성 코드 텍스트 검사는 동적 조합으로 우회할 수 있고, 프리뷰에 CSP가 없다. | 프리뷰 frame에 `connect-src`·`img-src` CSP를 적용한다. 방어의 중심은 서버 측 Origin 판정으로 유지한다. | studio dev server, preview-runtime |
| L4 | low | upstream 응답 크기에 상한이 없다. 20MB 응답이면 이벤트 루프가 약 6.6초 막힌다. | 응답 바이트 상한(예: 5MB, 초과 시 502)을 둔다. `sanitize`는 한 번만 적용한다. | policy-proxy |
| L5 | low | deps-builder에서 cleanup이 실패하면 `builds` 맵에 항목이 남는다. store가 응답하지 않으면 무기한 대기한다. | `finally`에서 먼저 delete하고, store 조회에 타임아웃을 둔다. | deps-builder |
| L6 | low | dev-up이 전체 env를 모든 자식 프로세스에 넘겨 mock-backend가 서명키를 갖는다. mock-backend에 기본 토큰 fallback이 남아 있다. | 서비스별로 필요한 키만 allowlist로 넘기고, 기본값 fallback을 제거한다. | scripts, mock-backend |
| L7 | low | 모든 프로젝트가 프리뷰 origin을 공유한다. 스튜디오가 프레임으로 삽입될 수 있다. | 스튜디오에 `frame-ancestors 'self'`를 둔다. 5174는 frame 자산만 제공하고, 프로젝트별 프리뷰 origin을 둔다. | studio |
| M2 잔여 | low | 등록 API 데이터를 통한 프롬프트 인젝션. 정책 프록시를 우회하지는 못한다. | L2와 함께 처리한다. | agent-server |
| INTENT #8 | 미구현 | 미릴리즈 앱에 대한 알림 → 보존 기간 → 복구 가능한 archive 흐름이 없다. | 앱 인벤토리(owner·release·마지막 사용), inactive 정의, archive/restore API를 만든다. | agent-server + studio |
| 운영 | 범위 밖 | 실제 SSO, 분산 lock(single-flight), artifact GC, 멀티 인스턴스 CAS, 실제 Claude 모드 E2E | 운영 설계 단계에서 다룬다. | 전체 |
