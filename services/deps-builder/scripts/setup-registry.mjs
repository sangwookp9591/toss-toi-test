import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
const run = promisify(execFile), root = fileURLToPath(new URL('../../../', import.meta.url));
const envPath = path.join(root, '.env');
config({ path: envPath, quiet: true });
const registry = process.env.TOI_REGISTRY_URL ?? 'http://localhost:4873';
let token = process.env.TOI_REGISTRY_TOKEN;
async function metadata(auth) { return fetch(`${registry}/@toi%2ftds`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} }); }
try {
  const anonymous = await metadata();
  if (![401, 404].includes(anonymous.status)) throw new Error(`Private metadata unexpectedly accessible: HTTP ${anonymous.status}`);
  console.log(`Anonymous @toi/tds metadata blocked: HTTP ${anonymous.status}`);
  if (!token || (await metadata(token)).status === 401) {
    const username = `toi-builder-${randomBytes(4).toString('hex')}`;
    const response = await fetch(`${registry}/-/user/org.couchdb.user:${username}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: username, password: randomBytes(24).toString('base64url'), email: `${username}@example.test`, type: 'user', roles: [] }) });
    if (!response.ok) throw new Error(`Registry user creation failed: HTTP ${response.status}`);
    token = (await response.json()).token;
    if (typeof token !== 'string' || !token) throw new Error('Registry did not issue a token');
    let previous = ''; try { previous = await readFile(envPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (/^TOI_REGISTRY_TOKEN=/m.test(previous)) throw new Error('Existing .env token is invalid; operator must rotate it');
    await writeFile(envPath, `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}TOI_REGISTRY_TOKEN=${token}\n`, { mode: 0o600 });
    await chmod(envPath, 0o600);
    console.log('Registry token stored in gitignored root .env (mode 0600)');
  }
  const packageRoot = path.join(root, 'packages/fake-tds');
  await run('npm', ['run', 'build'], { cwd: packageRoot });
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const serviceCache = path.join(root, 'services/deps-builder/.cache'); await mkdir(serviceCache, { recursive: true });
  for (const version of ['1.0.0', '1.1.0']) {
    const existing = await metadata(token);
    if (existing.ok && (await existing.json()).versions?.[version]) { console.log(`@toi/tds@${version} already published`); continue; }
    const directory = await mkdtemp(path.join(serviceCache, 'publish-'));
    try {
      await cp(path.join(packageRoot, 'dist'), path.join(directory, 'dist'), { recursive: true });
      const index = path.join(directory, 'dist/index.js');
      await writeFile(index, (await readFile(index, 'utf8')).replace("version = '1.0.0'", `version = '${version}'`));
      const declaration = path.join(directory, 'dist/index.d.ts');
      await writeFile(declaration, (await readFile(declaration, 'utf8')).replace('version = "1.0.0"', `version = "${version}"`));
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...packageJson, version, scripts: undefined, devDependencies: undefined }));
      const url = new URL(registry);
      await writeFile(path.join(directory, '.npmrc'), `registry=${registry}\n//${url.host}/:_authToken=\${TOI_REGISTRY_TOKEN}\n`);
      await run('npm', ['publish', '--registry', registry, '--ignore-scripts'], { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME, TOI_REGISTRY_TOKEN: token }, maxBuffer: 1024 * 1024 });
      console.log(`Published @toi/tds@${version}`);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  const finalAnonymous = await metadata();
  if (![401, 404].includes(finalAnonymous.status)) throw new Error('Private metadata is exposed after publication');
  console.log(`Verified both versions published; anonymous access remains HTTP ${finalAnonymous.status}`);
} catch (error) {
  // Subprocess errors can contain npm configuration; do not serialize them.
  console.error(`Registry setup failed (${error instanceof Error ? error.name : 'unknown error'}); inspect registry health and configuration`);
  process.exitCode = 1;
}
