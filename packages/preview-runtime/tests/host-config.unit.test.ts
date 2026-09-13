import { afterEach, expect, it, vi } from 'vitest';
import { BrowserPreviewRuntime, digestJson, sourceDigest } from '../src/index.ts';
import type { BuildInput, ParentToFrame } from '../../../contracts/src/runtime.ts';
import { fixture } from '../demo/fixture.ts';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('sends snapshotted hostConfig in the load message without changing revision identity', async () => {
  const events = new EventTarget();
  const frameWindow = { postMessage: vi.fn((payload: ParentToFrame, origin: string) => {
    expect(origin).toBe('http://localhost:5174');
    queueMicrotask(() => dispatch({ kind: 'rendered', token: payload.token, bootMs: 1 }));
  }) };
  const dispatch = (data: unknown) => {
    const event = new Event('message');
    Object.assign(event, { data, origin: 'http://localhost:5174', source: frameWindow });
    events.dispatchEvent(event);
  };
  const frame = { contentWindow: frameWindow, style: { cssText: '' }, dataset: {}, sandbox: { add: vi.fn() }, setAttribute: vi.fn(), removeAttribute: vi.fn(), remove: vi.fn(), inert: false };
  vi.stubGlobal('location', { origin: 'http://localhost:5173' });
  vi.stubGlobal('window', Object.assign(events, { setTimeout }));
  vi.stubGlobal('document', { createElement: () => frame });
  const container = { append: () => queueMicrotask(() => dispatch({ kind: 'frame_ready' })) } as unknown as HTMLElement;
  const runtime = new BrowserPreviewRuntime({ container, previewOrigin: 'http://localhost:5174', frameUrl: 'http://localhost:5174/frame.html', esbuildWasmUrl: 'http://localhost:5173/esbuild.wasm', entry: '/src/main.tsx' });
  vi.spyOn(runtime as any, 'compile').mockResolvedValue({ code: '', bundleMs: 1 });
  const files = { '/src/main.tsx': '' };
  const input: BuildInput = { layers: { user: files }, manifest: fixture, token: { projectId: 'p', revision: 1, attemptId: 'same-attempt', sourceDigest: await sourceDigest(files), manifestDigest: await digestJson(fixture) }, hostConfig: { toiFetch: { sessionToken: 'viewer-session', capabilityToken: 'read-capability', projectId: 'p', proxyBaseUrl: 'http://localhost:7200', env: 'preview' } } };
  const expected = structuredClone(input.hostConfig);
  runtime.setDesiredRevision(input.token);
  try {
    const pending = runtime.build(input);
    input.hostConfig!.toiFetch!.capabilityToken = 'caller-mutated-token';
    expect((await pending).type).toBe('committed');
    expect(frameWindow.postMessage.mock.calls[0][0]).toMatchObject({ kind: 'load', token: input.token, hostConfig: expected });
    expect((await runtime.build(input)).type).toBe('committed');
    expect(frameWindow.postMessage.mock.calls[1][0].hostConfig).toEqual(input.hostConfig);
    expect(frameWindow.postMessage.mock.calls[1][0].token).toEqual(frameWindow.postMessage.mock.calls[0][0].token);
  } finally { runtime.dispose(); }
});
