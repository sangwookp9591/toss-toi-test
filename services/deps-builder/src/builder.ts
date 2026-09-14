import type { BuildProfile, PackageSetManifest, PackageSetRequest, PackageSetStatus } from '../../../contracts/src/package-set.js';
import { defaultProfile, settings, storageTimeouts } from './config.js';
import { canonicalJson, hashes, sha256 } from './hash.js';
import { install } from './installer.js';
import { bundle } from './bundle.js';
import { failureCode, safeLogger, storageOperation, validateRequest } from './security.js';
import type { ObjectStore } from './store.js';

export interface BuilderOptions {
  profile?: BuildProfile; publicUrl?: string; registry?: string; token?: string; cacheRoot?: string;
  onEvent?: (event: string, artifactKey: string) => void;
  beforeUpload?: (path: string, artifactKey: string) => Promise<void>;
  log?: (line: string) => void;
  install?: typeof install;
  bundle?: typeof bundle;
}
export class PackageBuilder {
  readonly profile: BuildProfile;
  publicUrl: string;
  readonly states = new Map<string, PackageSetStatus>();
  readonly builds = new Map<string, Promise<void>>();
  private readonly requests = new Map<string, Promise<PackageSetStatus>>();
  private readonly artifacts = new Map<string, Promise<PackageSetStatus>>();
  private readonly log: (message: unknown) => void;
  readonly metrics = { installs: 0, builds: 0 };
  readonly store: ObjectStore;
  constructor(store: ObjectStore, readonly options: BuilderOptions = {}) {
    this.store = {
      get: key => storageOperation(signal => store.get(key, signal), storageTimeouts().get),
      put: (key, body, contentType) => storageOperation(signal => store.put(key, body, contentType, signal), storageTimeouts().put),
      stream: key => storageOperation(signal => store.stream(key, signal), storageTimeouts().get),
    };
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
    const requestKey = sha256(canonicalJson({ entries: [...request.entries].sort(), dependencies: request.dependencies, buildProfile: this.profile }));
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
    const installed = await (this.options.install ?? install)(request, { registry: this.options.registry ?? settings().registry, token: this.options.token ?? settings().token, cacheRoot: this.options.cacheRoot });
    const identity = hashes(request.entries, installed.lock, this.profile), key = identity.artifactKey;
    // Reserve the artifact before any asynchronous store lookup. Different ranges
    // can converge here, after separate installs have produced identical lock bytes.
    let pending = this.artifacts.get(key);
    if (pending) {
      await this.cleanup(installed);
    } else {
      pending = Promise.resolve().then(() => this.resolveArtifact(request, installed, identity));
      this.artifacts.set(key, pending);
    }
    try {
      const state = await pending;
      await this.store.put(indexKey, Buffer.from(JSON.stringify({ artifactKey: key, createdAt: Date.now() })), 'application/json');
      return state;
    } finally {
      if (this.artifacts.get(key) === pending) this.artifacts.delete(key);
    }
  }
  private async resolveArtifact(request: PackageSetRequest, installed: Awaited<ReturnType<typeof install>>, identity: ReturnType<typeof hashes>): Promise<PackageSetStatus> {
    const key = identity.artifactKey;
    // The active build wins; otherwise recheck the persisted manifest under the reservation.
    if (this.builds.has(key)) { await this.cleanup(installed); return this.states.get(key)!; }
    let existing: PackageSetStatus | undefined;
    try { existing = await this.status(key); }
    catch (error) { await this.cleanup(installed); throw error; }
    if (existing && existing.status !== 'failed') { await this.cleanup(installed); return existing; }
    // No await between rechecking ownership and publishing building state.
    const claimed = this.states.get(key);
    if (claimed && claimed.status !== 'failed') { await this.cleanup(installed); return claimed; }
    const state: PackageSetStatus = { status: 'building', artifactKey: key, startedAt: new Date().toISOString() };
    this.states.set(key, state);
    const work = (async () => {
      try {
        this.metrics.builds++;
        this.options.onEvent?.('build-start', key);
        const result = await (this.options.bundle ?? bundle)(installed.directory, request.entries, this.profile);
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
        this.states.set(key, { status: 'failed', artifactKey: key, code: failureCode(error), error: 'Dependency build failed; check the masked worker log and retry the request' });
      } finally {
        this.builds.delete(key);
        await this.cleanup(installed);
      }
    })();
    this.builds.set(key, work);
    return state;
  }
  private async cleanup(installed: Awaited<ReturnType<typeof install>>) { try { await installed.cleanup(); } catch (error) { this.log(error); } }
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
