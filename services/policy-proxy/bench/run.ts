import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { configuration, serviceRoot } from '../src/config.js';
const config = configuration(), proxy = 'http://localhost:7200';
const session = process.env.TOI_ACCESS_TOKEN;
if (!session) throw new Error('Set TOI_ACCESS_TOKEN to a current Keycloak builder access token');
const created = await fetch('http://localhost:7400/projects', {method:'POST',headers:{Authorization:`Bearer ${session}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Policy benchmark',apiIds:['customers']})});
if (!created.ok) throw new Error('Benchmark project creation failed');
const { projectId } = await created.json();
const capResponse = await fetch(proxy + '/capabilities', { method: 'POST', headers: { Authorization: `Bearer ${session}`, 'Content-Type':'application/json' }, body: JSON.stringify({ projectId, mode: 'read', env: 'preview', ttlSec: 300 }) });
if (!capResponse.ok) throw new Error('Benchmark capability failed'); const { token: capability } = await capResponse.json();
async function measure(kind: 'direct' | 'proxy') {
  const start = performance.now();
  const response = await fetch(kind === 'direct' ? config.upstreamUrl + '/preview/customers?size=20' : proxy + '/proxy/customers/customers?size=20', { headers: kind === 'direct' ? { 'X-Service-Token': config.upstreamToken } : { Authorization: `Bearer ${session}`, 'X-Toi-Capability': capability, 'X-Toi-Project': projectId, 'X-Toi-Reason': 'benchmark comparison' } });
  const data = await response.json(); if (response.status !== 200 || data.items.length !== 20) throw new Error('Benchmark response invalid'); return performance.now() - start;
}
await measure('direct'); await measure('proxy');
const samples: { repeat: number; order: string; directMs: number; proxyMs: number; overheadMs: number }[] = [];
for (let repeat = 1; repeat <= 3; repeat++) {
  let directMs: number, proxyMs: number;
  if (repeat % 2) { directMs = await measure('direct'); proxyMs = await measure('proxy'); } else { proxyMs = await measure('proxy'); directMs = await measure('direct'); }
  samples.push({ repeat, order: repeat % 2 ? 'direct,proxy' : 'proxy,direct', directMs, proxyMs, overheadMs: proxyMs - directMs });
}
const median = (key: 'directMs' | 'proxyMs' | 'overheadMs') => samples.map(sample => sample[key]).sort((a, b) => a - b)[1];
const results = { measuredAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model }, methodology: 'Three paired local HTTP trials after one warm-up of each path; 20-customer response fully consumed and parsed; alternating direct/proxy order; session and capability issuance excluded; proxy includes JWKS identity verification, service-authenticated membership lookup, HMAC capability verification, policy evaluation, JSON masking and awaited JSONL append; persistent connections, no fsync and no network isolation', samples, medians: { directMs: median('directMs'), proxyMs: median('proxyMs'), overheadMs: median('overheadMs') } };
await mkdir(path.join(serviceRoot, 'bench'), { recursive: true }); await writeFile(path.join(serviceRoot, 'bench/results.json'), JSON.stringify(results, null, 2) + '\n'); console.log(results.medians);
