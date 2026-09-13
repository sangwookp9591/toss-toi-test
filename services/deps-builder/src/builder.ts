import type { BuildProfile, PackageSetManifest, PackageSetRequest, PackageSetStatus } from '../../../contracts/src/package-set.js';
import { defaultProfile, settings } from './config.js';
import { canonicalJson, hashes, sha256 } from './hash.js';
import { install } from './installer.js';
import { bundle } from './bundle.js';
import { safeLogger, validateRequest } from './security.js';
import type { ObjectStore } from './store.js';

export interface BuilderOptions {
  profile?: BuildProfile; publicUrl?: string; registry?: string; token?: string; cacheRoot?: string;
  onEvent?: (event: string, artifactKey: string) => void;
  beforeUpload?: (path: string, artifactKey: string) => Promise<void>;
  log?: (line: string) => void;
}
export class PackageBuilder {
  readonly profile: BuildProfile;
  publicUrl: string;
  readonly states = new Map<string, PackageSetStatus>();
  readonly builds = new Map<string, Promise<void>>();
  private readonly requests = new Map<string, Promise<PackageSetStatus>>();
  private readonly log: (message: unknown) => void;
  readonly metrics = { installs: 0, builds: 0 };
  constructor(readonly store: ObjectStore, readonly options: BuilderOptions = {}) {
    this.profile = options.profile ?? defaultProfile();
    this.publicUrl = options.publicUrl ?? settings().publicUrl;
    this.log = safeLogger([options.token ?? settings().token, settings().secretKey], options.log);
  }
  private ready(manifest: PackageSetManifest): PackageSetStatus {
    return { status: 'ready', artifactKey: manifest.artifactKey, manifestDigest: sha256(canonicalJson(manifest)), manifestUrl: `${manifest.assetBaseUrl}manifest.json`, manifest };
  }
  async status(key: string): Promise<PackageSetStatus | undefined> {
    const state = this.states.get(key);
    if (state) return state;
    const stored = await this.store.get(`${key}/manifest.json`);
    if (!stored) return undefined;
    const manifest = JSON.parse(stored.toString()) as PackageSetManifest;
    const ready = this.ready(manifest); this.states.set(key, ready); return ready;
  }
  async request(input: unknown): Promise<PackageSetStatus> {
    const request = validateRequest(input);
    const requestKey = sha256(canonicalJson({ request, profile: this.profile }));
    const existing = this.requests.get(requestKey);
    if (existing) return existing;
    const pending = this.resolve(request, requestKey);
    this.requests.set(requestKey, pending);
    try { return await pending; } finally { this.requests.delete(requestKey); }
  }
  private async resolve(request: PackageSetRequest, requestKey: string): Promise<PackageSetStatus> {
    const indexKey = `requests/${requestKey}.json`;
    const index = await this.store.get(indexKey);
    if (index) {
      const { artifactKey, createdAt } = JSON.parse(index.toString()) as { artifactKey: string; createdAt: number };
      const exactVersions = Object.values(request.dependencies).every(version => /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version));
      if (exactVersions || Date.now() - createdAt < 300000) {
        const status = await this.status(artifactKey);
        if (status && status.status !== 'failed') return status;
      }
    }
    this.metrics.installs++;
    const installed = await install(request, { registry: this.options.registry ?? settings().registry, token: this.options.token ?? settings().token, cacheRoot: this.options.cacheRoot });
    const identity = hashes(request.entries, installed.lock, this.profile), key = identity.artifactKey;
    const existing = await this.status(key);
    if (existing && existing.status !== 'failed') { await installed.cleanup(); await this.store.put(indexKey, Buffer.from(JSON.stringify({ artifactKey: key, createdAt: Date.now() })), 'application/json'); return existing; }
    // No await between rechecking ownership and publishing building state.
    const claimed = this.states.get(key);
    if (claimed && claimed.status !== 'failed') { await installed.cleanup(); return claimed; }
    const state: PackageSetStatus = { status: 'building', artifactKey: key, startedAt: new Date().toISOString() };
    this.states.set(key, state);
    const work = (async () => {
      try {
        this.metrics.builds++;
        this.options.onEvent?.('build-start', key);
        const result = await bundle(installed.directory, request.entries, this.profile);
        const files = result.files.map(file => ({ path: file.path, sha256: sha256(file.body), bytes: file.body.length }));
        for (const file of result.files) {
          await this.options.beforeUpload?.(file.path, key);
          await this.store.put(`${key}/${file.path}`, file.body, file.path.endsWith('.css') ? 'text/css' : 'text/javascript');
          const uploaded = await this.store.get(`${key}/${file.path}`);
          if (!uploaded || sha256(uploaded) !== sha256(file.body)) throw new Error('Uploaded asset integrity mismatch');
          this.options.onEvent?.('asset-verified', key);
        }
        const assetBaseUrl = `${this.publicUrl.replace(/\/$/, '')}/assets/${key}/`;
        const manifest: PackageSetManifest = { schemaVersion: 1, ...identity, entries: request.entries, importMap: { imports: Object.fromEntries(Object.entries(result.entryPaths).map(([entry, filename]) => [entry, assetBaseUrl + filename])) }, files, buildProfile: this.profile, assetBaseUrl, createdAt: new Date().toISOString() };
        await this.options.beforeUpload?.('manifest.json', key);
        await this.store.put(`${key}/manifest.json`, Buffer.from(canonicalJson(manifest)), 'application/json');
        this.options.onEvent?.('manifest-published', key);
        this.states.set(key, this.ready(manifest));
      } catch (error) {
        this.log(error);
        this.states.set(key, { status: 'failed', artifactKey: key, error: 'Dependency build failed; check the masked worker log and retry the request' });
      } finally { await installed.cleanup(); this.builds.delete(key); }
    })();
    this.builds.set(key, work);
    await this.store.put(indexKey, Buffer.from(JSON.stringify({ artifactKey: key, createdAt: Date.now() })), 'application/json');
    return state;
  }
  async wait(key: string, timeoutMs: number) {
    const work = this.builds.get(key);
    if (work) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
      if (timer) clearTimeout(timer);
    }
    return this.status(key);
  }
}
