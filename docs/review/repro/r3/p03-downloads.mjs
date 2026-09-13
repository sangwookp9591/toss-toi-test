// P0-3 encrypted downloads + signed URLs against the running policy-proxy (7200) + MinIO.
// Non-destructive: new project; downloads are transient and self-cleaning.
import { createRequire } from 'node:module';
import { login, req, POLICY, AGENT, STUDIO } from './lib.mjs';
const require = createRequire('/Users/psw/Projects/toss-toi-test/services/policy-proxy/package.json');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const out = []; const log = (l, r) => { const s = `${l.padEnd(52)} -> ${typeof r==='object'&&r.status!==undefined?r.status+' '+(typeof r.body==='object'?JSON.stringify(r.body).slice(0,80):String(r.body).slice(0,70)):r}`; out.push(s); console.log(s); };

const alice = await login('alice'), bob = await login('bob');
const A = { token: alice.access_token, origin: STUDIO };
const proj = (await req(AGENT + '/projects', { method:'POST', ...A, body:{name:'r3-dl', apiIds:['customers']}})).body;
const P = proj.projectId; console.log('# project', P);
// alice add bob as editor so bob can also request a capability (for cross-user test)
await req(`${AGENT}/projects/${P}/members/${bob.sub}`, { method:'PUT', ...A, body:{role:'editor'}});

// read capability for alice
const cap = (await req(`${POLICY}/capabilities`, { method:'POST', ...A, body:{projectId:P, env:'preview', mode:'read'}})).body;
const headers = { ...A, project: P, capability: cap.token };

console.log('\n== create download ==');
const dl = await req(`${POLICY}/downloads`, { method:'POST', ...headers, body:{ projectId:P, apiId:'customers', format:'csv', reason:'r3 review download', path:'/customers' }});
log('POST /downloads (csv)', dl);
const ticket = dl.body;
console.log('   ticket:', JSON.stringify({ downloadId: ticket.downloadId, rowCount: ticket.rowCount, hasPassword: !!ticket.zipPassword, passwordLen: ticket.zipPassword?.length, url: ticket.url, expiresAt: ticket.expiresAt, retainUntil: ticket.retainUntil }));
const url = new URL(POLICY + ticket.url);
const id = ticket.downloadId, exp = url.searchParams.get('exp'), sig = url.searchParams.get('sig');

console.log('\n== signed URL attacks (before legit fetch) ==');
log('fetch with tampered exp (+3600)', await req(`${POLICY}/downloads/${id}?exp=${Number(exp)+3600}&sig=${sig}`, { ...A }));
log('fetch with tampered sig', await req(`${POLICY}/downloads/${id}?exp=${exp}&sig=${'0'.repeat(64)}`, { ...A }));
log('fetch missing sig', await req(`${POLICY}/downloads/${id}?exp=${exp}`, { ...A }));
log('fetch duplicate exp/sig params', await req(`${POLICY}/downloads/${id}?exp=${exp}&exp=${exp}&sig=${sig}&sig=${sig}`, { ...A }));
log('fetch as OTHER user (bob)', await req(`${POLICY}/downloads/${id}?exp=${exp}&sig=${sig}`, { token: bob.access_token, origin: STUDIO }));
log('fetch from PREVIEW origin', await req(`${POLICY}/downloads/${id}?exp=${exp}&sig=${sig}`, { token: alice.access_token, origin:`http://p-${P}.preview.localhost:5174` }));
log('fetch no auth', await req(`${POLICY}/downloads/${id}?exp=${exp}&sig=${sig}`, {}));

console.log('\n== MinIO object is ciphertext (not plaintext PII) ==');
const s3 = new S3Client({ endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000', region:'us-east-1', forcePathStyle:true, credentials:{ accessKeyId: process.env.TOI_POLICY_MINIO_USER, secretAccessKey: process.env.TOI_POLICY_MINIO_PASSWORD } });
const bucket = process.env.TOI_DOWNLOAD_BUCKET ?? 'toi-downloads';
try {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `downloads/${id}.bin` }));
  const buf = Buffer.from(await obj.Body.transformToByteArray());
  const asText = buf.toString('latin1');
  const leaks = ['010-', '@', '홍', 'name', 'phone', 'C001'].filter(t => asText.includes(t));
  log('minio object bytes', `${buf.length} bytes; plaintext-markers-found=${JSON.stringify(leaks)} first16hex=${buf.subarray(0,16).toString('hex')}`);
} catch(e){ log('minio get object', 'ERROR '+e.name+' '+ (e.message||'').slice(0,60)); }

console.log('\n== legit one-time fetch + reuse ==');
// concurrent double fetch (reuse race)
const two = await Promise.all([
  fetch(`${POLICY}/downloads/${id}?exp=${exp}&sig=${sig}`, { headers:{ Authorization:'Bearer '+alice.access_token, Origin: STUDIO } }),
  fetch(`${POLICY}/downloads/${id}?exp=${exp}&sig=${sig}`, { headers:{ Authorization:'Bearer '+alice.access_token, Origin: STUDIO } }),
]);
const statuses = two.map(r=>r.status);
log('concurrent double-fetch statuses', JSON.stringify(statuses));
// capture the successful zip
const okRes = two.find(r=>r.status===200);
let zipBuf;
if (okRes) { zipBuf = Buffer.from(await okRes.arrayBuffer()); }
for (const r of two) if (r.status!==200) await r.text().catch(()=>{});
log('third fetch after consumption', await req(`${POLICY}/downloads/${id}?exp=${exp}&sig=${sig}`, { ...A }));

console.log('\n== MinIO object after fetch (should be gone/deleted) ==');
try { await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `downloads/${id}.bin` })); log('minio object after fetch','STILL PRESENT'); }
catch(e){ log('minio object after fetch', 'gone ('+e.name+')'); }

console.log('\n== ZIP inspection (AES-256 / AE-2) ==');
if (zipBuf) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(new URL('./p03-download.zip', import.meta.url), zipBuf);
  // find local file header 0x04034b50, general purpose bit flag (bit0 = encrypted), and AE extra field 0x9901
  const sig0 = zipBuf.readUInt32LE(0).toString(16);
  const gpbf = zipBuf.readUInt16LE(6);
  // scan for AE-x extra header id 0x9901
  let aeIndex=-1; for(let i=0;i<zipBuf.length-1;i++){ if(zipBuf[i]===0x01 && zipBuf[i+1]===0x99){ aeIndex=i; break; } }
  let aeInfo='none';
  if(aeIndex>=0){ const vendorVer = zipBuf.readUInt16LE(aeIndex+4); const strength = zipBuf[aeIndex+8]; aeInfo=`AE-${vendorVer} strength=${strength}(1=128,2=192,3=256)`; }
  log('zip', `size=${zipBuf.length} localSig=0x${sig0} encryptedBit=${(gpbf&1)?'yes':'no'} ${aeInfo}`);
} else log('zip','no successful fetch to inspect');

import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./p03-downloads.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p03-downloads.out');
