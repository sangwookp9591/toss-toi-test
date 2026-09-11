import fs from 'node:fs';
import assert from 'node:assert/strict';
const b=JSON.parse(fs.readFileSync('evidence/browser.json'));
assert.equal(b.render.length,12);assert.equal(b.decompose.length,15);assert.equal(b.edges.length,3);
for(const r of [...b.render,...b.decompose,...b.edges]){assert.ok(!r.error,r.error);assert.deepEqual(r.pageErrors,[])}
for(const r of b.render){assert.equal(r.crossOriginIsolated,false);assert.equal(r.first.rows,100);assert.equal(r.edit.rows,100);assert.equal(r.first.cell,'User 0');assert.equal(r.edit.cell,'User 0 updated');if(r.kind==='bundleless'){assert.equal(r.first.stats.transforms,4);assert.equal(r.edit.stats.transforms,1);assert.deepEqual(r.edit.stats.changedURLs,['/Table.tsx','/App.tsx','/index.tsx'])}}
for(const r of b.edges){assert.match(r.cycle,/Cycle rejected/);assert.equal(r.mapping.original.source,'/bad.ts');assert.equal(r.mapping.original.line,4)}
assert.equal(JSON.parse(fs.readFileSync('evidence/node-decompose.json')).length,6);
assert.equal(JSON.parse(fs.readFileSync('evidence/pnpm-provenance.json')).binary.version,'12.3.4');
console.log('PASS: 12 render cases, 15 browser decompositions, 3 edge cases, 6 Node cases and pnpm provenance');
