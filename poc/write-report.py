from pathlib import Path
import json,re,statistics
p=Path('evidence');body=Path('report-body.md').read_text();tables=(p/'measurement-tables.md').read_text()
node=json.loads((p/'node-results.json').read_text());browser=json.loads((p/'browser-results.json').read_text());versions=json.loads((p/'registry-versions.json').read_text());alt=json.loads((p/'alternatives-versions.json').read_text())
body=body.replace('{{ENV}}','환경: '+json.dumps(node['environment'],ensure_ascii=False)+'; Chrome '+browser['browser']+'.')
lines=['|패키지|측정 version|npm 게시일 UTC|','|---|---|---|']
for name in ['esbuild-wasm','@rolldown/browser','@swc/wasm','@swc/wasm-web','sucrase','@babel/standalone','oxc-transform']:
 d=versions[name];lines.append(f"|[{name}]({d['url']})|{d['version']}|{d['published']}|")
body=body.replace('{{VERSIONS}}','\n'.join(lines))
start=tables.index('Command: `node bench-node.mjs`');end=tables.index('## Cross-origin iframe');body=body.replace('{{BENCH_TABLES}}',tables[start:end].replace('## ','### '))
iframe=tables[tables.index('## Cross-origin iframe'):tables.index('## Installs')];body=body.replace('{{IFRAME_TABLE}}',iframe.replace('## ','### '))
inst=tables[tables.index('## Installs'):tables.index('## Singleton')];body=body.replace('{{INSTALL_TABLE}}',inst.replace('## ','### '))
body=body.replace('{{SINGLETON_TABLE}}',tables[tables.index('## Singleton'):].replace('## ','### '))
instjson=json.loads((p/'install-results.json').read_text());lines=['명령: `node bench-install.mjs`. 원시 lock hash (3회 각각 아래 동일 값):','','|도구|3회 SHA256 (동일)|','|---|---|']
for d in instjson['results']:lines.append(f"|{d['name']}|`{d['samples'][0]['lockHash']}` ×3|")
body=body.replace('{{LOCK_TABLE}}','\n'.join(lines))
hashjson=json.loads((p/'hash-results.json').read_text());lines=['|변화|키|baseline 대비 변경|','|---|---|---|']
for d in hashjson['cases']:lines.append(f"|{d['change']}|`{d['key']}`|{d['changed']}|")
lines+=['','추가 명령: `node hash-cases.mjs`는 동일 VFS를 native esbuild로 minify=false/true 각각 실제 빌드한다. 아래는 출력 byte SHA256이며 타이밍 측정이 아니다.','','|Trial|동일 packageSetHash|minify=false 산출물 SHA256|minify=true 산출물 SHA256|출력 변경|','|---|---|---|---|---|'];
for r in hashjson['artifactConfigCheck']['trials']:lines.append(f"|{r['repeat']}|`{r['keyA']}`|`{r['artifactAHash']}`|`{r['artifactBHash']}`|{r['artifactChanged']}|")
body=body.replace('{{HASH_TABLE}}','\n'.join(lines))
lines=['|대안 package|npm latest|게시일 UTC|','|---|---|---|']
for name,d in alt.items():
 if name!='observed':lines.append(f"|[{name}]({d['url']})|{d['version']}|{d['published']}|")
body=body.replace('{{ALTERNATIVE_VERSIONS}}','\n'.join(lines))
lines=['### 준비 + 첫 full bundle (UI render 제외)','','명령: `node bench-node.mjs`, `node bench-browser.mjs`; 각 trial의 module_ready_ms + first_full_bundle_ms에서 계산.','','|환경|도구|중앙값 [원시 3회] ms|','|---|---|---|'];
for env,samples in [('Node',node['samples']),('Browser',browser['samples'])]:
 for mode,name in dict.fromkeys((r.get('mode','Node'),r['name']) for r in samples if r['name']in ['esbuild-full','rolldown-browser']):
  rows=[r for r in samples if r['name']==name and r.get('mode','Node')==mode and 'first_full_bundle_ms'in r];v=[r['module_ready_ms']+r['first_full_bundle_ms']for r in rows];
  if v:lines.append(f"|{env}/{mode}|{name}|{statistics.median(v):.3f} [{', '.join(f'{x:.3f}'for x in v)}]|")
body=body.replace('{{STARTUP_TABLE}}','\n'.join(lines))
assert '{{' not in body
Path('../astra-report.md').write_text(body)
print('Wrote ../astra-report.md:',len(body),'characters')
