import { createPreviewRuntime, digestJson, mergeVfs, sourceDigest } from '../src/index.ts';
import { previewOriginForProject } from '../../../contracts/src/runtime.ts';
import type { BuildInput, PreviewEvent } from '../../../contracts/src/runtime.ts';
import type { PackageSetManifest } from '../../../contracts/src/package-set.ts';
import { fixture, initialSource } from './fixture.ts';

const editor = document.querySelector<HTMLTextAreaElement>('#editor')!;
const status = document.querySelector<HTMLElement>('#status')!;
const events: PreviewEvent[] = [];
let runtime: ReturnType<typeof createPreviewRuntime>;
let manifest: PackageSetManifest;
let revision = 0;
let lastInput: BuildInput | undefined;
const params = new URLSearchParams(location.search);

async function init() {
  const manifestUrl = params.get('manifestUrl');
  if (manifestUrl) {
    const response = await fetch(manifestUrl);
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    const data = await response.json();
    manifest = data.manifest ?? data;
  } else manifest = fixture;
  const previewOrigin = previewOriginForProject('00000000-0000-4000-8000-000000000000');
  runtime = createPreviewRuntime({ container: document.querySelector('#preview')!, previewOrigin, frameUrl: previewOrigin + '/frame.html', esbuildWasmUrl: new URL('/esbuild.wasm', location.origin).href, entry: '/src/main.tsx', bootTimeoutMs: 15000 });
  runtime.on(event => {
    events.push(event);
    status.textContent = JSON.stringify(event, null, 2);
  });
  editor.value = initialSource;
}
async function prepare(source: string, requestedRevision = ++revision): Promise<BuildInput> {
  const layers = { user: { '/src/main.tsx': source } };
  return { layers, manifest, token: { projectId: '00000000-0000-4000-8000-000000000000', revision: requestedRevision, attemptId: crypto.randomUUID(), sourceDigest: await sourceDigest(mergeVfs(layers)), manifestDigest: await digestJson(manifest) } };
}
async function run(source = editor.value) {
  lastInput = await prepare(source);
  runtime.setDesiredRevision(lastInput.token);
  return runtime.build(lastInput);
}
const ready = init();
// Deliberately exposed demo harness: tests use the same public runtime as the UI.
const demo = { ready, events, prepare, run, get runtime() { return runtime; }, get manifest() { return manifest; } };
Object.assign(window, { demo });
document.querySelector('#build')!.addEventListener('click', () => { void ready.then(() => run()); });
document.querySelector('#cancel')!.addEventListener('click', () => { if (lastInput) runtime.cancel(lastInput.token); });
void ready.then(() => { if (!params.has('manual')) return run(); }).catch(error => { status.textContent = String(error); });
export type Demo = typeof demo;
