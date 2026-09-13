import { appendFileSync } from 'node:fs';
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
 for (const key of ['TOI_SESSION_SECRET','TOI_CAPABILITY_SECRET','TOI_UPSTREAM_SERVICE_TOKEN']) {
  if (env[key] && !known.has(env[key])) continue;
  const value = randomBytes(32).toString('hex'); env[key] = value;
  const line = new RegExp('^(?:export\\s+)?'+key+'=.*$', 'gm');
  contents = contents.replace(line, '').trimEnd()+'\n'+key+'='+value+'\n'; changed = true;
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
 await writeFile(logPath, '');
 const started = performance.now();
 const log = message => {
  const line = `[${((performance.now()-started)/1000).toFixed(3)}s] ${redact(message)}`;
  console.log(line); appendFileSync(logPath, line+'\n');
 };
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
 const command=(cmd,args,cwd=root)=>new Promise((resolve,reject)=>{
  const child=spawn(cmd,args,{cwd,stdio:['ignore','pipe','pipe'],env:process.env});
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
   const lines = createInterface({input:stream});
   lines.on('line', line => { const safe=redact(line); output=(output+'\n'+safe).slice(-16000); log(safe); });
  }
  child.on('error',error=>reject(Object.assign(error,{safeSummary:summarizeFailure(error.message)})));
  child.on('close',code=>code===0?resolve():reject(Object.assign(new Error(`${cmd} exited ${code}`),{safeSummary:summarizeFailure(output,`${cmd} exited ${code}`)})));
 });
 const healthy=async(url,headers={})=>{try{return (await fetch(url,{headers,signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}};
 async function wait(url,headers={}) {
  for(let i=0;i<120;i++){if(await healthy(url,headers))return;await new Promise(r=>setTimeout(r,500));}
  throw Object.assign(new Error('Health check timed out'),{safeSummary:`health check timed out: ${url}`});
 }
 await stage('development configuration',async()=>{
  try{process.loadEnvFile(path.join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
  process.env.NODE_ENV='development'; process.env.TOI_DEV_AUTH_ENABLED='true';
  await ensureDevelopmentSecrets(path.join(root,'.env'));
  await checkInstallDirectories(root);
 });
 await stage('Docker Compose',()=>command('docker',['compose','-f','infra/docker-compose.yml','up','-d']));
 await stage('registry and storage health',()=>Promise.all([wait('http://localhost:4873/-/ping'),wait('http://localhost:9000/minio/health/live')]));
 for(const dir of installDirectories) await stage(`${dir} install`,async()=>{
  try { await access(path.join(root,dir,'node_modules')); log(`${dir}: dependencies already installed`); }
  catch(error) { if(error.code!=='ENOENT')throw error; await command('npm',['ci'],path.join(root,dir)); }
 });
 await stage('registry setup',()=>command('npm',['run','setup-registry'],path.join(root,'services/deps-builder')));
 // Registry setup may have created the root environment file.
 try{process.loadEnvFile(path.join(root,'.env'));}catch{}
 await stage('fetch client publish',()=>command('npm',['run','publish:client'],path.join(root,'services/policy-proxy')));
 let managed=[];try{managed=JSON.parse(await readFile(path.join(run,'processes.json'),'utf8'));}catch{}
 for(const {name,dir,url,args=['start']} of services) {
  const headers=name==='mock-backend'?{'X-Service-Token':process.env.TOI_UPSTREAM_SERVICE_TOKEN}:{};
  const serviceLog=path.join(run,name+'.log');
  await stage(`${name} start`,async()=>{
   if(await healthy(url,headers)){log(`${name}: existing healthy service`);return;}
   const file=await open(serviceLog,'a');
   const child=spawn('npm',args,{cwd:path.join(root,dir),detached:true,stdio:['ignore',file.fd,file.fd],env:{...process.env,AGENT_MODE:process.env.AGENT_MODE??'mock'}});
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);}).finally(()=>file.close());
   child.unref(); managed.push({name,pid:child.pid});
   await writeFile(path.join(run,'processes.json'),JSON.stringify(managed,null,2));
   try { await wait(url,headers); }
   catch(error) { error.safeSummary=summarizeFailure(await readFile(serviceLog,'utf8'),error.safeSummary); throw error; }
  },serviceLog);
 }
 await stage('preview origin health',()=>wait('http://localhost:5174/healthz'));
 log('TOI-lite ready: http://localhost:5173 (logs: scripts/.run)');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try { await main(); } catch (error) {
  if (process.argv.includes('--check')) console.error(error.message);
  process.exitCode=1;
 }
}
