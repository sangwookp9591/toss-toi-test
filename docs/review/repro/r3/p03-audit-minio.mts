// P0-3 audit replication + MinIO object lock + policy-user permission scope.
// Isolated temp buckets for lock tests; live audit bucket only for a NON-destructive
// permission probe (delete attempt on a NONEXISTENT key -> AccessDenied proves scope).
import { createRequire } from 'node:module';
const require = createRequire('/Users/psw/Projects/toss-toi-test/services/policy-proxy/package.json');
const { S3Client, CreateBucketCommand, PutObjectCommand, DeleteObjectCommand, GetObjectLockConfigurationCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
import { AuditChain } from '../../../../services/policy-proxy/src/audit.ts';
import { S3Objects } from '../../../../services/policy-proxy/src/objects.ts';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
const out: string[] = []; const log = (s: string) => { out.push(s); console.log(s); };
const ENDPOINT = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
const root = new S3Client({ endpoint: ENDPOINT, region:'us-east-1', forcePathStyle:true, credentials:{ accessKeyId:'toi', secretAccessKey:'toi-local-secret' } });
const policy = new S3Client({ endpoint: ENDPOINT, region:'us-east-1', forcePathStyle:true, credentials:{ accessKeyId: process.env.TOI_POLICY_MINIO_USER!, secretAccessKey: process.env.TOI_POLICY_MINIO_PASSWORD! } });
const rec = (i:number)=>({ action:'proxy' as const, ts:new Date(1700000000000+i).toISOString(), user:'u'+i, projectId:'p', apiId:'a', method:'GET', path:'/x', status:200, maskedFields:[] as string[], decision:'allowed' as const });

// --- 1. Replicated records are protected: truncate below the replicated boundary -> detected ---
{
  const bucket = 'r3-audit-' + randomBytes(4).toString('hex');
  await root.send(new CreateBucketCommand({ Bucket: bucket, ObjectLockEnabledForBucket: true }));
  const dir = mkdtempSync(path.join(tmpdir(),'r3-am-'));
  const objs = new S3Objects(ENDPOINT, 'toi', 'toi-local-secret', bucket);
  const c = new AuditChain(dir, objs, 5, 1); // segmentSize=5 so a segment flushes at 5 records
  await c.init();
  for (let i=0;i<7;i++) await c.append(rec(i));
  await (c as any).flush(true); // force replicate seq 1..5
  const lock = await root.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
  log(`# temp audit bucket objectLock=${lock.ObjectLockConfiguration?.ObjectLockEnabled} (segment 1..5 replicated)`);
  c.close();
  // truncate file to 4 records (below replicated boundary of 5) and restart
  const file = path.join(dir,'audit.jsonl');
  const lines = readFileSync(file,'utf8').replace(/\n$/,'').split('\n');
  writeFileSync(file, lines.slice(0,4).join('\n')+'\n');
  const c2 = new AuditChain(dir, new S3Objects(ENDPOINT,'toi','toi-local-secret',bucket), 5, 1); await c2.init();
  const h = await c2.verify();
  log(`# truncate below replicated boundary (7->4, seg covers 1..5): verify.ok=${h.ok} brokenAt=${h.brokenAt} => ${h.ok?'UNDETECTED (BAD)':'DETECTED via remote segment'}`);
  c2.close();

  // --- 2. object lock WITHOUT retention: an object put without retention can be deleted by root ---
  await root.send(new PutObjectCommand({ Bucket: bucket, Key: 'audit/segments/probe.jsonl', Body: Buffer.from('x') }));
  let delRes=''; try { await root.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'audit/segments/probe.jsonl' })); delRes='DELETED'; } catch(e:any){ delRes='blocked '+e.name; }
  log(`# object-lock-enabled bucket, object PUT without retention, root delete -> ${delRes} (S3Objects.put sets no ObjectLockRetainUntilDate)`);
  try { await root.send(new DeleteBucketCommand({ Bucket: bucket })); } catch {}
}

// --- 3. policy user permission scope on the LIVE audit bucket (non-destructive: nonexistent key) ---
{
  const auditBucket = process.env.TOI_AUDIT_BUCKET ?? 'toi-audit';
  const downloadBucket = process.env.TOI_DOWNLOAD_BUCKET ?? 'toi-downloads';
  const probeKey = 'audit/segments/__r3_nonexistent_' + randomBytes(4).toString('hex') + '.jsonl';
  let auditDel=''; try { await policy.send(new DeleteObjectCommand({ Bucket: auditBucket, Key: probeKey })); auditDel='allowed (would delete)'; } catch(e:any){ auditDel=e.name; }
  let dlDel=''; try { await policy.send(new DeleteObjectCommand({ Bucket: downloadBucket, Key: 'downloads/__r3_nonexistent.bin' })); dlDel='allowed'; } catch(e:any){ dlDel=e.name; }
  log(`\n# policy user DeleteObject on AUDIT bucket (nonexistent key) -> ${auditDel}  (expect AccessDenied = cannot delete audit)`);
  log(`# policy user DeleteObject on DOWNLOAD bucket (nonexistent key) -> ${dlDel}  (expect success/NoSuchKey = delete allowed for cleanup)`);
}

writeFileSync(new URL('./p03-audit-minio.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p03-audit-minio.out');
