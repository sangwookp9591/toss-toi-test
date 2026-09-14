import { afterEach, expect, it, vi } from 'vitest';
import { BrowserPreviewRuntime, digestJson, sourceDigest } from '../src/index.ts';
import type { BuildInput, ParentToFrame } from '../../../contracts/src/runtime.ts';
import { fixture } from '../demo/fixture.ts';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('sends snapshotted hostConfig in the load message without changing revision identity', async () => {
  const events = new EventTarget();
  const frameWindow = { postMessage: vi.fn((payload: ParentToFrame, origin: string) => {
    expect(origin).toBe('http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5274');
    queueMicrotask(() => dispatch({ kind: 'rendered', token: payload.token, bootMs: 1 }));
  }) };
  const dispatch = (data: unknown) => {
    const event = new Event('message');
    Object.assign(event, { data, origin: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5274', source: frameWindow });
    events.dispatchEvent(event);
  };
  const frameEvents = new EventTarget();
  const frame = { contentWindow: frameWindow, style: { cssText: '' }, dataset: {}, sandbox: { add: vi.fn() }, setAttribute: vi.fn(), removeAttribute: vi.fn(), remove: vi.fn(), addEventListener: frameEvents.addEventListener.bind(frameEvents), removeEventListener: frameEvents.removeEventListener.bind(frameEvents), inert: false };
  vi.stubGlobal('location', { origin: 'http://localhost:5273' });
  vi.stubGlobal('window', Object.assign(events, { setTimeout }));
  vi.stubGlobal('document', { createElement: () => frame });
  const container = { append: () => queueMicrotask(() => { frameEvents.dispatchEvent(new Event('load')); dispatch({ kind: 'frame_ready' }); }) } as unknown as HTMLElement;
  const runtime = new BrowserPreviewRuntime({ container, previewOrigin: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5274', frameUrl: 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5274/frame.html', esbuildWasmUrl: 'http://localhost:5273/esbuild.wasm', entry: '/src/main.tsx' });
  vi.spyOn(runtime as any, 'compile').mockResolvedValue({ code: '', bundleMs: 1 });
  const files = { '/src/main.tsx': '' };
  const input: BuildInput = { layers: { user: files }, manifest: fixture, token: { projectId: '00000000-0000-4000-8000-000000000000', revision: 1, attemptId: 'same-attempt', sourceDigest: await sourceDigest(files), manifestDigest: await digestJson(fixture) }, hostConfig: { toiFetch: { transport: 'broker', projectId: '00000000-0000-4000-8000-000000000000', env: 'preview' } } };
  const expected = structuredClone(input.hostConfig);
  runtime.setDesiredRevision(input.token);
  try {
    const pending = runtime.build(input);
    input.hostConfig!.toiFetch!.env = 'live';
    expect((await pending).type).toBe('committed');
    expect(frameWindow.postMessage.mock.calls[0][0]).toMatchObject({ kind: 'load', token: input.token, hostConfig: expected });
    expect((await runtime.build(input)).type).toBe('committed');
    expect(frameWindow.postMessage.mock.calls[1][0].hostConfig).toEqual(input.hostConfig);
    expect(frameWindow.postMessage.mock.calls[1][0].token).toEqual(frameWindow.postMessage.mock.calls[0][0].token);
  } finally { runtime.dispose(); }
});

it('rejects shared, malformed, alternate-parent, and cross-project origin configuration', () => {
  vi.stubGlobal('location', {origin:'http://localhost:5273'});
  for (const previewOrigin of ['http://localhost:5274', 'http://127.0.0.1:5274', 'http://p-invalid.preview.localhost:5274', 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5374']) {
    expect(() => new BrowserPreviewRuntime({container:{} as HTMLElement, previewOrigin, frameUrl:previewOrigin+'/frame.html', esbuildWasmUrl:'/esbuild.wasm', entry:'/src/main.tsx'})).toThrow('project preview origin');
  }
  const origin = 'http://p-00000000-0000-4000-8000-000000000000.preview.localhost:5274';
  const runtime = new BrowserPreviewRuntime({container:{} as HTMLElement, previewOrigin:origin, frameUrl:origin+'/frame.html', esbuildWasmUrl:'/esbuild.wasm', entry:'/src/main.tsx'});
  expect(() => runtime.setDesiredRevision({projectId:'00000000-0000-4000-8000-000000000001', revision:1,attemptId:'other',sourceDigest:'a',manifestDigest:'b'})).toThrow('preview project origin mismatch');
  runtime.dispose();
});
