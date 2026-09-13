// P0-3 audit hash-chain: isolated temp dataDir only (no shared state). Run with policy-proxy tsx.
import { AuditChain, canonicalJson, sha256 } from '../../../../services/policy-proxy/src/audit.ts';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const out: string[] = []; const log = (s: string) => { out.push(s); console.log(s); };
const rec = (i: number) => ({ action: 'proxy' as const, ts: new Date(1700000000000+i).toISOString(), user: 'u'+i, projectId: 'p', apiId: 'a', method: 'GET', path: '/x', status: 200, maskedFields: [] as string[], decision: 'allowed' as const });

// --- canonicalJson ambiguity probe ---
log('# canonicalJson determinism / ambiguity:');
log('  key order irrelevant: ' + (canonicalJson({a:1,b:2}) === canonicalJson({b:2,a:1})));
log('  {"a":"1,\\"b\\":2"} vs {a:1,b:2} distinct: ' + (canonicalJson({a:'1,"b":2'}) !== canonicalJson({a:1,b:2})));
log('  undefined dropped: ' + canonicalJson({a:1,b:undefined}));
log('  nested string with braces: ' + (canonicalJson({a:'{"x":1}'}) !== canonicalJson({a:{x:1}})));
log('  unicode preserved: ' + canonicalJson({n:'홍 x'}));

async function fresh() { const dir = mkdtempSync(path.join(tmpdir(),'r3-audit-')); const c = new AuditChain(dir); await c.init(); return { dir, c }; }

// --- concurrent append: no seq dup/gap ---
{
  const { dir, c } = await fresh();
  await Promise.all(Array.from({length:50}, (_,i)=>c.append(rec(i))));
  const recs = await c.read(undefined, 1000);
  const seqs = recs.map(r=>r.seq);
  const unique = new Set(seqs).size === seqs.length;
  const contiguous = seqs.every((s,i)=>s===i+1);
  const h = await c.verify();
  log(`\n# 50 concurrent appends: count=${recs.length} unique=${unique} contiguous=${contiguous} verify.ok=${h.ok}`);
  c.close();
}

// --- fsync: append uses fd.datasync() (see audit.ts durableWrite) ---
log('# fsync: durableWrite() calls fd.datasync() before close (audit.ts:19) — code-confirmed');

// --- live tamper detection (modify a byte) ---
{
  const { dir, c } = await fresh();
  for (let i=0;i<5;i++) await c.append(rec(i));
  const file = path.join(dir,'audit.jsonl');
  let raw = readFileSync(file,'utf8');
  // flip a character in the middle record's user value
  const idx = raw.indexOf('"user":"u2"');
  const tampered = raw.slice(0,idx) + '"user":"uX"' + raw.slice(idx+'"user":"u2"'.length);
  writeFileSync(file, tampered);
  const h = await c.verify();
  log(`\n# byte tamper (user u2->uX): verify.ok=${h.ok} brokenAt=${h.brokenAt}`);
  // fail-closed: append after broken
  let threw=''; try { await c.append(rec(99)); } catch(e:any){ threw = e.code||e.message; }
  log(`# append after broken -> ${threw}`);
  c.close();
}

// --- mid-line truncation (drop trailing newline of last record) ---
{
  const { dir, c } = await fresh();
  for (let i=0;i<5;i++) await c.append(rec(i));
  const file = path.join(dir,'audit.jsonl');
  let raw = readFileSync(file,'utf8');
  writeFileSync(file, raw.slice(0, -10)); // chop last 10 chars (removes trailing newline + partial)
  const c2 = new AuditChain(dir); await c2.init();
  const h = await c2.verify();
  log(`\n# mid-line truncation across restart: verify.ok=${h.ok} brokenAt=${h.brokenAt}`);
  c.close(); c2.close();
}

// --- CLEAN tail truncation across restart with NO replication (candidate finding) ---
{
  const { dir, c } = await fresh();
  for (let i=0;i<5;i++) await c.append(rec(i));
  c.close();
  const file = path.join(dir,'audit.jsonl');
  const lines = readFileSync(file,'utf8').replace(/\n$/,'').split('\n');
  // remove the last 2 whole lines (records 4 and 5), keep valid trailing newline
  writeFileSync(file, lines.slice(0, 3).join('\n') + '\n');
  const c2 = new AuditChain(dir); await c2.init();
  const h = await c2.verify();
  const recs = await c2.read(undefined, 1000);
  log(`\n# CLEAN tail truncation (5->3 records) across restart, NO replication:`);
  log(`  verify.ok=${h.ok} brokenAt=${h.brokenAt} lastSeq=${h.lastSeq} recordsVisible=${recs.length}`);
  log(`  => ${h.ok ? 'UNDETECTED: chain accepts truncated tail (no external high-water anchor)' : 'detected'}`);
  c2.close();
}

writeFileSync(new URL('./p03-audit.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p03-audit.out');
