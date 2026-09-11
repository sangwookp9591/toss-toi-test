import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const metadata=await (await fetch('https://registry.npmjs.org/pnpm')).json();
const version='12.3.4',binary=new URL('../node_modules/pnpm/pnpm',import.meta.url);
const record={checkedAt:new Date().toISOString(),url:'https://registry.npmjs.org/pnpm',version,published:metadata.time[version],dist:metadata.versions[version].dist,package:JSON.parse(fs.readFileSync(new URL('../node_modules/pnpm/package.json',import.meta.url))),binary:{path:binary.pathname,file:spawnSync('file',[binary.pathname],{encoding:'utf8'}).stdout.trim(),version:spawnSync(binary.pathname,['--version'],{encoding:'utf8'}).stdout.trim(),sha256:createHash('sha256').update(fs.readFileSync(binary)).digest('hex')}};
fs.writeFileSync('evidence/pnpm-provenance.json',JSON.stringify(record,null,2));
console.log(JSON.stringify({published:record.published,binary:record.binary},null,2));
