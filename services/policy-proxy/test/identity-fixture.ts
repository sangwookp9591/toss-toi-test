import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { afterAll } from 'vitest';
import { Identity } from '../src/identity.js';
import type { ProjectMembership } from '../../../contracts/src/auth.js';
const keys = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(keys.publicKey), kid:'fixture' };
let issuer: string;
export const memberships = new Map<string, ProjectMembership>();
export async function token(sub: string, roles: string[] = ['builder'], overrides: Record<string,unknown> = {}) {
  return new SignJWT({ iss: issuer, aud: 'toi-api', sub, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300, preferred_username: sub, azp:'toi-studio', realm_access:{roles}, groups:['/team-a'], ...overrides }).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(keys.privateKey);
}
const idp = createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url?.endsWith('/certs')) return res.end(JSON.stringify({keys:[jwk]}));
  if(req.url?.endsWith('/token')) {
    let raw='';for await(const chunk of req)raw+=chunk;
    const input=new URLSearchParams(raw),client=input.get('client_id');
    if(input.get('client_secret')!=='fixture-secret'||client!=='toi-policy-proxy'){res.writeHead(401);return res.end('{}');}
    return res.end(JSON.stringify({access_token:await token('service-account-'+client,[],{azp:client}),expires_in:300}));
  }
  const route=/^\/internal\/projects\/([^/]+)\/membership$/.exec(req.url!);
  if(route){
    try{const claims=await new Identity({issuer}).verify(req.headers.authorization);if(claims.azp!=='toi-policy-proxy'||claims.preferred_username!=='service-account-toi-policy-proxy')throw new Error();}catch{res.writeHead(401);return res.end('{}');}
    const value=memberships.get(route[1]);if(!value){res.writeHead(404);return res.end('{}');}return res.end(JSON.stringify(value));
  }
  res.writeHead(404);res.end('{}');
});
await new Promise<void>(r=>idp.listen(0,'127.0.0.1',r));
export const agentUrl=`http://127.0.0.1:${(idp.address() as {port:number}).port}`;
issuer=agentUrl+'/realms/toi';
export const identityConfig={identityIssuer:issuer,agentUrl,policyClientSecret:'fixture-secret'};
export function member(projectId:string, sub:string, role:'owner'|'editor'|'viewer'='viewer') {
  const value=memberships.get(projectId)??{projectId,teamId:'/team-a',version:0,members:[]};
  value.members=value.members.filter(m=>m.sub!==sub);value.members.push({sub,username:sub,role,addedAt:new Date().toISOString(),addedBy:sub});value.version++;memberships.set(projectId,value);
}
afterAll(async()=>{idp.closeAllConnections();await new Promise<void>(r=>idp.close(()=>r()));});
