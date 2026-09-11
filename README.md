# toss-toi-test

토스 FE 웨비나 「AI 시대, 토스 FE는 어떻게 일할까」(2026-08-25)의 **AI 시대 어드민(TOI)** 세션을 1차 자료와 직접 실측으로 분석한 기록입니다.
토스와 무관한 독립 분석이며, 모든 수치는 공개 자료와 이 저장소의 PoC에서 나왔습니다.

- 분석·종합: Claude Opus / 실측·조사: Codex Astra (high) / 상호 비평 2라운드
- 기준일: 2026-09-11 · 측정 환경: Apple M4, macOS 26.6.2, Node v22.14.0, Chrome 153 · 3회 반복 중앙값

## 핵심 결론

1. **47초 → 1.3초는 esbuild 덕이 아닙니다.** 의존성 준비를 편집·프리뷰 경로에서 떼어낸 아키텍처 전체의 결과입니다.
2. **esbuild-wasm도 yarn도 필연은 아니었습니다.**
   - 번들 없는 방식(Oxc 변환 + blob URL + import map)은 첫 화면이 132ms로 esbuild 300ms보다 빨랐지만, 수정 반영은 약 50ms로 동률이었습니다.
   - 패키지 매니저 5종 모두 lockfile을 3회 생성해도 같았습니다.
3. **가장 큰 빈칸은 엔진이 아니라 운영입니다.**
   - Package Set Hash에는 빌드 도구·설정 변화가 반영되지 않습니다.
   - 프리뷰 "트랜잭션"은 화면만 되돌리고, 이미 보낸 API 쓰기는 되돌리지 못합니다.
   - 라이브 앱의 수명주기를 추적하는 방법이 공개되지 않았습니다.
4. **Sandpack을 버린 이유**: 런타임 의존성 다운로드 때문에 첫 화면이 47초였고, 사내 레지스트리 인증 프록시(tarball URL 재작성, 전이 의존성, CORS/PNA) 비용이 컸습니다. 불가능해서가 아니라 비용과 통제권의 트레이드오프였습니다.
5. **Rolldown browser 1.2.8**은 COOP/COEP 격리가 없으면 3/3 실패했습니다.

## 구성

| 경로 | 내용 |
|---|---|
| [`site/index.html`](site/index.html) | 공유용 요약 페이지 (브라우저로 열기) |
| [`intent/INTENT.md`](intent/INTENT.md) | "채팅으로 어드민을 만드는 플랫폼"의 proto-spec (draft). [AI-native SDLC Playbook](https://academy.claude.com/courses/ai-native-sdlc-playbook/capture-intent)의 Capture Intent 형식을 따름 |
| [`astra-report.md`](astra-report.md) | Astra 1차 조사·실측 보고서: 1차 자료, 번들러 비교, 싱글톤 실증, 패키지 매니저·해시 검사, 대안 |
| [`opus-analysis.md`](opus-analysis.md) | Opus 독립 분석 |
| [`opus-critique.md`](opus-critique.md) | Opus → Astra 비평과 자기 수정 |
| [`astra-critique.md`](astra-critique.md) | Astra → Opus 비평: 번들 없는 방식 실측, 측정 경계 정정, Backend 경합 설계, 합의 표 |
| [`astra-spec.md`](astra-spec.md) | Astra에게 준 작업 명세 |
| [`poc/`](poc/) | 벤치마크 소스, 원시 결과 JSON, 로그 ([`poc/README.md`](poc/README.md), [`poc/critique/README.md`](poc/critique/README.md)) |

## 재현

```sh
cd poc && npm ci && npm run bench           # 번들러·설치·해시 벤치 (README 참고)
cd poc/critique && node prepare.mjs         # 브라우저 헬퍼 번들 생성
node run-browser.mjs && node validate.mjs   # 번들 없는 방식·분해 측정
```

브라우저 벤치는 시스템 Chrome과 `playwright-core`가 필요합니다. `poc/public/`(사전 번들한 서드파티 라이브러리)과 `poc/critique/tools.js`는 준비 스크립트가 다시 만듭니다.

## 저장소에 포함하지 않은 것

보고서 일부는 아래 파일에 링크하지만, 저작권과 재배포 문제 때문에 이 공개 저장소에서는 뺐습니다. 원문은 출처에서 확인하세요.

- 웨비나 자동 자막과 메타데이터 (`poc/evidence/webinar*`, `transcript-*.txt`) → [전체 웨비나](https://youtube.com/live/xDVbTlFfu30), [편집본](https://www.youtube.com/watch?v=tcGKZANuUVE)
- 토스 기술 글 HTML 사본 (`poc/evidence/toss-52885.html`) → [AI가 만든 코드가 어드민이 되기까지](https://toss.tech/article/52885)
- 조사 중 수집한 웹 문서 원문 (`poc/evidence/source-*.txt`). URL 목록은 [`poc/evidence/source-index.json`](poc/evidence/source-index.json)에 남겨 둠
- `node_modules`, 패키지 매니저 캐시, 사전 번들한 서드파티 라이브러리

## 한계

Apple M4 한 대, 작은 fixture, 3회 중앙값입니다. 큰 모듈 그래프, CSS·asset, 사내 레지스트리, WAN p95, 동시 빌드 경합은 측정하지 못했습니다. 어느 수치도 토스의 1.3초를 독립적으로 재현한 것이 아닙니다. 공개되지 않은 토스 내부 구현은 보고서에서 `unverifiable`로 표시했습니다.
