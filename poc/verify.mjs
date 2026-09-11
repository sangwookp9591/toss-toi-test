import fs from'node:fs';import assert from'node:assert/strict';
const read=n=>JSON.parse(fs.readFileSync('evidence/'+n+'-results.json'));
for(const x of read('node').samples)assert.equal(x.error,undefined,JSON.stringify(x));
for(const x of read('browser').samples){const mustFail=x.mode==='plain'&&x.name==='rolldown-browser';assert.equal(Boolean(x.error),mustFail,JSON.stringify(x));}
for(const x of read('singleton').samples){assert.equal(x.hookClick,x.mode==='good');assert.equal(x.queryClientShared,x.mode==='good');if(x.mode==='good'){assert.deepEqual(x.identity,{appA:true,appB:true,AB:true});assert.equal(x.fetches,1);assert.equal(x.errors.length,0)}else{assert.equal(x.identity.appB,false);assert(x.errors.length)}}
for(const x of read('install').results){assert.equal(x.samples.length,3);assert.equal(new Set(x.samples.map(r=>r.lockHash)).size,1);for(const r of x.samples){assert.equal(r.cold.status,0);assert.equal(r.warm.status,0);assert(r.lockUnchanged)}}
const cases=read('hash').cases;assert.equal(cases.find(x=>x.change==='lock-whitespace').changed,true);assert.equal(cases.find(x=>x.change==='entry-order').changed,false);assert.equal(cases.find(x=>x.change==='build-tool-version-only').changed,false);
console.log('PASS: node/browser cases, expected COI failures, React/Query singleton + negative control, five installers x three trials, hash cases.');
