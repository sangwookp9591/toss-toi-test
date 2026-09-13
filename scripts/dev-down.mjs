import {readFile,rm} from 'node:fs/promises';import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));const file=new URL('.run/processes.json',import.meta.url);
let managed=[];try{managed=JSON.parse(await readFile(file,'utf8'));}catch{}
for(const {name,pid} of managed.reverse()){try{process.kill(-pid,'SIGTERM');console.log(`Stopped ${name}`);}catch(e){if(e.code!=='ESRCH')throw e;}}
await rm(file,{force:true});await new Promise((resolve,reject)=>{const child=spawn('docker',['compose','-f','infra/docker-compose.yml','down'],{cwd:root,stdio:'inherit'});child.on('exit',code=>code?reject(new Error(`Docker exited ${code}`)):resolve());});
console.log('Managed processes stopped; externally started services are left running.');
