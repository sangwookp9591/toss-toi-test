import type { ParentToFrame } from '../../../contracts/src/runtime.ts';

// Self-contained: serialized into the new document, after its import map.
function boot(payload: ParentToFrame, parentOrigin: string) {
  const start = performance.now();
  let failed = false;
  const report = (error: unknown) => {
    if (failed) return;
    failed = true;
    parent.postMessage({ kind: 'error', token: payload.token, error: { message: error instanceof Error ? error.message : String(error) }, ...(error instanceof Error && typeof error.stack === 'string' ? { stack: error.stack } : {}) }, parentOrigin);
  };
  window.addEventListener('error', event => report(event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => report(event.reason));
  const mount = document.createElement('div');
  mount.id = payload.mountId;
  document.body.append(mount);
  // A data module is an execution URL only; the iframe stays a real HTTP document.
  // Encoding avoids interpreting user strings such as </script> as HTML markup.
  const moduleUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(payload.code);
  import(moduleUrl).then(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!failed) parent.postMessage({ kind: 'rendered', token: payload.token, bootMs: performance.now() - start }, parentOrigin);
    }));
  }).catch(report);
}
const parentOrigin = new URL(location.href).searchParams.get('parentOrigin');
const allowedOrigins = document.querySelector<HTMLMetaElement>('meta[name="studio-origins"]')!.content.split(',');
if (parent !== window && parentOrigin && allowedOrigins.includes(parentOrigin)) {
  const onLoad = (event: MessageEvent<ParentToFrame>) => {
    if (event.origin !== parentOrigin || event.source !== parent || event.data?.kind !== 'load') return;
    window.removeEventListener('message', onLoad);
    const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    // Initialize host credentials before the import map and any application module.
    const hostConfig = event.data.hostConfig?.toiFetch;
    const configure = hostConfig ? '<script>globalThis.__TOI_FETCH_CONFIG__ = Object.freeze({...' + json(hostConfig) + '});</script>' : '';
    const markup = '<!doctype html><html><head><meta charset="utf-8">' + configure + '<script type="importmap">' + json(event.data.importMap) + '</script></head><body><script>(' + boot.toString() + ')(' + json(event.data) + ',' + json(parentOrigin) + ')</script></body></html>';
    document.open();
    document.write(markup);
    document.close();
  };
  window.addEventListener('message', onLoad);
  parent.postMessage({ kind: 'frame_ready' }, parentOrigin);
}
