import sys,json,io,zipfile,struct
sys.path.insert(0,sys.argv[1])
import pyzipper
items=json.load(sys.stdin)
results=[]
for item in items:
 result={'format':item['format']}
 with pyzipper.AESZipFile(item['path']) as z:
  entry=z.infolist()[0]
  result.update(encrypted=bool(entry.flag_bits&1),aesStrength=entry.wz_aes_strength,aesVersion=entry.wz_aes_version)
  for label,password in [('withoutPassword',None),('wrongPassword',b'qa4-wrong-password')]:
   try:
    z.read(entry.filename,pwd=password)
    result[label]='unexpectedly opened'
   except (RuntimeError,ValueError) as e: result[label]='denied'
  data=z.read(entry.filename,pwd=item['password'].encode())
  if item['format']=='xlsx':
   with zipfile.ZipFile(io.BytesIO(data)) as x: text='\n'.join(x.read(n).decode('utf8') for n in x.namelist() if n.endswith('.xml'))
  else: text=data.decode('utf8')
  result.update(correctPasswordOpens=True,maskedName='홍*동' in text,maskedPhone='010-****-5678' in text,rawNameAbsent='홍길동' not in text,rawPhoneAbsent='010-1000-5678' not in text)
  data=b'';text=''
 results.append(result)
print(json.dumps(results,ensure_ascii=False,indent=2))
