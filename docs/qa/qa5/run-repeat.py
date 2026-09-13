import subprocess,pathlib,time,json,re
root=pathlib.Path.cwd();out=root/'docs/qa/qa5'; tracked=subprocess.check_output(['git','ls-files','-z'],text=False).split(b'\0');backup={p.decode(): (root/p.decode()).read_bytes() for p in tracked if p and (root/p.decode()).is_file()}
def secrets():
 return [line.split('=',1)[1].strip().strip('\"\'') for line in (root/'.env').read_text().splitlines() if '=' in line and not line.startswith('#')]
def redact(text):
 for v in sorted(secrets(),key=len,reverse=True):
  if v:text=text.replace(v,'[ENV_VALUE_REDACTED]')
 return re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[JWT_REDACTED]',text)
start=time.time();cmd='npm --prefix e2e ci && COMPOSE_PROJECT_NAME=toi-qa5 node scripts/dev-up.mjs --e2e && npm --prefix e2e run test:repeat'
with (out/'logs/e2e-repeat.log').open('w') as log:
 process=subprocess.Popen(cmd,shell=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,cwd=root)
 for line in process.stdout:log.write(redact(line));log.flush()
 code=process.wait()
changed=[]
for path,data in backup.items():
 file=root/path
 if not file.exists() or file.read_bytes()!=data:
  changed.append(path)
  if file.exists():
   target=out/'test-artifacts'/path;target.parent.mkdir(parents=True,exist_ok=True);payload=file.read_bytes()
   try:payload=redact(payload.decode()).encode()
   except UnicodeDecodeError:pass
   target.write_bytes(payload)
  file.write_bytes(data)
# Preserve current results even if untracked or identical.
file=root/'e2e/artifacts/results.json'
# Modified tracked results were already copied before restoration.
if not (out/'test-artifacts/e2e/artifacts/results.json').exists() and file.exists():
 target=out/'test-artifacts/e2e/artifacts/results.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(redact(file.read_text()))
summary={'command':cmd,'exitCode':code,'elapsedSeconds':round(time.time()-start,3),'restoredTrackedFiles':changed}
(out/'logs/e2e-command.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary));raise SystemExit(code)
