import json
import statistics
from pathlib import Path

base = Path(__file__).resolve().parent
b = json.loads((base/'evidence/browser.json').read_text())
n = json.loads((base/'evidence/node-decompose.json').read_text())
p = json.loads((base/'evidence/pnpm-provenance.json').read_text())
install = json.loads((base.parent/'evidence/install-results.json').read_text())

def cell(vals):
    return ', '.join(f'{v:.3f}' for v in vals) + f' → **{statistics.median(vals):.3f}**'

def get(r, key):
    for k in key.split('.'):
        r = r[k]
    return r

def render_table(keys, maps):
    s = '| 방식 | ' + ' | '.join(label for key,label in keys) + ' |\n'
    s += '|---|' + '---|'*len(keys) + '\n'
    for kind in ['bundleless','esbuild']:
        rows = [r for r in b['render'] if r['kind']==kind and r['maps']==maps]
        s += '| ' + ('Oxc 파일별 변환·재연결' if kind=='bundleless' else 'esbuild context·rebuild') + ' | '
        s += ' | '.join(cell([get(r,key) for r in rows]) for key,label in keys)+' |\n'
    return s

def decomp_table():
    s='| 실행 조건 | JS import | initialize | empty probe | context | 첫 bundle | context+첫 bundle | 준비 포함 첫 bundle |\n|---|---|---|---|---|---|---|---|\n'
    for label, rows in [
        ('Chrome worker, probe 없음',[r for r in b['decompose'] if r['worker'] and not r['probe'] and not r['precompile']]),
        ('Chrome worker, probe 있음',[r for r in b['decompose'] if r['worker'] and r['probe']]),
        ('Node, probe 없음',[r for r in n if not r['probe']]),
        ('Node, probe 있음',[r for r in n if r['probe']]),
    ]:
        s+='| '+label+' | '+' | '.join(cell([r[k] for r in rows]) if k in rows[0] else '미실행' for k in ['import_ms','initialize_ms','empty_probe_ms','context_ms','first_bundle_ms'])+' | '+cell([r['context_ms']+r['first_bundle_ms'] for r in rows])+' | '+cell([r['to_first_ms'] for r in rows])+' |\n'
    return s

def worker_table():
    s='| Chrome 조건 | 별도 fetch+compile | initialize | context | 첫 bundle | 변경 rebuild | 준비 포함 첫 bundle |\n|---|---|---|---|---|---|---|\n'
    for cfg in [(True,False,False),(False,False,False),(False,True,False),(True,False,True)]:
        rows=[r for r in b['decompose'] if (r['worker'],r['probe'],r['precompile'])==cfg]
        s+=f'| worker={cfg[0]}, probe={cfg[1]}, precompile={cfg[2]} | '+' | '.join(cell([r[k] for r in rows]) if k in rows[0] else '미분리' for k in ['fetch_compile_ms','initialize_ms','context_ms','first_bundle_ms','rebuild_ms','to_first_ms'])+' |\n'
    return s

pm=next(r for r in install['results'] if r['name']=='pnpm')
text='''# Astra → Opus 상호 비평 및 추가 실측

작성 기준: 2026-09-11. 읽은 문서: [Opus 독립 분석](opus-analysis.md), [Opus 비평](opus-critique.md), [기존 Astra 보고서](astra-report.md). Opus 문서 및 기존 Astra 보고서는 수정하지 않았다. 이 문서가 기존 측정 해석을 보완·정정한다.

**핵심 정정:** bundleless는 실행 가능한 대안이며 이번 작은 DAG에서는 첫 화면 준비가 더 빨랐다. 그러나 변경 후 화면 반영은 두 방식이 약 50ms로 같았다. 기존 Node 55ms 대 Chrome 177ms를 런타임 자체의 3배 차이로 읽으면 안 된다. Node에만 empty transform 예열이 있었고, context 포함 여부도 명시해야 한다.

근거 표기: **확인**은 코드·원시 실측 또는 공개 1차 자료, **추정**은 그로부터의 해석, **제안**은 미구현 설계, **unverifiable**은 현재 공개 자료·실험만으로 확정 불가다. 아래 숫자는 ms, `1회, 2회, 3회 → 중앙값`이다. 3표본은 통계적 우월성이나 p95를 입증하지 않는다.

## 1. Opus §2 여섯 요청 판정

| 요청 | 판정 | 근거와 수정 |
|---|---|---|
| 2-1 bundleless 누락 | **수용** | 변환기가 번들러가 아니라는 분류는 맞지만, 브라우저 ESM과 직접 만든 linker를 합친 대안을 제외할 이유는 아니다. §2에서 실행까지 검증했다. “esbuild가 꼭 필요”는 철회하고 “직접 loader 구현 부담을 줄이는 합리적 선택”으로 제한한다. |
| 2-2 177ms 대 55ms 원인 | **수용** | 기존 두 benchmark의 사전 probe 경계가 달랐다. §3에서 양쪽 probe 유무를 맞추고 context·첫 rebuild를 분리했다. Worker 왕복이나 JIT가 3배 차이의 원인이라는 단정은 반박한다. |
| 2-3 pnpm 12.3.4 출처 | **부분수용** | 실행 경로·게시 시각을 더 명시해야 한다는 요청은 수용한다. 로컬 PATH의 10.x와 이번 12.3.4가 다른 실행 경로라는 점을 확인했다. 고정 설치된 Mach-O 바이너리를 직접 실행했다. 440ms는 해당 fixture의 관찰값이며 보편 순위가 아니다. |
| 2-4 수명주기 우선순위 | **수용** | 보안만으로 운영 위험을 충분히 설명하지 못했다. 앱·owner·release·패키지·API 계약 역인덱스와 만료 앱 정책을 엔진 교체보다 앞에 둔다. 다만 TOI에 그 기능이 없다는 주장은 하지 않는다. §5에 단계별 우선순위를 추가했다. |
| 2-5 Backend 통신 제안 | **부분수용** | generation/event/revision/proxy 골격은 타당한 제안이다. complete 이벤트만으로 commit하면 경합을 막지 못한다. 서버 CAS, 최신 의도 revision 검사, manifest digest, 질문 응답·취소·실패·재연결 계약을 보완해야 한다. 공개된 실제 API라는 해석은 반박한다. |
| 2-6 C·D·E 반박 | **수용** | §5에서 단일 URL의 보장 범위, lock 정규화의 우선순위, 화면 rollback과 API 영향, lifecycle, hybrid runtime의 적용 조건, stream commit 경계를 비평했다. |

## 2. Bundleless 실행과 첫 렌더·수정 반영

### 방법과 측정 경계

명령: `cd poc/critique && TMPDIR="$PWD/.tmp" node run-browser.mjs > evidence/browser.log 2>&1`.
검증: `node validate.mjs`. 원시값: [browser.json](poc/critique/evidence/browser.json), [browser.log](poc/critique/evidence/browser.log). 재현 절차: [README](poc/critique/README.md).

'''
text+=f"환경: 측정 UTC `{b['environment']['date']}`, macOS 26.6.2 / Darwin {b['environment']['os']}, CPU {b['environment']['cpu']}, Node {b['environment']['node']}, headless Chrome {b['environment']['browser']}, arm64. 모든 브라우저 sample은 `crossOriginIsolated=false`다.\n\n"
text+='''동일 [fixtures.mjs](poc/fixtures.mjs)의 `index.tsx → App.tsx → Table.tsx`, `App → data.ts` 4파일·100행을 사용했다. bundleless는 Oxc WASI `transformSync` 0.149.0으로 파일별 변환하고 es-module-lexer 3.0.2로 import 위치를 파싱해 상대 import를 자식 blob URL로 재작성한다. React/JSX runtime/React DOM은 기존 독립 ESM 산출물과 import map을 사용한다. esbuild-wasm 0.28.2도 같은 외부 의존성·같은 VFS를 사용한다. Table의 `{r.name}`만 `{r.name + ' updated'}`로 변경했다.

driver/helper 모듈을 로드한 시점 뒤에서 타이머를 시작한다. **준비 포함**은 엔진 JS·WASM load/initialize와 esbuild context 생성, 첫 코드 준비 및 렌더를 포함한다. loader helper의 정적 import·사전 adapter 빌드·서버 시작·HTML navigation은 제외한다. 따라서 완전한 cold page load가 아니다. localhost `no-store`, sample마다 새 browser context이나 단일 Chrome process이며 OS/WASM compile cache는 강제 비우지 않았다. CPU/탭 스케줄링도 통제하지 않았다.

완료 판정은 iframe에서 table DOM commit을 관찰하고 **2회 requestAnimationFrame 뒤** 부모가 postMessage를 받는 시점이다. 실제 compositor/GPU paint 완료 자체는 **unverifiable**이며 이 문서의 “렌더 완료”는 이 대리 지표다. 첫 화면 100행·`User 0`, 수정 화면 100행·`User 0 updated`를 12개 실행 모두 assert했다. 두 방식 모두 새 iframe에서 재실행하고 이전 iframe을 교체한다. Fast Refresh/HMR·React 상태 보존 비교가 아니다.

### 첫 실행: 최초 graph 준비끼리 비교

아래는 source map OFF. “코드 준비”는 bundleless의 4파일 변환·graph 탐색·URL 재작성 또는 esbuild의 context 생성 이후 첫 rebuild다. 준비 경계가 다르므로 전체 판단에는 마지막 열을 사용한다. 명령과 원시값은 위 browser suite다.

'''
text+=render_table([('init_ms','엔진 준비'),('first.build_ms','첫 코드 준비'),('first.render_ms','렌더 대리 지표'),('first.total_ms','준비 후 첫 화면'),('first_with_init_ms','준비 포함 첫 화면')],False)
text+='''
### 수정 실행: 각각 캐시를 유지한 변경 처리끼리 비교

같은 browser suite, source map OFF. bundleless는 변경 파일만 재변환하고 의존하는 URL을 다시 만든다. esbuild는 **동일 context.rebuild**를 재사용한다. full rebuild 도구와 증분 도구의 우열 비교표가 아니다.

'''
text+=render_table([('edit.build_ms','변경 코드 준비'),('edit.render_ms','렌더 대리 지표'),('edit.total_ms','변경→화면 반영')],False)
text+='''
**확인:** 최초 준비 포함 132.3ms 대 299.9ms로 bundleless가 유리했다. 변경 코드 준비도 1.7ms 대 9.5ms로 작았다. 하지만 화면 반영은 50.7ms 대 50.4ms로 사실상 같았다. “변환 속도가 빠르면 사용자에게 수정 화면도 더 빨리 보인다”는 결론은 이 fixture에서 성립하지 않는다. 2 rAF·iframe 재실행·렌더가 차이를 덮는다는 것은 **추정**이며 프레임/스케줄러 profiler까지 계측하지 않았다.

### Source map 및 loader 비용

같은 명령, map ON으로 별도 3회씩 수행했다. Oxc의 변환 map과 MagicString의 import 재작성 map을 보관하고, 에러 위치는 두 단계로 역추적한다. esbuild는 external source map 생성 비용을 포함한다. 아래 첫 실행과 수정 실행은 각각 별도 열이며 서로 다른 단계의 속도를 순위화하지 않는다.

'''
text+=render_table([('first.build_ms','첫 코드 준비'),('first_with_init_ms','준비 포함 첫 화면'),('edit.build_ms','변경 코드 준비'),('edit.total_ms','변경→화면 반영')],True)
mapped=[r for r in b['render'] if r['kind']=='bundleless' and r['maps']]
text+='\n| 별도 비용·기능 검사 | 원시값 → 중앙값 또는 결과 |\n|---|---|\n'
text+='| 최초 import 재작성 map 생성만 | '+cell([r['first']['stats']['map_ms'] for r in mapped])+' |\n'
text+='| 수정 import 재작성 map 생성만 | '+cell([r['edit']['stats']['map_ms'] for r in mapped])+' |\n'
text+='| 오류 stack 한 프레임 2단계 source-map 추적 | '+cell([r['mapping_ms'] for r in b['edges']])+' |\n'
text+='''| 오류 위치 검증 | 3/3 `/bad.ts` line 4, column 8(0-based)로 복원; blob stack 원문은 browser.json의 edges.raw_stack |
| 순환 import 직접 blob 연결 | 3/3 `/index.ts → /b.ts → /index.ts` cycle 오류를 명시 반환 |
| 최초 변환·blob 생성 | 3/3 변환 4파일, blob 4개(map ON/OFF 동일) |
| Table 한 파일 변경 | 3/3 변환 1파일, 새 blob 3개: `/Table.tsx`, `/App.tsx`, `/index.tsx`; `/data.ts` URL 유지(map ON/OFF 동일) |

source map ON/OFF 코드 준비 중앙값 차이 약 3.9ms에는 Oxc map 생성·재작성 map·실행 변동이 함께 들어 있다. map 생성만의 인과 비용으로 단정하지 않는다. 첫 오류 1개 역추적 중앙값 0.8ms는 작은 map의 수치이며 대형 파일·다수 stack frames·DevTools 자동 통합 비용은 **unverifiable**다. 에러 경로는 [edge-case.mjs](poc/critique/edge-case.mjs)에서 실제 throw를 포착해 검증했다.

**순환 판정:** 네이티브 ESM이 순환을 못 다루는 것이 아니다. 이 직접 blob linker는 자식 URL을 알아야 부모 문자열을 만들 수 있고, 이미 만든 blob 내용을 수정할 수 없어 cycle을 거부한다. 안정된 가상 모듈 ID를 import map으로 연결하거나 revision URL을 Service Worker가 서빙하는 다른 linker로 해결할 수 있다(**제안**, 여기서 구현·측정하지 않음). 실제 blob 재작성 loader의 순환 처리 사례도 있다: [es-module-shims 저자 설명](https://guybedford.com/es-module-shims-production-import-maps). 이 source의 가능성을 TOI 호환 완성으로 확대하지 않는다.

**무효화 판정:** “한 파일만 재변환”은 맞지만 “한 파일의 실행 산출물만 교체”는 틀리다. 직접 URL 방식은 모든 역방향 조상으로 URL이 전파되며, 공유 leaf가 넓은 graph에 연결되면 최악에 graph 대부분을 다시 연결한다. 현재 구현은 매 compile에 전체 파일 목록/entry graph를 순회하므로 graph 탐색도 O(변경 파일 수)라고 주장할 수 없다. 안정 URL·revision namespace·dependency reverse index는 별도의 구현 항목이다. 이 PoC는 이전 iframe이 살아 있는 동안 참조될 수 있는 URL을 일찍 revoke하지 않고 종료 시 일괄 해제한다. 장기 편집기에서는 revision별 참조 수·해제 시점을 설계해야 한다.

**결론:** 작은 DAG·단순 TSX·준비된 ESM catalog에서는 bundleless를 실제 후보에 넣어야 한다. 그러나 CSS/asset/import attributes/계산된 dynamic import/순환/상태 보존까지 Vite dev의 동등품으로 부르기는 이르다. 이 실측은 번들러가 필수라는 주장을 반박하지만, TOI가 esbuild를 선택한 것이 잘못이라는 증거는 아니다.

## 3. 브라우저 177ms 대 Node 55ms의 원인 분해

명령: `TMPDIR="$PWD/.tmp" node run-browser.mjs` 및 `node node-decompose.mjs`. 원시값: [browser.json의 decompose](poc/critique/evidence/browser.json), [node-decompose.json](poc/critique/evidence/node-decompose.json). 같은 4파일 fixture, Node는 매 sample 새 process, Chrome은 매 sample 새 context다.

**기존 경계 오류 확인:** [bench-node.mjs](poc/bench-node.mjs)는 `initialize` 뒤 `transform('export {}')`를 실행하고 이를 module_ready로 계산했다. [browser-case.mjs](poc/browser-case.mjs)는 사전 transform 없이 initialize 직후 context+첫 rebuild를 측정했다. 기존 55/177ms는 모두 context+첫 rebuild지만 **예열 조건이 다르다**. 기존 module_ready+첫 실행 합계는 예열 비용을 포함했으므로 삭제할 필요는 없지만, module_ready를 양쪽 모두 동일한 WASM 준비 완료 상태로 해석한 것은 정정한다.

### Probe 유무를 일치시킨 비교

'''
text+=decomp_table()
text+='''
**확인:** Chrome context+첫 bundle은 무예열 약 177ms에서 예열 후 약 47ms로 내려가고 Node도 약 223ms에서 약 53ms로 내려간다. 사전 probe를 포함한 전체 시간은 대체로 유지된다. 따라서 기존 3배 차이의 주원인은 비교 구간 앞에 초기 비용을 포함했는지 여부다. 예열은 비용을 없애지 않고 앞당긴다.

### Worker 및 WASM fetch/compile 분리

같은 browser suite에서 worker OFF, WASM 사전 `WebAssembly.compileStreaming(fetch(...))`를 각각 실험했다. precompile 결과를 `initialize({wasmModule})`로 전달한다. 각 조건 3회, 단위 ms.

'''
text+=worker_table()
text+='''
Worker를 끄면 이 fixture에서는 오히려 총 시간과 변경 rebuild가 느려졌다. 따라서 Worker 메시지가 최초 3배 차이를 지배한다는 가설은 지지되지 않는다. 다만 worker OFF는 실행 스레드·스케줄링·브리지 동작을 함께 바꾸므로 두 조건 차이를 “Worker 메시지 왕복 원가”로 빼낼 수 없다. 뒤이은 tiny transform 3개의 raw 값도 browser.json에 있으나 순수 IPC 측정은 아니다.

WASM fetch+compile을 별도로 분리한 중앙값은 28.1ms이고 그 뒤 initialize 8.2ms다. 이는 컴파일 다운로드 비용을 측정 경계 밖으로 숨기지 않았다는 확인이다. compiled module cache hit 여부, baseline/optimizing JIT 분리, Go runtime 초기화와 plugin 왕복 각각의 비중은 profiler·엔진 trace를 수집하지 않아 **unverifiable**다. “최초 호출에 비용이 지연된다”는 것은 실측 확인, 그 비용 전부가 JIT라는 설명은 **추정**이다. API 동작 근거: [esbuild initialize 및 worker 옵션](https://esbuild.github.io/api/#browser).

준비 포함 bundle 총계가 약 218ms인 이번 Chrome 분해 실험은 기존 약 225ms와 규모가 맞지만, 그것은 DOM 렌더·CDN/WAN·의존성 miss·모델 생성·프록시를 제외한 숫자다. §2의 준비 포함 **첫 화면 약 300ms**와도 측정 종점이 다르다. 어느 값도 TOI의 1.3초를 독립 재현하지 않는다.

## 4. pnpm 12.3.4 실행 방식·게시일·440ms 해석

명령: `cd poc/critique && node provenance.mjs`; 보조 확인 `file ../node_modules/pnpm/pnpm`, `../node_modules/pnpm/pnpm --version`.
원시 증거: [pnpm-provenance.json](poc/critique/evidence/pnpm-provenance.json), [기존 bench-install.mjs](poc/bench-install.mjs), [기존 install-results.json](poc/evidence/install-results.json).

'''
text+=f"**확인:** registry `time['12.3.4']`는 **`{p['published']}`**다. [npm registry 원문](https://registry.npmjs.org/pnpm)의 version metadata와 [공식 GitHub v12.3.4 release](https://github.com/pnpm/pnpm/releases/tag/v12.3.4)(9월 4일 14:23 게시)도 일치하는 날짜다. 실행 파일은 `$W/poc/node_modules/pnpm/pnpm`, 형식 `Mach-O 64-bit executable arm64`, 직접 `--version` 출력 `12.3.4`다. 실행 파일 SHA256는 `{p['binary']['sha256']}`다.\n\n"
text+='''부모 PoC의 고정 의존성 설치로 가져온 패키지이며 설치 단계에서 `npm install`을 사용했다. **벤치 실행은 npx/Corepack/PATH의 pnpm을 사용하지 않고 절대경로 바이너리를 spawn했다.** 따라서 Opus가 이전에 관찰한 시스템 pnpm 10.x와 충돌하지 않는다. `--config.manage-package-manager-versions=false`도 argv에 넣어 버전 자동 변경을 막았다. 언어 구현 자체는 `file` 출력만으로 판별하지 않는다.

기존 locked install 명령은 다음과 같다. `${TRIAL}`은 각 1~3회 디렉터리이고, 모든 정확한 argv는 install-results.json에 저장돼 있다.

```sh
"$W/poc/node_modules/pnpm/pnpm" install --ignore-scripts \
  --store-dir "${TRIAL}/.cache" \
  --config.manage-package-manager-versions=false --frozen-lockfile
```

아래는 **기존 3회 원시값을 재검토한 표**이며 이번 라운드에서 설치 벤치를 추가 수행한 것으로 표시하지 않는다. 동일 React 19.3.0, React DOM 19.3.0, React Query 5.102.8, clsx 2.1.1의 작은 공개 registry fixture다. cold는 node_modules와 지정 store를 삭제한 locked install, warm은 node_modules만 지우고 store를 유지한 locked install이다.

| pnpm 12.3.4 측정 | 원시값 → 중앙값 |\n|---|---|\n'''
text+='| cold locked install | '+cell([r['cold']['ms'] for r in pm['samples']])+' |\n'
text+='| warm locked install | '+cell([r['warm']['ms'] for r in pm['samples']])+' |\n'
text+='''| 검증 상태 | 3/3 cold·warm exit 0; 3개의 생성 lock hash 동일; frozen 설치 뒤 lock 무변경 |

440ms는 이 조건에서 신뢰할 수 있는 **관찰값**이다. OS 파일 캐시, DNS/TLS/registry CDN 상태, 패키지 규모, scripts 비활성화, 다른 앱 CPU 사용은 완전히 통제하지 않았으므로 “pnpm이 사내 workload에서 항상 가장 빠르다”는 판단은 **unverifiable**다. 사내 registry 인증·대형 native addon·대규모 workspace·서버 miss 준비 전체를 측정하지 않았다. 운영 PM 교체 우선순위를 높일 근거로 쓰지 않는다는 Opus 의견에 동의한다.

## 5. Opus C·D·E 반박과 보완

### C: 누락이라고 부를 수 있는 범위

**C1 artifact identity — 방향 수용, 두 identity를 분리해야 한다.** 입력 cache key와 실제 산출물 byte digest는 역할이 다르다. key를 확장해도 비결정적 빌드나 registry 내용 교체를 모두 막지는 못한다. input key로 캐시를 찾고, 산출물 digest로 bytes를 식별·검증하며, manifest가 둘을 함께 기록하는 구성이 낫다(**제안**). 기존 PoC는 “발표에 나온 단순 해시 규칙”의 민감도를 검증했다. 실제 TOI가 바깥 namespace나 빌드 버전으로 추가 무효화하는지는 **unverifiable**다. 실제 운영 key에 확실히 결함이 있다고 단정하지 않는다.

**C2 화면 transaction — 경계 지적은 수용하며 기본 정책과 예외를 구체화한다.** 실제 설명의 성공 시 반영은 후보 코드/프리뷰 교체의 transaction이다. 실행 중 이미 서버로 전송한 write를 되돌린다고 발표가 약속한 것은 아니다. 위험한 운영 write와 승인된 테스트 환경 write를 구분하고, preview 실행 단계에는 test data·read-only를 기본으로 하되 write 기능 검증이 필요하면 서버가 action·resource·환경·유효기간을 확인한 capability를 발급하는 것이 제안이다. 멱등키는 중복 요청 억제이지 권한 검사나 임의 side effect rollback이 아니다. 후보 iframe을 화면 밖에서 검증해도 네트워크 side effect는 생길 수 있다.

**C3 1.3초 정의 — 지적 수용, 로컬 숫자로 빈칸을 채우면 안 된다.** 현재 세부 percentile·hit/miss·캐시 경계는 **unverifiable**다. 이번 3회 중앙값 역시 p95와 동시 사용자 tail latency를 대체하지 못한다. §3은 오히려 동일 이름의 “첫 번들”이 얼마나 쉽게 다른 구간을 가리키는지 드러냈다.

**C4 수명주기 — 동의하되 “전부 발표 언급 없음”은 정정 필요.** 전체 웨비나 Q&A 약 1:19:34에서 미릴리즈 프로젝트를 현재 수거하지 않고 추후 정리할 계획이라고 답했다. 이는 구체적인 현황 언급이다. React/TDS 일괄 업그레이드와 API→앱 역추적 구현은 공개 범위에서 **unverifiable**다. 이미 라이브 앱은 Git 기반 검토 경로가 있고, 1:20:13 PR/리뷰, 1:22:24 MCP/GitOps도 설명됐다. “Git/리뷰가 없다”는 비판은 제외해야 한다. 근거: [전체 웨비나 해당 Q&A](https://www.youtube.com/watch?v=xDVbTlFfu30&t=4774s), [로컬 1차 자료 및 타임코드](astra-report.md).

**C5 프록시의 한계 — ‘못 막는다’는 범위를 좁혀야 한다.** 프록시는 최소 필드·마스킹·권한으로 브라우저에 도착하는 데이터 자체를 줄일 수 있다. 이미 전달된 민감 데이터를 임의 코드가 다른 origin으로 보내는 것을 프록시 단독으로 통제하기 어렵다는 표현은 맞다. CSP·sandbox·origin·메시지 검증은 별도 방어지만 사용자 화면 복사까지 완전히 차단하는 보장으로 설명하면 안 된다. TOI의 세부 CSP·preview origin·sandbox 정책은 **unverifiable**이며 부재를 전제로 비판하지 않는다.

**C6 검증 게이트 — publish 단계라는 범위를 유지해야 한다.** Opus가 모든 프리뷰 단계에서 전부 동기 실행하자고 주장한 것은 아니다. 이는 반박보다 적용 범위 보완이다. 타이핑·생성 프리뷰에는 빠른 syntactic/runtime 검증, 릴리즈 후보에는 별도 type/contract/smoke gate를 두는 제안이 낫다. 어떤 단계에 어떤 검사가 이미 있는지는 공개 자료만으로 확정하지 못한다. 기존 PR 리뷰가 있다는 사실과 자동 검사 종류가 미확인이라는 사실은 함께 적어야 한다.

### D: 개선 순서 및 과도한 보장 반박

**D1 package ESM — ‘단일 URL이면 싱글톤 보장’은 조건부다.** 기존 실험은 정확히 external 처리된 peer, 선택된 호환 버전, CJS facade/require bridge, 동일 realm에서 React·QueryClient 공유를 확인했다. 내부에 번들된 별도 React, peer 범위 충돌, 같은 URL을 쿼리로 분리한 경우, 별도 iframe realm까지 한 인스턴스가 되는 것은 아니다. API 설계가 QueryClient를 주입하지 않고 패키지마다 새로 만들면 React URL 하나만으로 QueryClient가 공유되지도 않는다. 단일 URL은 동일 module instance의 필요 구성이지 모든 라이브러리 전역 상태 공유의 자동 보장이 아니다.

또한 발표의 Package Set Hash는 **캐시 단위**이며 반드시 “JS 한 파일”을 뜻하지 않는다. 조합 빌드도 Vite chunk를 나눌 수 있으므로 패키지 단위 방식만 요청 수가 늘고 현 방식은 반드시 1요청이라는 표는 피해야 한다. 새 조합이 이미 있는 package artifact를 재사용하더라도 peer 해석·전체 manifest 검증·CJS 호환 작업은 남는다. Opus가 채택한 승인 catalog hybrid와 hit/miss 선측정은 수용한다.

**D2 normalized graph — 즉시 도입 우선순위에는 반대한다.** lock 공백 때문에 miss가 나는 것은 안전한 과잉 무효화다. 반대로 잘못된 정규화가 integrity, patch, optional/platform, peer context, registry 해석을 누락하면 서로 다른 빌드가 같은 key로 충돌할 수 있다. 초기 P0는 **raw lock hash + 명시 build profile/toolchain fingerprint + immutable output digest**가 더 단순하다. semantic graph 정규화는 불필요 miss 비율이 크다는 데이터가 있을 때 도입한다(**제안**). registry namespace는 dependency 내용/해석 정책이 달라질 때 유효하며 비밀 token 원문을 key나 공개 manifest에 넣어서는 안 된다. 인증 token rotation만으로 bytes가 같은 전체 catalog를 다시 만들 이유도 없다.

**D3 capability — session만으로 충분하지 않다.** 각 write 요청 시 backend가 user/project/API/action/resource/environment를 확인해야 한다. 클라이언트의 session 플래그나 UI 버튼 숨김은 권한 근거가 아니다. retry는 멱등키, 취소는 아직 실행하지 않은 요청 중단, 실행 완료 write의 복구는 업무별 보상 절차로 각각 나눠야 한다. 이는 제안이며 TOI 인증의 실제 구현 판정이 아니다.

**D4 lifecycle — 엔진 교체보다 먼저 두는 의견을 수용한다.** Opus가 자동 latest 업그레이드를 제안한 것은 아니다. 일괄 codemod·단계 배포를 실제 운영에 적용할 때의 추가 경계로, 중앙 catalog 변경을 모든 앱에 즉시 강제하는 방식에는 반대한다. 다음 우선순위를 Astra 의견에 추가한다. 구현 존재 여부가 미확인이므로 먼저 현황을 점검하고 부족한 항목을 보강한다.

| 우선순위 | 구체적 결과 | 이유·한계 |
|---|---|---|
| P0 | app ID ↔ owner ↔ live release ↔ source/manifest digest ↔ 등록 API ID·schema version 역인덱스 | API 계약 변경·패키지 취약점·owner 퇴사 시 영향 앱을 찾는 기반. API 등록만으로 실제 사용 필드까지 정확히 아는 것은 아니므로 코드 분석/호출 기록을 보조한다. |
| P0 | API schema 변경의 영향 목록과 호환성 검사, owner별 확인·롤백 가능한 릴리즈 | 앱을 런타임에 무조건 최신 schema로 바꾸는 방식은 피한다. 하위호환 변경과 breaking change를 분리한다. |
| P1 | React/TDS 승인 버전·codemod 후보 → type/contract/smoke 검증 → owner 리뷰 → 단계 배포 | 중앙 catalog만 바꿔 모든 120개 앱을 즉시 새 버전으로 돌리면 회귀가 동시에 퍼질 수 있다. 기존 Git/리뷰 경로를 활용한다. |
| P1 | 미릴리즈 앱 inactive 정의·owner 알림·보존 기간·archive/restore 정책 | Q&A에서 이미 정리 필요성을 인지했다. 최근 사용·감사·보존 요구를 확인하고 복구 가능한 archive부터 시작한다. 무통보 영구 삭제를 권하지 않는다. |
| P2 | 측정 기반 bundleless/catalog hybrid 실험, 서버 build pipeline 개선 | 작은 fixture 속도만으로 전체 TOI 엔진 교체를 추진하지 않는다. 수정 화면 약 50ms 동률은 운영 문제보다 우선시할 근거가 약하다. |

**D5 hybrid remote runtime — 필요가 확인된 작업에만 추가한다.** SSR/Node native 모듈/서버 통합검증이 실제 요구라면 유효하다. 단순 API 기반 admin preview라는 범위에서는 VM 세션·idle 비용·egress·사내 네트워크 연결·비밀 전달이라는 운영 항목을 추가한다. “2026 최신이므로 hybrid가 더 좋다”가 아니라 해당 workload가 있는지가 판단 기준이다.

### E: Backend 제안과 공개 사실의 경계, revision 경합

**공개 사실:** 등록 API와 스키마·패턴을 사용한 생성, 정책·감사 서버 프록시, 코드 S3 저장, 브라우저 VFS·esbuild, 서버 의존성 준비→S3→import map, 성공 시 화면 반영. 전체 웨비나와 [토스 공식 글](https://toss.tech/article/52885)(2026-09-04), 기존 보고서의 1차 근거에 따른다. **unverifiable:** 실제 HTTP endpoint, SSE/WebSocket, 이벤트 schema, schema가 OpenAPI인지 자체 JSON인지, 서버 CAS·revision 저장 형식, credential/session 방식. `User Question`이라는 이름으로 SDK를 추정하지 않는다는 Opus의 결론은 유지한다.

Opus의 `POST /generations` + `GET /generations/{id}/events`는 합리적 **제안**이지만 다음 계약이 빠져 있다. generation 완료와 검증 완료와 화면 commit을 같은 `complete`로 부르면 경쟁 상태가 숨는다.

| 경계 | 보완 제안 | 막는 오류 |
|---|---|---|
| 생성 시작 | `{projectId, prompt, baseRevision, requestId}`를 서버 권한 검사 뒤 접수; stale base는 충돌 응답 또는 명시적 merge | 같은 base에서 생성한 두 결과의 무조건 덮어쓰기 |
| 스트림 | generationId별 단조 seq·durable replay 또는 snapshot+watermark; 중복 수신 idempotent 처리 | 재연결 시 파일 patch 누락·이중 반영 |
| 역질문/취소 | questionId·answer endpoint·pending/answered 상태, cancel endpoint, failed/canceled terminal event | 질문이 떠도 답을 보낼 경로가 없음; 취소 결과가 나중에 commit됨 |
| 소스 revision | file upsert/delete를 staging에 적용; `revision_ready{sourceDigest, dependencyManifestDigest}`를 원자적 snapshot 경계로 사용 | 서로 다른 file batch·의존성 버전을 섞어 빌드 |
| 빌드 attempt | `{projectId, revision, sourceDigest, manifestDigest, attemptId, renderGeneration}`를 결과에 보존 | 같은 revision의 오래된 설정/재시도 결과를 최신으로 오인 |
| 검증·commit | 서버 저장은 expected base CAS, UI 교체는 최신 desired revision·attempt와 일치할 때만; canceled/failed는 거부 | 늦게 끝난 이전 빌드가 최신 화면을 덮음 |
| proxy | origin/CORS만이 아니라 서버가 user/project/registered API/action/resource/env 권한 검증; registry·upstream 비밀은 서버 유지 | iframe에서 다른 API나 다른 프로젝트 권한을 재사용 |

CAS와 UI guard는 서로 대체하지 않는다. 서버 CAS는 소스/릴리즈 저장 충돌을 막고, UI guard는 비동기 build/render 완료 순서가 뒤집히는 문제를 막는다. 서버의 저장 revision과 클라이언트 최신 편집 의도도 분리해야 한다. 숫자 비교를 임의 UUID 크기 비교로 구현하지 말고 서버 revision 또는 명시 generation token을 사용한다.

제안 상태 전이: `requested → staging → revision_ready → deps_ready → built → runtime_verified → committed`. 실패하면 `failed`, 취소하면 `canceled`로 끝낸다. 이전 정상 화면은 새 후보가 **runtime_verified이면서 여전히 최신 desired revision**일 때만 교체한다. dependency manifest가 바뀌면 해당 manifest를 포함한 새 후보로 취급한다. 이는 UI 원자적 교체이며 API side effect rollback이 아니다.

| 예시 완료 순서 | 제안 판정 |
|---|---|
| r10 요청 → r11 요청 → r11 성공 → r10 성공 | r11만 commit; r10은 검증 성공이어도 stale로 폐기 |
| 현재 r9 정상 → r10 요청 → r11 요청 → r11 실패 → r10 성공 | r9 유지; r10을 자동 commit하지 않는다. r10 복원을 원하면 명시 rollback 의도로 새 선택 token을 만든다. |
| 같은 r11에서 설정/manifest 변경 후 이전 attempt 성공 | source revision이 같아도 manifest/attempt가 달라 거부 |
| 취소 이벤트 뒤 늦은 complete 도착 | canceled terminal 상태와 desired token 검사로 거부 |

이 경합 표는 **설계 검토**이며 해당 Backend를 실행해 검증한 결과는 아니다. 서버 restart, 오프라인 다중 탭, 이벤트 저장소 유실, 인증 만료까지 구현된 것으로 읽으면 안 된다. 실제 TOI가 어떤 방식을 쓰는지도 **unverifiable**다.

## 6. 합의된 결론 / 남은 이견

‘합의’는 Opus가 비평 §0~1에서 명시 채택했고 Astra도 동의하는 범위만 뜻한다. 이번 신규 실측·제안을 Opus가 이미 승인했다고 표현하지 않는다.

| 구분 | 항목 | 현재 결론 |
|---|---|---|
| 합의 확인 | 47→1.3초 해석 | 의존성 준비를 hot path에서 분리한 전체 아키텍처 결과이며 esbuild 단독 속도가 아니다. |
| 합의 확인 | Yarn | 결정성·작은 fixture 속도만으로 필연성을 주장할 수 없고 교체 우선순위는 낮다. |
| 합의 확인 | package ESM | 승인 catalog에서 peer external·facade 비용을 포함해 hybrid 실험하고 실제 hit/miss·요청 수를 본다. |
| 합의 확인 | Rolldown | 현 browser entry의 격리 요구와 서버 Vite 8 선택은 별개이며 WASM 전체로 일반화하지 않는다. |
| 합의 확인 | 해시 | 발표식 단순 key가 build profile 변화를 담지 못하는 재현은 확인; 실제 TOI 추가 namespace의 유무는 미확인이다. |
| 신규 수용, Opus 재확인 전 | bundleless | 실행 대안 누락을 인정한다. 첫 준비 132.3ms 대 299.9ms, 변경 화면 약 50ms 동률이며 순환·URL 전파·mapping 구현 비용이 남는다. |
| 신규 정정, Opus 재확인 전 | Node 55 / Chrome 177 | Node만 예열한 측정 경계 차이가 주요 원인이다. 동등 예열 조건으로 다시 비교해야 한다. |
| 남은 이견 | 단일 URL 보장 | 동일 realm·명시 peers·숨은 중복 없음·공유 객체 주입 등 조건 없이는 React/QueryClient 전역 공유 보장으로 표현할 수 없다. |
| 남은 이견 | normalized lock graph | Astra는 raw lock+build fingerprint를 먼저 권고한다. 정규화는 miss 비용 증거 뒤에 두며 semantic 누락 위험을 평가해야 한다. |
| 보완 제안, 합의 전 | lifecycle·Backend | inventory/API 역참조·안전한 upgrade/archive를 엔진 교체보다 먼저; revision CAS와 최신 의도 guard를 함께 둔다. TOI 미구현 판정은 아니다. |
| 검증 잔여 | 일반화 | 대형·순환 graph, CSS/assets/CJS, HMR 상태 보존, 사내 registry, 동시 build 경합 실구현, WAN/p95·실제 paint는 추가 실험 전 unverifiable이다. |

추가 도구 출처·고정 버전: Oxc 0.149.0, esbuild-wasm 0.28.2는 부모 PoC lock/registry 증거를 그대로 사용했다. 새 helper의 registry metadata는 [added-versions.json](poc/critique/evidence/added-versions.json)에 보존했다: es-module-lexer 3.0.2(2026-09-07), magic-string 1.3.1(2026-09-10), @jridgewell/trace-mapping 0.3.31(2025-09-10). lexer 3의 실제 `specifier/start/end/type` API를 적용했고 import를 정규식으로 치환하지 않았다. [lexer 공식 소스](https://github.com/guybedford/es-module-lexer), [Oxc transform 문서](https://oxc.rs/docs/guide/usage/transformer.html).
'''
(base.parent.parent/'astra-critique.md').write_text(text)
print('Wrote astra-critique.md from current evidence')
