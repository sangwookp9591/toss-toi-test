import type { ParentToFrame } from '../../../contracts/src/runtime.ts';

// Self-contained: serialized into the new document, after its import map.
function boot(payload: ParentToFrame, parentOrigin: string) {
  const start = performance.now();
  let failed = false;
  const report = (error: unknown) => {
    if (failed) return;
    failed = true;
    parent.postMessage({ kind: 'error', token: payload.token, error: { message: error instanceof Error ? error.message : String(error) }, stack: error instanceof Error ? error.stack : undefined }, parentOrigin);
  };
  document.addEventListener('securitypolicyviolation', event => {
    parent.postMessage({ kind: 'error', token: payload.token, error: { message: 'CSP_BLOCKED: 차단된 요청 (' + event.effectiveDirective + ')' } }, parentOrigin);
  });
  window.addEventListener('error', event => report(event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => report(event.reason));
  const mount = document.createElement('div');
  mount.id = payload.mountId;
  document.body.append(mount);
  const module = document.createElement('script');
  module.type = 'module';
  module.nonce = document.currentScript?.nonce ?? '';
  // textContent never invokes the HTML parser, including literal </script>.
  const completeKey = '__toi_boot_' + crypto.randomUUID().replaceAll('-', '');
  module.textContent = payload.code + '\n;globalThis[' + JSON.stringify(completeKey) + ']();';
  module.addEventListener('error', () => report(new Error('Preview module failed')));
  Object.defineProperty(globalThis, completeKey, { configurable: true, value: () => {
    Reflect.deleteProperty(globalThis, completeKey);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!failed) parent.postMessage({ kind: 'rendered', token: payload.token, bootMs: performance.now() - start }, parentOrigin);
    }));
  } });
  document.head.append(module);
}
const parentOrigin = new URL(location.href).searchParams.get('parentOrigin');
const nonce = document.querySelector<HTMLMetaElement>('meta[name="boot-nonce"]')!.content;
const allowedOrigins = document.querySelector<HTMLMetaElement>('meta[name="studio-origins"]')!.content.split(',');
if (parent !== window && parentOrigin && allowedOrigins.includes(parentOrigin)) {
  const onLoad = (event: MessageEvent<ParentToFrame>) => {
    if (event.origin !== parentOrigin || event.source !== parent || event.data?.kind !== 'load') return;
    if (event.data.token.projectId !== location.hostname.slice(2, -'.preview.localhost'.length) || (event.data.hostConfig?.toiFetch && event.data.hostConfig.toiFetch.projectId !== event.data.token.projectId)) return;
    const config = event.data.hostConfig?.toiFetch;
    if (config && (config.transport !== 'broker' || Object.keys(config).some(key => !['projectId', 'env', 'transport'].includes(key)))) {
      parent.postMessage({ kind: 'error', token: event.data.token, error: { message: 'Invalid preview host configuration' } }, parentOrigin); return;
    }
    window.removeEventListener('message', onLoad);
    const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    // Initialize credential-free host routing before the import map and any application module.
    const hostConfig = event.data.hostConfig?.toiFetch;
    const configure = hostConfig ? '<script nonce="' + nonce + '">globalThis.__TOI_FETCH_CONFIG__ = Object.freeze({...' + json(hostConfig) + '});</script>' : '';
    const bridge = '<script nonce="' + nonce + '">Object.defineProperty(globalThis,"__TOI_FETCH_BRIDGE__",{value:Object.freeze({parentOrigin:' + json(parentOrigin) + ',token:Object.freeze(' + json({ revision: event.data.token.revision, attemptId: event.data.token.attemptId }) + ')})});</script>';
    const markup = '<!doctype html><html><head><meta charset="utf-8">' + configure + bridge + '<script nonce="' + nonce + '" type="importmap">' + json(event.data.importMap) + '</script></head><body><script nonce="' + nonce + '">(' + boot.toString() + ')(' + json(event.data) + ',' + json(parentOrigin) + ')</script></body></html>';
    document.open();
    document.write(markup);
    document.close();
  };
  window.addEventListener('message', onLoad);
  parent.postMessage({ kind: 'frame_ready' }, parentOrigin);
}
