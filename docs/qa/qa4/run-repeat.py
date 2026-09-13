from pathlib import Path
import subprocess,datetime,time,json,re
root=Path.cwd();out=root/'docs/qa/qa4';paths=subprocess.check_output(['git','ls-files','-z']).decode().split('\0');before={p:(root/p).read_bytes() for p in paths if p and (root/p).is_file()}
secrets=[]
for line in (root/'.env').read_text().splitlines():
 if '=' in line:
  k,v=line.split('=',1)
  if any(x in k for x in ('PASSWORD','SECRET','TOKEN','KEK')) and len(v)>12:secrets.append(v.strip().strip('\"\''))
def redact(s):
 for v in secrets:s=s.replace(v,'[REDACTED]')
 return re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[REDACTED_JWT]',s)
command='npm --prefix e2e ci && COMPOSE_PROJECT_NAME=toi-qa4 node scripts/dev-up.mjs --e2e && npm --prefix e2e run test:repeat'
started=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic()
p=subprocess.Popen(command,shell=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
with (out/'logs/e2e-repeat.log').open('w') as log:
 for line in p.stdout:
  safe=redact(line);log.write(safe);log.flush()
code=p.wait();changed=[]
for name,original in before.items():
 file=root/name
 if not file.exists() or file.read_bytes()!=original:
  changed.append(name)
  if file.exists():
   target=out/'logs/e2e-artifacts'/name;target.parent.mkdir(parents=True,exist_ok=True)
   data=file.read_bytes()
   if file.suffix.lower() in ('.json','.log','.txt','.md','.html'):data=redact(data.decode()).encode()
   target.write_bytes(data)
  file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(original)
summary={'command':command,'startedAt':started,'seconds':time.monotonic()-t,'exitCode':code,'changedTrackedFilesCopiedThenRestored':changed}
(out/'logs/e2e-command.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
