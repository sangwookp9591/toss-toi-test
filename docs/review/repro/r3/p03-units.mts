// P0-3 internals: run with policy-proxy's tsx. CSV/XLSX injection, envelope crypto, row limit.
import { csvCell, downloadRows, generateFile, envelopeEncrypt, envelopeDecrypt, encryptedZip } from '../../../../services/policy-proxy/src/downloads.ts';
import { randomBytes } from 'node:crypto';
const out: string[] = []; const log = (s: string) => { out.push(s); console.log(s); };

// --- CSV formula injection ---
log('# CSV formula-injection cells (leading char must be neutralized):');
for (const v of ['=cmd|calc', '+1+1', '-2+3', '@SUM(A1)', '\t=1+1', '\r=1+1', ' =1+1', '=HYPERLINK("http://x")', 'normal', '0date', '=1"quote']) {
  log(`  ${JSON.stringify(v).padEnd(28)} -> ${csvCell(v)}`);
}

// --- XLSX: does ExcelJS emit a real formula for "=..." string values? ---
const xlsx = await generateFile([{ a: '=1+1', b: '=HYPERLINK("http://evil")', c: 'plain' }], 'xlsx');
const { ZipReader, Uint8ArrayReader, TextWriter } = await import('../../../../services/policy-proxy/node_modules/@zip.js/zip.js/index.js') as any;
{
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(xlsx)));
  const entries = await reader.getEntries();
  const sheet = entries.find((e:any)=>/sheet1\.xml$/.test(e.filename));
  const xml = sheet ? await sheet.getData(new TextWriter()) : '';
  await reader.close();
  log(`\n# XLSX sheet1.xml contains <f> formula element: ${/<f>/.test(xml)} ; contains "=1+1" as literal string: ${xml.includes('=1+1') || xml.includes('=HYPERLINK')}`);
  log('  sheet snippet: ' + xml.replace(/\s+/g,' ').slice(0, 300));
}

// --- row limit ---
try { downloadRows({ items: Array.from({length:10001},(_,i)=>({id:i})) }); log('\n# row limit 10001 -> NOT thrown (BUG)'); }
catch(e:any){ log('\n# row limit 10001 -> ' + e.code + ' ' + e.status); }
try { const r = downloadRows({ items: Array.from({length:10000},(_,i)=>({id:i})) }); log('# row limit 10000 -> ok len=' + r.length); } catch(e:any){ log('# 10000 unexpectedly threw ' + e.status); }

// --- envelope crypto: IV uniqueness, GCM tamper, wrong AAD ---
const kek = randomBytes(32);
const data = Buffer.from('sensitive-plaintext-홍길동-010-1234-5678');
const e1 = envelopeEncrypt(data, kek, 'ctx-A');
const e2 = envelopeEncrypt(data, kek, 'ctx-A');
log(`\n# envelope IV distinct across two encrypts of same data: ${e1.iv !== e2.iv}`);
log(`# ciphertext distinct: ${!e1.ciphertext.equals(e2.ciphertext)}`);
log(`# wrappedDataKey distinct (fresh data key each time): ${e1.wrappedDataKey !== e2.wrappedDataKey}`);
const dec = envelopeDecrypt(e1.ciphertext, e1, kek, 'ctx-A');
log(`# roundtrip decrypt matches: ${dec.equals(data)}`);
// tamper ciphertext
const tampered = Buffer.from(e1.ciphertext); tampered[0] ^= 0xff;
try { envelopeDecrypt(tampered, e1, kek, 'ctx-A'); log('# GCM tamper NOT detected (BUG)'); }
catch { log('# GCM ciphertext tamper -> rejected (sha256 or auth tag)'); }
// wrong context (AAD binding)
try { envelopeDecrypt(e1.ciphertext, e1, kek, 'ctx-B'); log('# wrong AAD/context NOT detected (BUG)'); }
catch { log('# wrong context (AAD) -> rejected'); }
// wrong kek
try { envelopeDecrypt(e1.ciphertext, e1, randomBytes(32), 'ctx-A'); log('# wrong KEK NOT detected (BUG)'); }
catch { log('# wrong KEK -> rejected'); }

// --- decrypt the captured live download zip to confirm masking passed through ---
import { readFileSync, existsSync } from 'node:fs';
const zipPath = new URL('./p03-download.zip', import.meta.url);
if (existsSync(zipPath)) {
  log('\n# captured live download zip present (' + readFileSync(zipPath).length + ' bytes); it is AES-256 encrypted (needs one-time password, not stored). Masking is applied on the /proxy path before generateFile (server.ts:99-102).');
}

const { writeFileSync } = await import('node:fs');
writeFileSync(new URL('./p03-units.out', import.meta.url), out.join('\n')+'\n');
console.log('\n# wrote p03-units.out');
