import { serviceEnvironment, commandEnvironment } from './service-env.mjs';
import { provisionStorage } from './storage.mjs';
import { request as httpRequest } from 'node:http';
import { provisionIdentity } from './keycloak.mjs';
import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { redact, summarizeFailure } from './dev-diagnostics.mjs';
import { spawn } from 'node:child_process';
import { mkdir, access, readFile, writeFile, open, chmod, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export async function ensureDevelopmentSecrets(envFile, env = process.env) {
 if (env.NODE_ENV === 'production') return;
 env.NODE_ENV ??= 'development';
 const known = new Set(['toi-dev-session-secret-change-before-production','toi-dev-capability-secret-change-before-production','dev-session-secret-change-me','dev-capability-secret-change-me','toi-dev-upstream-secret']);
 let contents = ''; try { contents = await readFile(envFile, 'utf8'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
 let changed = false;
 for (const key of ['TOI_DOWNLOAD_KEK','TOI_DOWNLOAD_URL_SECRET','TOI_POLICY_MINIO_PASSWORD','TOI_SESSION_SECRET','TOI_CAPABILITY_SECRET','TOI_PREVIEW_SERVICE_TOKEN','TOI_LIVE_SERVICE_TOKEN','TOI_KEYCLOAK_ADMIN_PASSWORD','TOI_AGENT_CLIENT_SECRET','TOI_POLICY_CLIENT_SECRET', ...['ALICE','BOB','CAROL','DANA','ROOT'].map(user=>'TOI_PASSWORD_'+user)]) {
  if (env[key] && !known.has(env[key])) continue;
  const value = randomBytes(32).toString('hex'); env[key] = value;
  const line = new RegExp('^(?:export\\s+)?'+key+'=.*$', 'gm');
  contents = contents.replace(line, '').trimEnd()+'\n'+key+'='+value+'\n'; changed = true;
 }
 for (const [key, value] of Object.entries({ TOI_DOWNLOAD_KEK_ID: 'dev-' + randomBytes(8).toString('hex'), TOI_DOWNLOAD_BUCKET: 'toi-downloads', TOI_AUDIT_BUCKET: 'toi-audit', TOI_POLICY_MINIO_USER: 'toi-policy' })) {
  if (env[key]) continue; env[key] = value; contents = contents.trimEnd()+'\n'+key+'='+value+'\n'; changed = true;
 }
 if(changed) { await writeFile(envFile, contents, {mode:0o600}); await chmod(envFile,0o600); }
}
// Every app/service plus the packages used by registry publication and preview bundling.
export const services = [
 {name:'mock-backend', dir:'services/mock-backend', url:'http://localhost:7300/healthz'},
 {name:'policy-proxy', dir:'services/policy-proxy', url:'http://localhost:7200/healthz'},
 {name:'deps-builder', dir:'services/deps-builder', url:'http://localhost:7100/healthz'},
 {name:'agent-server', dir:'services/agent-server', url:'http://localhost:7400/healthz'},
 {name:'studio', dir:'apps/studio', url:'http://localhost:5173/healthz', args:['run','dev']},
];
export const installDirectories = ['packages/fake-tds', 'packages/preview-runtime', ...services.map(service => service.dir)];
export async function checkInstallDirectories(root) {
 const discovered = [];
 for (const group of ['apps', 'services', 'packages']) {
  for (const entry of await readdir(path.join(root, group), {withFileTypes:true})) {
   if (!entry.isDirectory()) continue;
   const dir = `${group}/${entry.name}`;
   try { await access(path.join(root, dir, 'package.json')); discovered.push(dir); }
   catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
 }
 const missing = discovered.filter(dir => !installDirectories.includes(dir));
 if (missing.length) throw new Error(`Install targets missing: ${missing.join(', ')}`);
 for (const dir of installDirectories) {
  const manifest = JSON.parse(await readFile(path.join(root, dir, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, dir, 'package-lock.json'), 'utf8'));
  if (manifest.name !== lock.name) throw new Error(`Lockfile package mismatch: ${dir}`);
 }
 return installDirectories;
}
async function main() {
 const root=fileURLToPath(new URL('..',import.meta.url)), run=path.join(root,'scripts/.run');
 process.chdir(root);
 if (process.argv.includes('--check')) {
  console.log(`Install targets OK (${(await checkInstallDirectories(root)).length}): ${installDirectories.join(', ')}`);
  return;
 }
 await mkdir(run,{recursive:true});
 const logPath = path.join(run, 'dev-up.log');
 const logFile = createWriteStream(logPath);
 const started = performance.now();
 // Callers pass already-redacted subprocess lines through writeLine; everything else goes through log.
 const writeLine = safe => {
  const line = `[${((performance.now()-started)/1000).toFixed(3)}s] ${safe}`;
  console.log(line); logFile.write(line+'\n');
 };
 const log = message => writeLine(redact(message));
 async function stage(name, action, serviceLog) {
  const start = performance.now(); log(`${name}: starting`);
  try { await action(); log(`${name}: ready (${((performance.now()-start)/1000).toFixed(3)}s)`); }
  catch (error) {
   const summary = error.safeSummary ?? summarizeFailure(error.message);
   log(`${name} failed: ${summary} (${((performance.now()-start)/1000).toFixed(3)}s)`);
   log(`Logs: ${logPath}${serviceLog ? `; ${serviceLog}` : ''}`);
   throw error;
  }
 }
 const command=(cmd,args,cwd=root,kind='install')=>new Promise((resolve,reject)=>{
  const child=spawn(cmd,args,{cwd,stdio:['ignore','pipe','pipe'],env:commandEnvironment(kind)});
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
   const lines = createInterface({input:stream});
   lines.on('line', line => { const safe=redact(line); output=(output+'\n'+safe).slice(-16000); writeLine(safe); });
  }
  child.on('error',reject);
  child.on('close',code=>code===0?resolve():reject(Object.assign(new Error(`${cmd} exited ${code}`),{safeSummary:summarizeFailure(output,`${cmd} exited ${code}`)})));
 });
 const healthy=async(url,headers={})=>{
  if (headers.Host) return new Promise(resolve => {
   const request = httpRequest(url, {headers, timeout:1500}, response => {response.resume(); resolve(response.statusCode === 200);});
   request.on('timeout', () => request.destroy()); request.on('error', () => resolve(false)); request.end();
  });
  try{return (await fetch(url,{headers,signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}
 };
 async function wait(url,headers={}) {
  for(let i=0;i<360;i++){if(await healthy(url,headers))return;await new Promise(r=>setTimeout(r,500));}
  throw Object.assign(new Error('Health check timed out'),{safeSummary:`health check timed out: ${url}`});
 }
 await stage('development configuration',async()=>{
  try{process.loadEnvFile(path.join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
  process.env.TOI_E2E = process.argv.includes('--e2e') ? 'true' : 'false';
  process.env.NODE_ENV='development'; process.env.TOI_DEV_AUTH_ENABLED='false';
  process.env.TOI_APPROVAL_TTL_SEC = process.argv.includes('--e2e') ? '8' : (process.env.TOI_APPROVAL_TTL_SEC || '300');
  await ensureDevelopmentSecrets(path.join(root,'.env'));
  await checkInstallDirectories(root);
 });
 await stage('Docker Compose',()=>command('docker',['compose','-f','infra/docker-compose.yml','up','-d'],root,'docker'));
 await stage('Keycloak identity provisioning', async()=>{ await wait('http://localhost:8080/realms/toi/.well-known/openid-configuration'); await provisionIdentity(path.join(root,'.env')); });
 await stage('registry and storage health',()=>Promise.all([wait('http://localhost:4873/-/ping'),wait('http://localhost:9000/minio/health/live')]));
 // Each directory has its own lockfile, so installs are independent; run a few at a time.
 const pending=[...installDirectories];
 await Promise.all(Array.from({length:3},async()=>{
  for(let dir=pending.shift();dir;dir=pending.shift()) await stage(`${dir} install`,async()=>{
   try { await access(path.join(root,dir,'node_modules')); log(`${dir}: dependencies already installed`); }
   catch(error) { if(error.code!=='ENOENT')throw error; await command('npm',['ci'],path.join(root,dir)); }
  });
 }));
 await stage('download and audit storage provisioning', () => provisionStorage());
 await stage('registry setup',()=>command('npm',['run','setup-registry'],path.join(root,'services/deps-builder'),'registry'));
 // Registry setup may have created the root environment file.
 try{process.loadEnvFile(path.join(root,'.env'));}catch{}
 await stage('fetch client publish',()=>command('npm',['run','publish:client'],path.join(root,'services/policy-proxy'),'publish'));
 let managed=[];try{managed=JSON.parse(await readFile(path.join(run,'processes.json'),'utf8'));}catch{}
 for(const {name,dir,url,args=['start']} of services) {
  const headers=name==='mock-backend'?{'X-Service-Token':process.env.TOI_PREVIEW_SERVICE_TOKEN}:{};
  const serviceLog=path.join(run,name+'.log');
  await stage(`${name} start`,async()=>{
   const approvalTtlSec = Number(process.env.TOI_APPROVAL_TTL_SEC);
   const existing = managed.find(service => service.name === name);
   if (existing && (process.argv.includes('--restart') || process.argv.includes('--restart=' + name) || existing.envVersion !== 2 || (name === 'studio' && existing.e2e !== process.env.TOI_E2E) || (name === 'policy-proxy' && existing.approvalTtlSec !== approvalTtlSec))) {
    try { process.kill(-existing.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let attempt=0; attempt<50 && await healthy(url,headers); attempt++) await new Promise(resolve=>setTimeout(resolve,100));
    if (await healthy(url,headers)) throw new Error('Managed service did not stop for configuration change');
    managed = managed.filter(service => service !== existing);
    await writeFile(path.join(run,'processes.json'),JSON.stringify(managed,null,2));
    log(`${name}: applying managed environment configuration`);
   }
   if(await healthy(url,headers)) {
    if (name === 'policy-proxy' && process.argv.includes('--e2e') && !existing) throw Object.assign(new Error('External policy process cannot be reconfigured'), {safeSummary:'stop externally started policy-proxy before using --e2e'});
    log(`${name}: existing healthy service`);return;
   }
   const file=await open(serviceLog,'a');
   const child=spawn('npm',args,{cwd:path.join(root,dir),detached:true,stdio:['ignore',file.fd,file.fd],env:serviceEnvironment(name)});
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);}).finally(()=>file.close());
   child.unref(); managed.push({name,pid:child.pid,envVersion:2,...(name==='studio'?{e2e:process.env.TOI_E2E}:{}),...(name==='policy-proxy'?{approvalTtlSec}:{})});
   await writeFile(path.join(run,'processes.json'),JSON.stringify(managed,null,2));
   try { await wait(url,headers); }
   catch(error) { error.safeSummary=summarizeFailure(await readFile(serviceLog,'utf8'),error.safeSummary); throw error; }
  },serviceLog);
 }
 await stage('preview origin health',()=>wait('http://localhost:5174/frame.html', {Host:'p-00000000-0000-4000-8000-000000000000.preview.localhost:5174'}));
 log('TOI-lite ready: http://localhost:5173 (logs: scripts/.run)');
 logFile.end();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try { await main(); } catch (error) {
  if (process.argv.includes('--check')) console.error(error.message);
  process.exitCode=1;
 }
}
