import * as esbuild from 'esbuild-wasm';
import type { BuildFailure, Loader } from 'esbuild-wasm';
import type { BundleRequest, BundleResponse } from './worker-protocol.ts';
import { isAllowedExternal, resolveVfsPath, VFS_NAMESPACE, stripVfsNamespace } from './vfs.ts';

let current: BundleRequest;
let context: esbuild.BuildContext | undefined;
let initialized = false;
let queue = Promise.resolve();
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<BundleRequest>) => void; postMessage: (message: BundleResponse) => void };
async function bundle(request: BundleRequest) {
  const start = performance.now();
  current = request;
  try {
    if (!initialized) {
      // We already run in a dedicated Worker. No nested Worker or isolation headers needed.
      await esbuild.initialize({ wasmURL: request.wasmUrl, worker: false });
      initialized = true;
    }
    context ??= await esbuild.context({
      entryPoints: [request.entry], absWorkingDir: '/', bundle: true, write: false,
      format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
      sourcemap: 'external', sourcesContent: false, outfile: '/bundle.js', logLevel: 'silent',
      plugins: [{ name: 'memory-vfs', setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          if (isAllowedExternal(args.path, current.imports)) return { path: args.path, external: true };
          if (!args.path.startsWith('.') && !args.path.startsWith('/')) {
            return { errors: [{ text: `package not in package set: ${args.path}` }] };
          }
          const path = resolveVfsPath(args.path, args.importer || '/', current.files);
          return path ? { path, namespace: VFS_NAMESPACE } : { errors: [{ text: `VFS file not found: ${args.path}`, location: null }] };
        });
        build.onLoad({ filter: /.*/, namespace: VFS_NAMESPACE }, args => {
          const ext = args.path.split('.').pop();
          if (!['tsx', 'ts', 'jsx', 'js', 'json'].includes(ext ?? '')) return { errors: [{ text: `unsupported VFS file: ${args.path}` }] };
          return { contents: current.files[args.path], loader: ext as Loader, resolveDir: args.path.slice(0, args.path.lastIndexOf('/')) || '/' };
        });
      } }]
    });
    const result = await context.rebuild();
    const output = Object.fromEntries(result.outputFiles!.map(file => [file.path, file.text]));
    scope.postMessage({ id: request.id, code: output['/bundle.js'], map: output['/bundle.js.map'], bundleMs: performance.now() - start });
  } catch (error) {
    const messages = (error as BuildFailure).errors;
    scope.postMessage({ id: request.id, diagnostics: messages?.map(item => ({ message: item.text, file: item.location ? stripVfsNamespace(item.location.file) : undefined, line: item.location?.line, column: item.location?.column })) ?? [{ message: String(error) }] });
  }
}
scope.onmessage = event => { queue = queue.then(() => bundle(event.data)); };
