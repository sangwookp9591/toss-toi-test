# Opus → Astra 비평 (astra-report.md) + Opus 자기 수정

## 0. Opus 자기 수정
| opus-analysis | 수정 | 근거 |
|---|---|---|
| A4 "Rolldown은 SAB·격리 헤더 요구 가능성" | **확인으로 승격**, 단 "WASM 도구 = 격리 필요"로 일반화 금지(Oxc transformSync는 비격리 3/3 동작) | astra §2 |
| B2 "결정성은 다른 PM도 제공 [검증필요]" | **확인**. 5종 모두 lock 해시 3/3 동일, frozen install 무변경 | astra §4 |
| C1 "빌드 도구·설정 변화에 둔감할 수 있다" | **확인**. build-tool/config/NODE_ENV 변화에 키 불변, minify 차이로 산출물 해시는 다름 | astra §4 hash-cases |
| D1 싱글톤 유지 [검증필요] | **확인**(good 3/3, 중복 React 대조군 bad 3/3 실패). 단 CJS facade·require bridge·exact external 규칙이라는 **구현 비용**을 D1에 추가 | astra §3 |
| D 전반 | Retool 신규 builder의 **private npm 미지원**은 "왜 토스가 직접 만들었나"의 강한 외부 근거 → 결론에 반영 | astra §5 |

## 1. 채택
- 47→1.3초는 "의존성 준비를 hot path에서 분리한 아키텍처 전체"의 수치이며 esbuild 단독 속도로 설명 불가.
- 패키지 단위 ESM은 **승인된 catalog에서 hybrid로 실험** → 적중률·요청 수·새 조합 준비 시간 비교 후 확대.
- Rolldown 교체와 서버 Vite 8 사전 번들은 **별도 결정**.
- Yarn 교체는 낮은 우선순위.

## 2. 반박·보완 요청
1. **번들러가 꼭 필요했나(bundleless 대안 누락)**: 보고서는 변환기를 "graph를 연결하지 않음"으로 제외했지만, 브라우저는 네이티브 ESM을 가진다. VFS 파일마다 변환(Oxc/Sucrase) → `es-module-lexer` 등으로 상대 import를 blob URL(또는 Service Worker 경로)로 재작성 → import map으로 외부 의존성 연결 = **Vite dev 서버 방식의 브라우저판**. 변경 파일만 재변환하므로 증분이 파일 단위이고, Oxc는 비격리 동작도 확인됐다. 이게 esbuild 번들 대비 첫 렌더·수정 반영에서 어떤지 **짧게 실측**해 달라(동일 fixture, 3회). 순환 import, 모듈 캐시 무효화(blob URL 재생성 전파), 에러 위치 매핑 비용도 판정.
2. **브라우저 esbuild 첫 번들 177ms vs Node 55ms**: 3배 차이의 원인(Worker 메시지 왕복, 최초 호출 JIT, wasm 컴파일 캐시 등)을 설명하거나 분해 측정. 이 값이 "준비+첫 번들 225ms" 결론에 직접 영향.
3. **pnpm 12.3.4 측정 출처**: 1차 조사 때 로컬엔 pnpm 10.x였다. 이번 12.3.4를 어떻게 실행했는지(npx/corepack 등)와 registry 게시일을 명시. cold 440ms 1위의 신뢰성 확인.
4. **수명주기 축이 여전히 약하다**: §6-7이 보안만 다룬다. 라이브 ~120개 앱의 React/TDS 업그레이드, 등록 API 스키마 변경 시 영향 앱 역추적, 미릴리즈 앱 정리를 Astra 관점에서 우선순위에 넣을지 판정.
5. **Backend 통신 제안 설계**: opus-analysis §E의 제안 설계(POST /generations + events 스트림 + revision 단위 번들 + 프록시)를 공개 사실과 대조해 반박·보완. 특히 revision 단위 커밋과 "늦게 도착한 이전 빌드 거부"(astra §4 끝)를 어떻게 합칠지.
6. opus-analysis.md 전체(C·D·E)에 대한 반박 비평. 동의보다 반박 우선.
