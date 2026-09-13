import { InMemoryWebStorage, UserManager, WebStorageStateStore, type User, type UserManagerSettings } from 'oidc-client-ts';
export const LOGIN_MESSAGE = '로그인이 필요해요. 다시 로그인해 주세요.';
export class LoginRequired extends Error { constructor() { super(LOGIN_MESSAGE); } }
export interface AuthState { status: 'loading' | 'authenticated' | 'anonymous'; sub?: string; username?: string; roles: string[]; message?: string }
type Driver = Pick<UserManager, 'getUser' | 'signinSilent' | 'signinRedirect' | 'signoutRedirect' | 'removeUser'>;
export class AuthSession {
  #user: User | null = null;
  #refresh?: Promise<string>;
  #epoch = 0;
  #state: AuthState = { status: 'loading', roles: [] };
  #listeners = new Set<() => void>();
  constructor(private driver: Driver) {}
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  accept(user: User | null) {
    this.#user = user;
    let roles: string[] = [];
    // Display hints only. Every permission is enforced by the API using verified claims.
    try { roles = JSON.parse(atob(user!.access_token.split('.')[1])).realm_access?.roles ?? []; } catch { /* No claims to display. */ }
    this.#state = user && !user.expired ? { status: 'authenticated', sub: user.profile.sub, username: user.profile.preferred_username, roles } : { status: 'anonymous', roles: [], message: LOGIN_MESSAGE };
    for (const listener of this.#listeners) listener();
  }
  async initialize() {
    try { const user = await this.driver.getUser(); if (user && !user.expired) this.accept(user); else await this.refresh(); }
    catch { this.accept(null); }
  }
  async token() {
    if (!this.#user) throw new LoginRequired();
    return this.#user.expired ? this.refresh() : this.#user.access_token;
  }
  refresh(): Promise<string> {
    const epoch = this.#epoch;
    this.#refresh ??= (async () => {
      try {
        const user = await this.driver.signinSilent();
        if (epoch !== this.#epoch) throw new LoginRequired();
        if (!user || user.expired) throw new LoginRequired();
        this.accept(user); return user.access_token;
      } catch { if (epoch === this.#epoch) await this.invalidate(); throw new LoginRequired(); }
      finally { this.#refresh = undefined; }
    })();
    return this.#refresh;
  }
  async expired() {
    // Expiry may fire while proactive renewal is awaiting the network. Keep the
    // mounted workspace until renewal settles; token() never returns expired credentials.
    if (!this.#user?.expired) return;
    try { await this.refresh(); } catch { /* Refresh failure already clears identity. */ }
  }
  async invalidate() { ++this.#epoch; this.accept(null); await this.driver.removeUser(); }
  async login() { await this.driver.signinRedirect({ state: { returnTo: location.pathname + location.search } }); }
  async logout() { try { await this.driver.signoutRedirect(); } finally { await this.invalidate(); } }
}
export function oidcSettings(origin: string): UserManagerSettings {
  const env = import.meta.env ?? {};
  return {
    authority: env.VITE_OIDC_ISSUER ?? 'http://localhost:8080/realms/toi',
    client_id: env.VITE_OIDC_CLIENT_ID ?? 'toi-studio',
    redirect_uri: origin + '/', silent_redirect_uri: origin + '/?oidc=silent', post_logout_redirect_uri: origin + '/',
    response_type: 'code', scope: 'openid profile email', disablePKCE: false,
    automaticSilentRenew: false, loadUserInfo: false, silentRequestTimeoutInSeconds: 10,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: sessionStorage }),
  };
}
let current: AuthSession | undefined;
let manager: UserManager | undefined;
export function auth() {
  if (!current) {
    manager = new UserManager(oidcSettings(location.origin));
    const oidc = manager;
    current = new AuthSession({
      getUser: () => oidc.getUser(),
      // Renewal uses the in-memory refresh token. A hidden IdP iframe is
      // intentionally outside the studio's preview-only frame-src policy.
      signinSilent: async args => {
        if (!(await oidc.getUser())?.refresh_token) throw new LoginRequired();
        return oidc.signinSilent(args);
      },
      signinRedirect: args => oidc.signinRedirect(args),
      signoutRedirect: args => oidc.signoutRedirect(args),
      removeUser: () => oidc.removeUser(),
    });
    manager.events.addAccessTokenExpiring(() => { void current!.refresh().catch(() => {}); });
    manager.events.addAccessTokenExpired(() => { void current!.expired(); });
    manager.events.addUserSignedOut(() => { void current!.invalidate(); });
  }
  return current;
}
export async function initializeAuth(): Promise<boolean> {
  const session = auth(); const query = new URLSearchParams(location.search);
  // The OIDC callback iframe passes only the authorization response code to its parent.
  // It never exchanges that code, renders the studio, or receives access/refresh tokens.
  if (query.get('oidc') === 'silent') { await manager!.signinSilentCallback(); return false; }
  if (query.has('state') && (query.has('code') || query.has('error'))) {
    try {
      const user = await manager!.signinRedirectCallback();
      const returnTo = (user.state as { returnTo?: string })?.returnTo;
      history.replaceState(null, '', returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/');
      sessionStorage.removeItem('toi-sso-attempted');
      session.accept(user);
    } catch { history.replaceState(null, '', '/'); await session.invalidate(); }
  } else if (await manager!.getUser()) await session.initialize();
  else {
    // Restore SSO through top-level PKCE prompt=none. Tokens remain in memory,
    // and an anonymous session returns login_required to the callback above.
    if (sessionStorage.getItem('toi-sso-attempted')) { await session.invalidate(); return true; }
    sessionStorage.setItem('toi-sso-attempted', '1');
    await manager!.signinRedirect({ prompt: 'none', state: { returnTo: location.pathname + location.search } });
    return false;
  }
  return true;
}
