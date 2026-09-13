import json, pathlib, re, subprocess
root = pathlib.Path(__file__).resolve().parents[3]
qa = root / 'docs/qa/qa2'
values=[]
for line in (root/'.env').read_text().splitlines():
    match=re.match(r'(?:export\s+)?([A-Z_]+)=(.*)',line)
    if match and re.search('SECRET|TOKEN|PASSWORD',match[1]):
        value=match[2].strip().strip('\"\'')
        if len(value)>=8: values.append((match[1],value))
paths=[p for p in qa.rglob('*') if p.is_file() and p.suffix in ['.md','.json','.log','.mjs','.py']]
paths += list((root/'scripts/.run').glob('*.log'))
hits=[]
for p in paths:
    text=p.read_text(errors='replace')
    for key,value in values:
        if value in text:hits.append({'path':str(p.relative_to(root)),'key':key})
result={'secretValuesChecked':len(values),'textFilesChecked':len(paths),'matches':hits,'envMode':oct((root/'.env').stat().st_mode & 0o777)}
(qa/'logs/secret-scan.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
