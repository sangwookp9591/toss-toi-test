import datetime, json, os, pathlib, subprocess
root=pathlib.Path(__file__).resolve().parents[3]
qa=root/'docs/qa/qa2'
ports=[4873,9000,5173,5174,7100,7200,7300,7400]
listeners={str(p):subprocess.run(['lsof','-nP',f'-iTCP:{p}','-sTCP:LISTEN'],capture_output=True,text=True).stdout.strip() for p in ports}
managed=json.loads((qa/'logs/managed-before-down.json').read_text())
alive=[]
for p in managed:
    try:os.kill(p['pid'],0);alive.append(p)
    except ProcessLookupError:pass
containers=subprocess.check_output(['docker','ps','-aq','--filter','label=com.docker.compose.project=toi-qa2'],text=True).split()
ps=subprocess.check_output(['ps','-axo','pid=,ppid=,pgid=,command='],text=True)
groups={p['pid'] for p in managed}
groupProcesses=[]
for line in ps.splitlines():
    fields=line.strip().split(None,3)
    if len(fields)==4 and int(fields[2]) in groups:groupProcesses.append(line.strip())
result={'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ports':listeners,'allEightPortsFree':all(not x for x in listeners.values()),'managedPidsAlive':alive,'managedGroupProcesses':groupProcesses,'qa2Containers':containers,'volumesPreserved':subprocess.check_output(['docker','volume','ls','-q','--filter','label=com.docker.compose.project=toi-qa2'],text=True).split(),'gitStatus':subprocess.check_output(['git','status','--short'],cwd=root,text=True).strip()}
(qa/'logs/final-cleanup.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
