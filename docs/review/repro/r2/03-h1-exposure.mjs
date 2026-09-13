// R2-H1: dev-up이 만든 루트 .env 시크릿이 git·로그·프로세스 인자·프로세스 환경에 노출되는지 확인한다.
// 비밀값은 이 프로세스 메모리에서만 비교하며(명령행 인자로 넘기지 않음) 출력하지 않는다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const keys = ['TOI_SESSION_SECRET', 'TOI_CAPABILITY_SECRET', 'TOI_UPSTREAM_SERVICE_TOKEN'];
const mode = (statSync('.env').mode & 0o777).toString(8);
const ignored = execFileSync('git', ['check-ignore', '.env']).toString().trim() === '.env';
const tracked = execFileSync('git', ['ls-files', '.env']).toString().trim();
const history = execFileSync('git', ['log', '--all', '-p', '--no-color'], { maxBuffer: 1 << 30 }).toString();
const logs = readdirSync('scripts/.run').map(f => readFileSync('scripts/.run/' + f, 'utf8')).join('\n');
const listeners = { 7100: 'deps-builder', 7200: 'policy-proxy', 7300: 'mock-backend', 7400: 'agent-server' };
const pids = Object.fromEntries(Object.entries(listeners).map(([port, name]) => [name, execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN']).toString().trim()]));
const args = execFileSync('ps', ['-axww', '-o', 'args']).toString();
console.log(JSON.stringify({ envFileMode: mode, gitIgnored: ignored, gitTracked: Boolean(tracked) }));
for (const key of keys) {
  const value = env[key];
  const perProcessEnv = Object.fromEntries(Object.entries(pids).map(([name, pid]) => [name, execFileSync('ps', ['-E', '-ww', '-o', 'command=', '-p', pid]).toString().includes(key + '=' + value)]));
  console.log(key, JSON.stringify({ bytes: value?.length ?? 0, inGitHistory: history.includes(value), inServiceLogs: logs.includes(value), inAnyProcessArgs: args.includes(value), inProcessEnvironment: perProcessEnv }));
}
