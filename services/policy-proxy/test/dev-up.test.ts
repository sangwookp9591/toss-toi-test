import {test,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {knownDevelopmentSecrets} from '../src/config.js';
test('dev-up persists independent random secrets, replaces defaults, and reuses values across launches',async()=>{
 const moduleUrl=new URL('../../../scripts/dev-up.mjs',import.meta.url).href;
 const {ensureDevelopmentSecrets}=await import(moduleUrl);
 const directory=await mkdtemp(path.join(os.tmpdir(),'dev-secrets-')), file=path.join(directory,'.env');
 try {
  await writeFile(file,'UNRELATED=keep\nexport TOI_SESSION_SECRET=dev-session-secret-change-me\nTOI_CAPABILITY_SECRET=toi-dev-capability-secret-change-before-production\n');
  const env:NodeJS.ProcessEnv=parseEnv(await readFile(file,'utf8'));
  await ensureDevelopmentSecrets(file,env);expect(env.NODE_ENV).toBe('development');
  const content=await readFile(file,'utf8'),saved=parseEnv(content);
  expect(saved.UNRELATED).toBe('keep');expect((await stat(file)).mode&0o777).toBe(0o600);
  const values=['TOI_SESSION_SECRET','TOI_CAPABILITY_SECRET','TOI_UPSTREAM_SERVICE_TOKEN'].map(key=>saved[key]);
  expect(new Set(values).size).toBe(3);for(const value of values){expect(value).toMatch(/^[a-f0-9]{64}$/);expect(knownDevelopmentSecrets.has(value!)).toBe(false);}
  for(const key of ['TOI_SESSION_SECRET','TOI_CAPABILITY_SECRET','TOI_UPSTREAM_SERVICE_TOKEN'])expect(saved[key]).toBe(env[key]);
  await ensureDevelopmentSecrets(file,{...saved});expect(await readFile(file,'utf8')).toBe(content);
  await ensureDevelopmentSecrets(file,{NODE_ENV:'production'});expect(await readFile(file,'utf8')).toBe(content);
 }finally{await rm(directory,{recursive:true,force:true});}
});
