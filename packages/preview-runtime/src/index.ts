import { FrameBroker, type FetchBroker } from './broker.ts';
import { projectIdFromPreviewOrigin } from '../../../contracts/src/runtime.ts';
import type { BuildInput, Diagnostic, ParentToFrame, PreviewEvent, PreviewRuntime, PreviewRuntimeOptions, RevisionToken } from '../../../contracts/src/runtime.ts';
import type { BundleRequest, BundleResponse } from './worker-protocol.ts';
import { digestJson, mergeVfs, sourceDigest } from './vfs.ts';
import { commitDecision, sameToken, tokenKey } from './guard.ts';
import { runtimeDiagnostic, type BundleSource, type RuntimeFrameMessage } from './runtime-diagnostic.ts';
export { canonicalJson, digestJson, mergeVfs, sourceDigest, isAllowedExternal } from './vfs.ts';
export { commitDecision, sameToken } from './guard.ts';
export type { BuildInput, PreviewHostConfig, PreviewRuntime, PreviewRuntimeOptions, RevisionToken, PreviewEvent } from '../../../contracts/src/runtime.ts';

export function createPreviewRuntime(options: PreviewRuntimeOptions, broker?: FetchBroker): PreviewRuntime {
  return new BrowserPreviewRuntime(options, broker);
}

export class BrowserPreviewRuntime implements PreviewRuntime {
  private desired?: RevisionToken;
  private canceled = new Set<string>();
  private listeners = new Set<(event: PreviewEvent) => void>();
  private worker?: Worker;
  private pending = new Map<number, { resolve: (result: BundleResponse) => void; reject: (error: Error) => void }>();
  private sequence = 0;
  private active?: HTMLIFrameElement;
  private activeCleanup?: () => void;
  private candidates = new Map<HTMLIFrameElement, () => void>();
  private frameBrokers = new Map<FrameBroker, RevisionToken>();
  private disposed = false;
  private options: PreviewRuntimeOptions;

  private navigationTimes: number[] = [];
  private recovery?: { payload: ParentToFrame; bundle: BundleSource };
  private committedPayload?: { payload: ParentToFrame; bundle: BundleSource };
  constructor(options: PreviewRuntimeOptions, private broker?: FetchBroker) {
    this.options = { ...options };
    if (!projectIdFromPreviewOrigin(options.previewOrigin) || options.previewOrigin === location.origin) throw new Error('previewOrigin must be a project preview origin');
    if (new URL(options.frameUrl).origin !== options.previewOrigin) throw new Error('frameUrl must belong to previewOrigin');
  }
  setDesiredRevision(token: RevisionToken) {
    if (token.projectId !== projectIdFromPreviewOrigin(this.options.previewOrigin)) throw new Error('preview project origin mismatch');
    this.desired = { ...token }; }
  cancel(token: RevisionToken) { this.canceled.add(tokenKey(token)); for (const [broker, revision] of this.frameBrokers) if (sameToken(token, revision)) broker.invalidate(); }
  on(listener: (event: PreviewEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: PreviewEvent): PreviewEvent {
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch (error) { console.error('Preview event listener failed', error); }
    }
    return event;
  }
  private compile(request: Omit<BundleRequest, 'id'>): Promise<BundleResponse> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<BundleResponse>) => {
        this.pending.get(event.data.id)?.resolve(event.data);
        this.pending.delete(event.data.id);
      };
      this.worker.onerror = event => {
        for (const pending of this.pending.values()) pending.reject(new Error(event.message || 'Preview Worker failed'));
        this.pending.clear();
        this.worker?.terminate();
        this.worker = undefined;
      };
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ ...request, id });
    });
  }
  async build(input: BuildInput): Promise<PreviewEvent> {
    const start = performance.now();
    const snapshot = structuredClone(input);
    const { token, manifest } = snapshot;
    this.emit({ type: 'build_started', token });
    const failed = (diagnostics: Diagnostic[]) => this.emit({ type: 'build_failed', token, diagnostics });
    if (this.disposed) return this.emit({ type: 'stale_discarded', token, reason: 'canceled' });
    try {
      if (token.projectId !== projectIdFromPreviewOrigin(this.options.previewOrigin) || (snapshot.hostConfig?.toiFetch && snapshot.hostConfig.toiFetch.projectId !== token.projectId)) return failed([{ message: 'preview project origin mismatch' }]);
      const files = mergeVfs(snapshot.layers);
      const [actualSource, actualManifest] = await Promise.all([sourceDigest(files), digestJson(manifest)]);
      if (actualManifest !== token.manifestDigest) return this.emit({ type: 'stale_discarded', token, reason: 'manifest_mismatch' });
      if (actualSource !== token.sourceDigest) return failed([{ message: 'source digest does not match merged VFS' }]);
      if (this.disposed) return this.emit({ type: 'stale_discarded', token, reason: 'canceled' });
      const result = await this.compile({ files, imports: manifest.importMap.imports, entry: this.options.entry, wasmUrl: this.options.esbuildWasmUrl });
      if ('diagnostics' in result) return failed(result.diagnostics);
      if (this.disposed) return this.emit({ type: 'stale_discarded', token, reason: 'canceled' });
      // A unique sourceURL labels stack frames without embedding the data module
      // (and its code) in the stack. It is a label, never a fetched resource.
      const bundle: BundleSource = { url: new URL('/__toi_preview__/' + crypto.randomUUID() + '.js', location.origin).href, map: result.map, files: new Set(Object.keys(files)) };
      return await this.stage({ kind: 'load', token, importMap: manifest.importMap, code: result.code + '\n//# sourceURL=' + bundle.url, mountId: this.options.mountId ?? 'root', ...(snapshot.hostConfig ? { hostConfig: snapshot.hostConfig } : {}) }, result.bundleMs, start, bundle);
    } catch (error) {
      return this.disposed ? this.emit({ type: 'stale_discarded', token, reason: 'canceled' }) : failed([{ message: String(error) }]);
    }
  }
  private stage(payload: ParentToFrame, bundleMs: number, start: number, bundle: BundleSource): Promise<PreviewEvent> {
    return new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.title = `Preview revision ${payload.token.revision}`;
      frame.dataset.state = 'candidate';
      frame.sandbox.add('allow-scripts', 'allow-same-origin');
      // Keep layout/rAF available while hiding the candidate from sight and input.
      frame.style.cssText = 'position:absolute;inset:0;opacity:0;pointer-events:none;width:100%;height:100%;border:0';
      frame.setAttribute('aria-hidden', 'true');
      frame.inert = true;
      let settled = false;
      let loaded = false;
      let ready = false;
      let loadCount = 0;
      let frameBroker: FrameBroker | undefined;
      const cleanup = () => {
        frameBroker?.invalidate(); if (frameBroker) this.frameBrokers.delete(frameBroker);
        window.removeEventListener('message', onMessage);
        frame.removeEventListener('load', onNavigation);
      };
      const sendLoad = () => {
        if (!ready || loadCount === 0 || loaded) return;
        loaded = true;
        if (this.broker) { frameBroker = new FrameBroker(frame.contentWindow!, this.options.previewOrigin, payload.token, this.broker); this.frameBrokers.set(frameBroker, payload.token); }
        frame.contentWindow!.postMessage(payload, this.options.previewOrigin);
      };
      const onNavigation = () => {
        loadCount++;
        // Wait for the loader's first load before replacing its document. The
        // second load belongs to document.open; every later load is navigation.
        if (loadCount === 1) { sendLoad(); return; }
        if (loadCount === 2) return;
        if (this.active !== frame) { if (!settled) finish(false, 0, { message: 'preview navigated away' }); return; }
        cleanup(); frame.remove(); this.active = undefined; this.activeCleanup = undefined;
        const now = Date.now(); this.navigationTimes = this.navigationTimes.filter(time => time > now - 60000); this.navigationTimes.push(now);
        this.emit({ type: 'runtime_failed', token: payload.token, error: { message: 'preview navigated away' } });
        const recovery = this.recovery ?? this.committedPayload;
        this.committedPayload = undefined; this.recovery = undefined;
        if (recovery && this.navigationTimes.length < 3 && !this.disposed && sameToken(payload.token, this.desired)) {
          this.desired = { ...recovery.payload.token };
          void this.stage(structuredClone(recovery.payload), 0, performance.now(), recovery.bundle);
        } else if (this.navigationTimes.length >= 3) {
          this.emit({ type: 'runtime_failed', token: payload.token, error: { message: 'preview navigated away: recovery limit reached (3/min)' } });
        }
      };
      const finish = (rendered: boolean, bootMs = 0, error: Diagnostic = { message: 'Preview boot timed out' }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Keep the authenticated listener for errors after a successful commit.
        this.candidates.delete(frame);
        const decision = commitDecision(payload.token, this.desired, this.disposed || this.canceled.has(tokenKey(payload.token)), rendered);
        let event: PreviewEvent;
        if (decision === 'commit') {
          frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
          frame.removeAttribute('aria-hidden');
          frame.inert = false;
          frame.dataset.state = 'committed';
          this.activeCleanup?.();
          this.activeCleanup = cleanup;
          this.recovery = this.committedPayload;
          this.committedPayload = { payload, bundle };
          this.active?.remove();
          this.active = frame;
          event = { type: 'committed', token: payload.token, timings: { bundleMs, bootMs, totalMs: performance.now() - start } };
        } else {
          cleanup();
          frame.remove();
          event = decision === 'runtime_failed' ? { type: 'runtime_failed', token: payload.token, error } : { type: 'stale_discarded', token: payload.token, reason: decision };
        }
        resolve(this.emit(event));
      };
      const onMessage = (event: MessageEvent<RuntimeFrameMessage>) => {
        if (event.origin !== this.options.previewOrigin || event.source !== frame.contentWindow || !event.data) return;
        if ((event.data as { kind: string }).kind === 'toi_fetch') { if (!this.canceled.has(tokenKey(payload.token))) void frameBroker?.receive(event); return; }
        if (event.data.kind === 'frame_ready' && !loaded) {
          ready = true; sendLoad();
        } else if (loaded && event.data.kind === 'rendered' && sameToken(event.data.token, payload.token)) {
          finish(true, event.data.bootMs);
        } else if (loaded && event.data.kind === 'error' && sameToken(event.data.token, payload.token)) {
          const error = runtimeDiagnostic(event.data.error.message, event.data.stack, bundle);
          if (settled && this.active === frame) this.emit({ type: 'runtime_failed', token: payload.token, error });
          else finish(false, 0, error);
        }
      };
      const timer = window.setTimeout(() => finish(false), this.options.bootTimeoutMs ?? 5000);
      this.candidates.set(frame, () => finish(false));
      window.addEventListener('message', onMessage);
      const url = new URL(this.options.frameUrl);
      url.searchParams.set('parentOrigin', location.origin);
      frame.src = url.href;
      frame.addEventListener('load', onNavigation);
      this.options.container.append(frame);
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const finish of this.candidates.values()) finish();
    this.worker?.terminate();
    this.worker = undefined;
    for (const pending of this.pending.values()) pending.reject(new Error('Preview disposed'));
    this.pending.clear();
    this.activeCleanup?.();
    this.activeCleanup = undefined;
    this.active?.remove();
    this.active = undefined;
    this.listeners.clear();
    this.canceled.clear();
  }
}
