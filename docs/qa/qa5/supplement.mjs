import { chromium, expect } from '../../../e2e/node_modules/@playwright/test/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import http from 'node:http';
const env=parseEnv(readFileSync('.env','utf8')), out='docs/qa/qa5/', results=JSON.parse(readFileSync(out+'logs/manual.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:false});
results.browser=browser.version();
const accounts={}; let stage='start';
const save=()=>writeFileSync(out+'logs/manual.json',JSON.stringify(results,null,2));
const mark=(key,value)=>{results[key]=value;save();console.log(key+': '+JSON.stringify(value));};
const button=(p,name)=>{console.log('UI button: '+name);return p.getByRole('button',{name:name==='보내기'?'보내기 ↑':name,exact:true})};
const frame=p=>p.frameLocator('#preview iframe');
const snap=p=>p.evaluate(()=>window.studio?.getSnapshot()).catch(()=>null);
async function ready(p,rev){await expect.poll(async()=>(await snap(p))?.lastCommit?.token.revision,{timeout:60000}).toBe(rev);}
async function shot(p,name){if(p.url().includes(':8080'))throw Error('login capture prohibited');await p.screenshot({path:out+'shots/'+name+'.png',fullPage:true,mask:[p.locator('output[aria-label="ZIP 비밀번호"]')]});}
async function login(user){stage='login-'+user;const context=await browser.newContext({viewport:{width:1600,height:1100}});const p=await context.newPage();await p.goto('http://localhost:5173');await button(p,'Keycloak으로 로그인').click();await p.locator('#username').fill(user);await p.locator('#password').fill(env['TOI_PASSWORD_'+user.toUpperCase()]);const exchanged=p.waitForResponse(r=>r.url().endsWith('/protocol/openid-connect/token')&&r.ok());await p.locator('#kc-login').click();const tokens=await(await exchanged).json();await button(p,'로그아웃').waitFor();accounts[user]={context,p,tokens};return p;}
async function api(user,path,body,method=body?'POST':'GET',port=7200){return fetch('http://localhost:'+port+path,{method,headers:{Origin:'http://localhost:5173',Authorization:'Bearer '+accounts[user].tokens.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
async function add(p,role){await p.getByLabel('추가할 사용자 이름',{exact:true}).fill('bob');await p.getByLabel('추가할 멤버 역할',{exact:true}).selectOption(role);await button(p,'멤버 추가').click();await expect(p.getByLabel('bob 역할',{exact:true})).toHaveValue(role);}
try {
const alice=await login('alice'); const projectUrl='http://localhost:5173/?project='+results.projectId;
await alice.goto(projectUrl);await ready(alice,3);await alice.getByText('멤버 · live 쓰기 승인',{exact:true}).click();await add(alice,'editor');
const bob=await login('bob');await bob.goto(projectUrl);await ready(bob,3);
stage='exact-removal-order';const start=Date.now();await alice.getByLabel('bob 역할',{exact:true}).locator('..').getByRole('button',{name:'제거',exact:true}).click();await expect(alice.getByLabel('bob 역할',{exact:true})).toHaveCount(0);
await frame(bob).getByLabel('조회 사유',{exact:true}).fill('제거한 뒤 사유 입력 검증');const denial=bob.waitForResponse(r=>r.url().includes('/proxy/customers')&&r.status()===404);await button(frame(bob),'조회').click();await denial;await expect(bob.locator('.access-notice[role="alert"]')).toBeVisible();mark('removedExactOrder',{reasonFilledAfterRemoval:true,elapsedMs:Date.now()-start,iframeCount:await bob.locator('#preview iframe').count(),writeDisabled:await bob.getByRole('checkbox',{name:'쓰기 테스트 허용',exact:true}).isDisabled()});await shot(bob,'15-removed-exact-order');
stage='audit';await login('root');const verify=await api('root','/audit/verify');mark('audit',{status:verify.status,...await verify.json()});delete results.failure;mark('completed',true);
}catch(e){mark('supplementFailure',{stage,name:e.name,message:String(e.message).split('\n')[0].replace(/[A-Za-z0-9_-]{40,}/g,'[REDACTED]')});process.exitCode=1;}finally{save();await browser.close();}
