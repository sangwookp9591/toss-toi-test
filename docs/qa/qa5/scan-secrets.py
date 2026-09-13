from pathlib import Path
import subprocess,json,time
base=Path('docs/qa/qa5');values={k:v.strip().strip('\"\'') for l in Path('.env').read_text().splitlines() if '=' in l and not l.startswith('#') for k,v in [l.split('=',1)]}
files=[p for p in base.rglob('*') if p.is_file() and p.name!='secret-scan.json']; byte_hits=[];ocr_hits=[];images=0
for p in files:
 data=p.read_bytes()
 for key,value in values.items():
  if value and value.encode() in data:byte_hits.append({'path':str(p.relative_to(base)),'key':key,'count':data.count(value.encode())})
 if p.suffix.lower()=='.png':
  images+=1;text=subprocess.run(['tesseract',str(p),'stdout','-l','eng'],capture_output=True,text=True,check=True).stdout
  compact=''.join(text.split())
  for key,value in values.items():
   if value and (value in text or value in compact):ocr_hits.append({'path':str(p.relative_to(base)),'key':key})
result={'envValueCount':len(values),'scannedFiles':len(files),'imagesOCRScanned':images,'byteMatches':byte_hits,'ocrMatches':ocr_hits,'rawValuesWritten':False,'ocrEngine':'local tesseract eng; exact and whitespace-normalized comparison','scope':'All nonempty .env values, including public settings, not only password keys'}
(base/'logs/secret-scan.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));raise SystemExit(bool(byte_hits or ocr_hits))
