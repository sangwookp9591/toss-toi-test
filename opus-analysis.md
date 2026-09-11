# Opus 독립 분석 — 토스 "AI 시대 어드민(TOI)" (재진행)

근거 등급: [확인] 발표·공식 글 명시 / [추정] 맥락·관행 추론 / [검증필요] Astra 실측·조사 대상.
원칙: 공개된 구현을 "누락"으로 비판하지 않는다. "언급 없음"과 "없음"을 구분한다.

## A. 왜 esbuild-wasm인가
요구: 브라우저 안에서 TSX 변환 + import 해석·번들 + 가상 FS 연결 + 반복 빌드.
1. **한 wasm으로 변환기+번들러**를 해결하는 성숙 옵션이 사실상 esbuild뿐이었다 [추정]. SWC/Sucrase/Babel은 변환기라 모듈 그래프 연결을 직접 만들어야 한다.
2. 플러그인 `onResolve/onLoad`가 **경로→내용 VFS와 1:1로 대응** [확인: VFS를 플러그인으로 연결].
3. `context.rebuild()` 증분, `external`로 import map 키만 외부화 → 번들 대상이 사용자 코드뿐이라 수십 ms급 [검증필요].
4. 대안 Rolldown(Vite 8 코어)은 2026-09엔 브라우저 빌드가 존재하나 SharedArrayBuffer·격리 헤더 요구 가능성 [검증필요] — 채택 비용은 속도보다 **격리 정책**.
약점: wasm 수 MB 다운로드, 타입체크 없음, CSS/asset 처리 제한.

## B. 왜 yarn인가
1. **조직 자산 재사용** [추정·강함]: 토스는 Yarn Berry 모노레포 조직으로 알려져 있다. 사내 registry 스코프·인증·캐시 운영이 yarn 기준. Sandpack 탈락 핵심이 "사내 패키지"였던 점과 맞물림.
2. lockfile 결정성 → Package Set Hash 재료. 그러나 결정성은 pnpm/npm/bun도 제공 [검증필요] → **yarn은 필연이 아니라 관성의 합리적 선택**.
3. 병목은 설치 속도가 아니라 **새 조합 준비 전체(install+Vite build+upload)와 동시 miss** [추정].

## C. 놓쳤거나 발표에서 다루지 않은 것
1. **Package Set Hash ≠ 빌드 산출물 identity** [검증필요]: lock 바이트 해시는 무의미한 변화(공백 등)에 흔들리고, Vite/플러그인/target/define 변화에는 둔감할 수 있다.
2. **"트랜잭션 커밋"은 화면만 되돌린다**: 프리뷰가 실행 중 보낸 POST 등 API side effect는 롤백 불가 → 프리뷰 기본 read-only/mock capability 필요.
3. **1.3초의 정의 부재**: cold/warm, 서버 artifact hit/miss, 브라우저 캐시, p50/p95.
4. **수명주기**: 라이브 ~120개의 React/TDS 업그레이드, API 계약 변경 시 영향 앱 역추적, 미릴리즈 앱 정리 정책 — 발표 범위 밖 [언급 없음].
5. **실행 보안 경계**: 서버 프록시는 데이터 정책을 지키지만 화면 데이터의 외부 유출(fetch·이미지·폼)은 못 막는다. 프리뷰 origin 분리·CSP·sandbox·제한된 postMessage 브리지의 존재는 [unverifiable].
6. **검증 게이트**: 번들/실행 성공 외 타입체크·계약 검사·상태별 smoke test가 publish gate에 연결되는지 [언급 없음].

## D. 더 잘 만들 수 있었나 (우선순위)
1. **의존성 캐시 2단 구조**: 패키지 단위 immutable ESM 산출물(peer external) + 프로젝트별 고정 resolution manifest. 싱글톤은 import map의 단일 URL로 보장, 새 조합은 "조합 전체 재빌드" 대신 기존 산출물 재조합 [검증필요: 싱글톤 유지]. 단 조합이 소수 카탈로그로 수렴하면 현재 방식이 더 단순 → **적중률·조합 분포 선측정**.
2. **artifact key 확장**: entries + 정규화된 resolved graph + PM/Vite/plugin 버전 + target/define + registry 정책 네임스페이스.
3. **프리뷰 capability 모델**: read-only 기본, write는 명시 세션·범위·멱등키.
4. **운영 인벤토리**: 앱↔owner↔API 스키마 버전↔패키지 manifest↔release 역인덱스, codemod→검증→단계 배포.
5. **혼합 런타임**: 빠른 FE 프리뷰는 유지, SSR·통합테스트·Node 도구는 원격 샌드박스(microVM)로.

## E. 채팅으로 어드민을 만들 때 Backend 통신 [추정 중심]
확인 가능한 골격: API 등록 → 에이전트가 스키마·패턴 참고해 코드 생성 → 코드 S3 저장 → 브라우저 메모리 VFS·esbuild로 프리뷰 → 생성 UI의 데이터 호출은 서버 프록시(정책·감사) → 사내 서비스. 의존성은 서버에서 조합별 빌드 → S3 → import map.
제안 설계(추정):
```
POST /generations {projectId, prompt, baseRevision}
GET  /generations/{id}/events   (SSE 등, seq 기반 재연결)
  events: text · question(역질문) · file · complete(revision)
→ staging VFS 반영 → complete revision 단위 번들 → 실행 성공 시 프리뷰 교체
의존성 서버: registry 자격증명으로 install/build → immutable ESM + manifest → S3/CDN(접근 제어)
생성 UI → 플랫폼 프록시(user+project+registered API+action 권한) → 정책·감사 → upstream
```
"역질문(User Question)"이 특정 SDK(예: Agent SDK의 AskUserQuestion)를 뜻한다는 근거는 이름 유사성뿐 → 판별 근거로 쓰지 않는다.
