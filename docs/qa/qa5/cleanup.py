import subprocess,pathlib,json,time,os
root=pathlib.Path.cwd();base=root/'docs/qa/qa5/logs';before=json.loads((base/'before.json').read_text());managed=json.loads((root/'scripts/.run/processes.json').read_text());pids=set()
for service in managed:
 pending=[service['pid']]
 while pending:
  pid=pending.pop();pids.add(pid)
  pending.extend(int(x) for x in subprocess.run(['pgrep','-P',str(pid)],capture_output=True,text=True).stdout.split())
(base/'managed-before-down.json').write_text(json.dumps({'services':managed,'descendantPids':sorted(pids)},indent=2))
env=dict(os.environ,COMPOSE_PROJECT_NAME='toi-qa5');start=time.time()
with (base/'dev-down.log').open('w') as log:r=subprocess.run(['node','scripts/dev-down.mjs','--volumes'],env=env,stdout=log,stderr=subprocess.STDOUT)
def run(args):return subprocess.check_output(args,text=True).strip()
def norm(s,n):
 d={}
 for line in s.splitlines():
  parts=line.split(' ',n);d[' '.join(parts[:n])]=sorted(parts[n].split(','))
 return d
ports=[8080,4873,9000,5173,5174,7100,7200,7300,7400]
for attempt in range(20):
 listeners={str(port):subprocess.run(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True).stdout.strip() for port in ports}
 alive=[pid for pid in pids if subprocess.run(['ps','-p',str(pid),'-o','pid='],capture_output=True,text=True).stdout.strip()]
 if not any(listeners.values()) and not alive:break
 time.sleep(.5)
c=norm(run(['docker','ps','-a','--format','{{.ID}} {{.Names}} {{.Labels}}']),2);v=norm(run(['docker','volume','ls','--format','{{.Name}} {{.Labels}}']),1)
qc=run(['docker','ps','-aq','--filter','label=com.docker.compose.project=toi-qa5']).split();qv=run(['docker','volume','ls','-q','--filter','label=com.docker.compose.project=toi-qa5']).split();qn=run(['docker','network','ls','-q','--filter','label=com.docker.compose.project=toi-qa5']).split()
result={'command':'COMPOSE_PROJECT_NAME=toi-qa5 node scripts/dev-down.mjs --volumes','exitCode':r.returncode,'elapsedSeconds':round(time.time()-start,3),'portListeners':listeners,'trackedServiceDescendants':sorted(pids),'servicePidsRemaining':alive,'qa5Containers':qc,'qa5Volumes':qv,'qa5Networks':qn,'otherContainersUnchanged':c==norm(before['containers'],2),'otherVolumesUnchanged':v==norm(before['volumes'],1),'processRegistryRemoved':not(root/'scripts/.run/processes.json').exists(),'gitStatus':run(['git','status','--short'])}
(base/'final-cleanup.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));raise SystemExit(bool(r.returncode or any(listeners.values()) or alive or qc or qv or qn or not result['otherContainersUnchanged'] or not result['otherVolumesUnchanged']))
