import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
const root=new URL('./',import.meta.url).pathname;
const paths=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const before=new Map(await Promise.all(paths.map(async p=>[p,await readFile(p)])));
const started=new Date().toISOString(),start=performance.now();
const log=await import('node:fs').then(fs=>fs.createWriteStream(root+'logs/e2e-repeat.log'));
const child=spawn('/bin/zsh',['-c','npm --prefix e2e ci && npm --prefix e2e run test:repeat'],{stdio:['ignore','pipe','pipe']});child.stdout.pipe(log);child.stderr.pipe(log);
const code=await new Promise(resolve=>child.on('exit',resolve));
const changed=[];
for(const [p,original] of before){const now=await readFile(p);if(!now.equals(original)){const dest=root+(p.endsWith('.png')?'shots/e2e-':'logs/e2e-')+p.split('/').at(-1);await writeFile(dest,now);await writeFile(p,original);changed.push({path:p,copy:dest.slice(root.length)});}}
await writeFile(root+'logs/e2e-command.json',JSON.stringify({command:'npm --prefix e2e ci && npm --prefix e2e run test:repeat',started,finished:new Date().toISOString(),durationMs:performance.now()-start,exitCode:code,restoredTrackedFiles:changed},null,2));
console.log(JSON.stringify({exitCode:code,durationMs:performance.now()-start,restoredTrackedFiles:changed},null,2));process.exitCode=code;
