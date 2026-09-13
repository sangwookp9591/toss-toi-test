import { test as base, expect, type Browser, type BrowserContext, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const env = { ...parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8')), ...process.env };
export const issuer = env.VITE_OIDC_ISSUER ?? 'http://localhost:8080/realms/toi';
export const studio = 'http://localhost:5173';
export const agent = 'http://localhost:7400';
export const policy = 'http://localhost:7200';
export type Username = 'alice' | 'bob' | 'carol' | 'dana' | 'root';
export function required(key: string) { const value = env[key]; if (!value) throw new Error('Missing required .env entry: ' + key); return value; }
type Tokens = { access_token: string; refresh_token: string; expires_in: number };
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
export interface Account { state: StorageState; sub: string; token(): Promise<string> }
// Secrets stay in this worker's closure: no storageState files, tracing or token assertions.
export async function login(browser: Browser, username: Username, lifespan?: number): Promise<Account & { raw: Tokens }> {
  const context = await browser.newContext({ baseURL: studio, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Keycloak으로 로그인' }).click();
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(required('TOI_PASSWORD_' + username.toUpperCase()));
    const exchanged = page.waitForResponse(response => response.url() === issuer + '/protocol/openid-connect/token' && response.request().method() === 'POST' && response.ok());
    await page.locator('#kc-login').click();
    const raw: Tokens = await (await exchanged).json();
    await page.getByRole('button', { name: '로그아웃', exact: true }).waitFor();
    const state = await context.storageState();
    let tokens = raw; let expiresAt = Date.now() + (lifespan ?? tokens.expires_in) * 1000;
    const sub = JSON.parse(Buffer.from(raw.access_token.split('.')[1], 'base64url').toString()).sub;
    return { state, sub, raw, token: async () => {
      if (Date.now() > expiresAt - 15000) {
        const response = await fetch(issuer + '/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'toi-studio', refresh_token: tokens.refresh_token }) });
        if (!response.ok) throw new Error('Test identity refresh failed');
        tokens = await response.json() as Tokens; expiresAt = Date.now() + tokens.expires_in * 1000;
      }
      return tokens.access_token;
    } };
  } catch { throw new Error('Keycloak UI login failed for ' + username + '; verify service readiness and .env credentials'); }
  finally { await context.close(); }
}
export async function api(account: Account, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', baseUrl = agent) {
  return fetch(baseUrl + path, { method, headers: { Origin: studio, Authorization: 'Bearer ' + await account.token(), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
export async function admin(path: string, body?: unknown, method = body === undefined ? 'GET' : 'PUT') {
  const baseUrl = issuer.split('/realms/')[0];
  const response = await fetch(baseUrl + '/realms/master/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'toi-bootstrap', password: required('TOI_KEYCLOAK_ADMIN_PASSWORD') }) });
  if (!response.ok) throw new Error('Keycloak admin authentication failed');
  const { access_token } = await response.json() as Tokens;
  const result = await fetch(baseUrl + '/admin/realms/toi' + path, { method, headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!result.ok) throw new Error('Keycloak admin operation failed: ' + result.status);
  return result.status === 204 ? undefined : result.json();
}
export const test = base.extend<{}, { accounts: (username: Username) => Promise<Account> }>({
  accounts: [async ({ browser }, use) => {
    const cache = new Map<Username, Promise<Account>>();
    await use(username => { let account = cache.get(username); if (!account) { account = login(browser, username); cache.set(username, account); } return account; });
  }, { scope: 'worker' }],
  storageState: async ({ accounts }, use) => { await use((await accounts('alice')).state); },
  request: async ({ playwright, accounts }, use) => {
    const account = await accounts('alice');
    const request: APIRequestContext = await playwright.request.newContext({ extraHTTPHeaders: { Origin: studio, Authorization: 'Bearer ' + await account.token(), 'Content-Type': 'application/json' } });
    await use(request); await request.dispose();
  },
});
export { expect };
