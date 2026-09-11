import json,statistics,pathlib
p=pathlib.Path('evidence')
lines=['# Measurement tables','', 'All numeric cells: median [trial 1, trial 2, trial 3], milliseconds unless stated. Commands run from poc/.','']
def val(v):
 if not v:return '—'
 return f'{statistics.median(v):.3f} ['+', '.join(f'{x:.3f}' for x in v)+']'
def table(title,samples,metrics):
 lines.extend(['## '+title,'','Command: `node '+('bench-node.mjs' if title.startswith('Node') else 'bench-browser.mjs')+'`','','|Case|Metric|Median [raw]|','|---|---|---|'])
 keys=list(dict.fromkeys((x.get('mode','Node'),x['name']) for x in samples))
 for mode,name in keys:
  rows=[x for x in samples if x.get('mode','Node')==mode and x['name']==name]
  for m in metrics:
   v=[x[m] for x in rows if m in x]
   if v:lines.append(f'|{mode} / {name}|{m}|{val(v)}|')
  errors=[x.get('error','') for x in rows if x.get('error')]
  if errors:lines.append('|'+mode+' / '+name+'|errors|'+str(len(errors))+'/3: '+errors[0].split('\n')[0].replace('|','\\|')+'|')
 lines.append('')
n=json.loads((p/'node-results.json').read_text());b=json.loads((p/'browser-results.json').read_text())
lines+=['Environment: '+json.dumps(n['environment'])+'; Chrome '+b['browser'],'']
for label,rows in [('Node',n['samples']),('Browser',b['samples'])]:
 lines+=['Command: `node '+('bench-node.mjs' if label=='Node' else 'bench-browser.mjs')+'`','']
 table(label+' readiness',rows,['js_initialize_ms','js_import_ms','wasm_ready_probe_ms','wasm_ready_ms','module_ready_ms'])
 table(label+' incremental bundler (esbuild)',[x for x in rows if x['name']=='esbuild-wasm'],['context_first_bundle_ms','incremental_rebuild_ms'])
 table(label+' full rebundle (esbuild / Rolldown)',[x for x in rows if x['name']in ['esbuild-full','rolldown-browser']],['first_full_bundle_ms','second_full_bundle_ms'])
 table(label+' transformers only',[x for x in rows if x['name'] not in ['esbuild-wasm','esbuild-full','rolldown-browser']],['first_transform_all_ms','second_transform_all_ms'])
lines+=['## Cross-origin iframe','Command: `node bench-browser.mjs`','','|Parent COEP|Child case|Loaded trials|Child isolated trials|','|---|---|---|---|']
for parent,case in dict.fromkeys((x['parent'],x['case'])for x in b['embeddings']):
 rows=[x for x in b['embeddings']if x['parent']==parent and x['case']==case];lines.append(f"|{parent}|{case}|{[x['loaded']for x in rows]}|{[x.get('childIsolated')for x in rows]}|")
i=json.loads((p/'install-results.json').read_text());lines+=['','## Installs','Command: `node bench-install.mjs`; exact per-tool argv in install-results.json.','','|Manager|Cold ms median [raw]|Warm ms median [raw]|Unique generated lock hashes /3|Frozen install changed lock?|','|---|---|---|---|---|']
for x in i['results']:
 rows=x['samples'];lines.append(f"|{x['name']} {x['version']}|{val([r['cold']['ms']for r in rows if 'cold'in r])}|{val([r['warm']['ms']for r in rows if 'warm'in r])}|{len(set(r.get('lockHash')for r in rows))}|{[not r.get('lockUnchanged',False)for r in rows]}|")
lines+=['','## Singleton','Command: `node singleton.mjs`','','|Case|Trial|React equality app/A/B|Shared QueryClient|Hook click|fetches|JS requests|','|---|---|---|---|---|---|---|']
s=json.loads((p/'singleton-results.json').read_text())
for x in s['samples']:lines.append(f"|{x['mode']}|{x['repeat']}|{x.get('identity')}|{x['queryClientShared']}|{x['hookClick']}|{x.get('fetches')}|{len([r for r in x['requests']if r.endswith('.js')])}|")
(p/'measurement-tables.md').write_text('\n'.join(lines)+'\n')
print('\n'.join(lines))
