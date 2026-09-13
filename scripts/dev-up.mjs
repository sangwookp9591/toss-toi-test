import { spawn } from 'node:child_process';
import { mkdir, access, readFile, writeFile, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),run=path.join(root,'scripts/.run');
process.chdir(root);try{process.loadEnvFile(path.join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(run,{recursive:true});
const command=(cmd,args,cwd=root)=>new Promise((resolve,reject)=>{const child=spawn(cmd,args,{cwd,stdio:'inherit',env:process.env});child.on('exit',code=>code===0?resolve():reject(new Error(`${cmd} exited ${code}`)));child.on('error',reject);});
const healthy=async(url,headers={})=>{try{return (await fetch(url,{headers,signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}};
async function wait(url,headers={}){for(let i=0;i<120;i++){if(await healthy(url,headers))return;await new Promise(r=>setTimeout(r,500));}throw new Error(`Health check timed out: ${url}`);}
async function install(dir){try{await access(path.join(root,dir,'node_modules'));}catch{await command('npm',['ci'],path.join(root,dir));}}
await command('docker',['compose','-f','infra/docker-compose.yml','up','-d']);
await Promise.all([wait('http://localhost:4873/-/ping'),wait('http://localhost:9000/minio/health/live')]);
for(const dir of ['packages/preview-runtime','services/deps-builder','services/policy-proxy','services/mock-backend','services/agent-server','apps/studio'])await install(dir);
await command('npm',['run','setup-registry'],path.join(root,'services/deps-builder'));
await command('npm',['run','publish:client'],path.join(root,'services/policy-proxy'));
// Registry setup may have created the root environment file.
try{process.loadEnvFile(path.join(root,'.env'));}catch{}
let managed=[];try{managed=JSON.parse(await readFile(path.join(run,'processes.json'),'utf8'));}catch{}
async function start(name,dir,url,args=['start'],headers={}){
 if(await healthy(url,headers)){console.log(`${name}: existing healthy service`);return;}
 const log=await open(path.join(run,name+'.log'),'a');const child=spawn('npm',args,{cwd:path.join(root,dir),detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,AGENT_MODE:process.env.AGENT_MODE??'mock'}});child.unref();await log.close();managed.push({name,pid:child.pid});await writeFile(path.join(run,'processes.json'),JSON.stringify(managed,null,2));await wait(url,headers);console.log(`${name}: ready`);
}
await start('mock-backend','services/mock-backend','http://localhost:7300/healthz',['start'],{'X-Service-Token':process.env.TOI_UPSTREAM_SERVICE_TOKEN??'toi-dev-upstream-secret'});
await start('policy-proxy','services/policy-proxy','http://localhost:7200/healthz');
await start('deps-builder','services/deps-builder','http://localhost:7100/healthz');
await start('agent-server','services/agent-server','http://localhost:7400/healthz');
await start('studio','apps/studio','http://localhost:5173/healthz',['run','dev']);await wait('http://localhost:5174/healthz');
console.log('TOI-lite ready: http://localhost:5173 (logs: scripts/.run)');
