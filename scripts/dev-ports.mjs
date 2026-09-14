import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { request } from 'node:http';
export const infrastructurePorts = { TOI_KEYCLOAK_PORT: 8180, TOI_REGISTRY_PORT: 4973, TOI_MINIO_PORT: 9400, TOI_MINIO_CONSOLE_PORT: 9401 };
export function configuredPort(key, fallback, env = process.env) {
  const value = String(env[key] || fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    const message = `Invalid ${key}: expected a port from 1 to 65535`;
    throw Object.assign(new Error(message), { safeSummary: message });
  }
  return Number(value);
}
export async function configureDevelopmentPorts(envFile, env = process.env, log = () => {}) {
  for (const [key, port] of Object.entries(infrastructurePorts)) env[key] = String(configuredPort(key, port, env));
  const issuer = `http://localhost:${env.TOI_KEYCLOAK_PORT}/realms/toi`;
  const urls = {
    TOI_IDENTITY_ISSUER: ['http://localhost:8080/realms/toi', issuer],
    VITE_OIDC_ISSUER: ['http://localhost:8080/realms/toi', issuer],
    AGENT_STUDIO_ORIGIN: ['http://localhost:5173', 'http://localhost:5273'],
    TOI_REGISTRY_URL: ['http://localhost:4873', `http://localhost:${env.TOI_REGISTRY_PORT}`],
    MINIO_ENDPOINT: ['http://localhost:9000', `http://localhost:${env.TOI_MINIO_PORT}`],
  };
  let contents = '';
  try { contents = await readFile(envFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let migrated = false, keycloakMigrated = false;
  for (const [key, [oldValue, value]] of Object.entries(urls)) {
    contents = contents.replace(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`, 'gm'), line => {
      if (parseEnv(line)[key] !== oldValue) return line;
      migrated = true; if (key.endsWith('ISSUER')) keycloakMigrated = true;
      return `${key}=${value}`;
    });
    if (!env[key] || env[key] === oldValue) env[key] = value;
  }
  if (migrated) {
    await writeFile(envFile, contents, { mode: 0o600 }); await chmod(envFile, 0o600);
    if (keycloakMigrated) log(`옛 Keycloak 포트 설정을 ${env.TOI_KEYCLOAK_PORT}으로 이행했다`);
    else log('옛 개발 서비스 포트 설정을 이행했다');
  }
}
// Probe each address separately: an unrelated IPv6 listener can shadow IPv4 Docker.
export async function checkListeningPort({ name, port, pathname, headers = {}, matches }) {
  const addresses = new Set(['127.0.0.1', '::1', ...(await lookup('localhost', { all: true })).map(result => result.address)]);
  for (const host of addresses) {
    const occupied = await new Promise((resolve, reject) => {
      const socket = connect({ host, port }); socket.setTimeout(1500);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', error => ['ECONNREFUSED', 'EAFNOSUPPORT', 'ENETUNREACH'].includes(error.code) ? resolve(false) : reject(new Error(`${name} port connection check failed`)));
      socket.once('timeout', () => { socket.destroy(); reject(new Error(`${name} port connection check timed out`)); });
    });
    if (!occupied) continue;
    const valid = await new Promise(resolve => {
      const req = request({ hostname: host, port, path: pathname, headers, timeout: 1500 }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
        response.on('error', () => resolve(false));
        response.on('end', () => { try { resolve(response.statusCode === 200 && matches(body, response.headers)); } catch { resolve(false); } });
      });
      req.on('error', () => resolve(false)); req.on('timeout', () => req.destroy()); req.end();
    });
    if (valid) continue;
    const message = `${name} port ${port} is occupied by a non-matching service at ${host} (localhost / 127.0.0.1 / ::1 preflight). Check lsof -nP -iTCP:${port} -sTCP:LISTEN; no process was stopped.`;
    throw Object.assign(new Error(message), { safeSummary: message });
  }
}
export async function checkDevelopmentPorts(env = process.env) {
  const keycloak = `http://localhost:${configuredPort('TOI_KEYCLOAK_PORT', 8180, env)}/realms/toi`;
  const targets = [
    {name:'Keycloak', port:configuredPort('TOI_KEYCLOAK_PORT',8180,env), pathname:'/realms/toi/.well-known/openid-configuration', matches:body => {const value=JSON.parse(body); return value.issuer===keycloak && value.token_endpoint===keycloak+'/protocol/openid-connect/token';}},
    {name:'Verdaccio', port:configuredPort('TOI_REGISTRY_PORT',4973,env), pathname:'/-/ping', matches:body => typeof JSON.parse(body)==='object'},
    {name:'MinIO', port:configuredPort('TOI_MINIO_PORT',9400,env), pathname:'/minio/health/live', matches:(_body,headers) => headers.server==='MinIO'},
    {name:'MinIO console', port:configuredPort('TOI_MINIO_CONSOLE_PORT',9401,env), pathname:'/', matches:body => body.includes('<title>MinIO Console</title>')},
    {name:'studio', port:5273, pathname:'/healthz', matches:body => JSON.parse(body).service==='studio'},
    {name:'preview', port:5274, pathname:'/frame.html', headers:{Host:'p-00000000-0000-4000-8000-000000000000.preview.localhost:5274'}, matches:body => body.includes('name="studio-origins"') && body.includes('http://localhost:5273')},
    {name:'deps-builder', port:7100, pathname:'/healthz', matches:body => JSON.parse(body).status==='ok'},
    {name:'policy-proxy', port:7200, pathname:'/healthz', matches:body => Boolean(JSON.parse(body).audit)},
    {name:'mock-backend', port:7300, pathname:'/healthz', headers:{'X-Service-Token':env.TOI_PREVIEW_SERVICE_TOKEN}, matches:body => JSON.parse(body).status==='ok'},
    {name:'agent-server', port:7400, pathname:'/healthz', matches:body => Boolean(JSON.parse(body).agentMode)},
  ];
  for (const target of targets) await checkListeningPort(target);
}
