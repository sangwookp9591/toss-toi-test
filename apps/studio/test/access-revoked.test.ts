import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { HttpError, ACCESS_REVOKED_MESSAGE, accessMessage } from '../src/api.ts';
import * as broker from '../../../packages/preview-runtime/src/broker.ts';
import * as proxy from '../src/fetch-broker.ts';

function harness(t: TestContext) {
  const events = new EventTarget();
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const oldWindow = globalThis.window, oldHistory = globalThis.history;
  Object.assign(globalThis, { window: events, history: { replaceState() {} } });
  const project = { projectId: 'p', revision: 1, files: { '/src/App.tsx': 'original' }, apiIds: ['customers'] };
  let failure: ((url: string) => unknown) | undefined; const calls: string[] = [];
  const json = async (url: string) => {
    calls.push(url); const error = failure?.(url); if (error) throw error;
    if (url.endsWith('/membership')) return { projectId: 'p', members: [{ sub: 'bob', role: 'editor' }] };
    if (url.endsWith('/generations/active')) throw new HttpError(404, { error: 'no active generation' });
    if (url.endsWith('/generations')) return { generationId: 'g' };
    return project;
  };
  const compiled = transformSync(readFileSync(new URL('../src/controller.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const modules: Record<string, unknown> = {
    './fetch-broker.ts': proxy, '../../../packages/preview-runtime/src/broker.ts': broker,
    '../../../packages/preview-runtime/src/index.ts': {}, '../../../contracts/src/runtime.ts': {},
    './preview-auth.ts': {}, './api.ts': { API: { agent: 'agent' }, json, HttpError, accessMessage, ACCESS_REVOKED_MESSAGE }
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled)((name: string) => modules[name], module, module.exports);
  const controller = new module.exports.StudioController(); t.after(() => { controller.dispose(); Object.assign(globalThis, { window: oldWindow, history: oldHistory }); });
  return { controller, calls, fail: (value: typeof failure) => { failure = value; }, events };
}
const denied = new HttpError(404, { error: 'project not found' });
function locked(controller: any) {
  const state = controller.getSnapshot();
  assert.equal(state.accessRevoked, true); assert.equal(state.accessNotice, ACCESS_REVOKED_MESSAGE);
  for (const key of ['busy', 'saving', 'writeAllowed', 'previewPending']) assert.equal(state[key], false);
  assert.equal(state.lastCommit, undefined); assert.equal(state.membership, undefined);
}
test('policy membership denial uses body code, never a bare/resource 404', () => {
  for (const body of ['{"error":"PROJECT_NOT_FOUND"}', '{"code":"PROJECT_NOT_FOUND"}']) assert.equal(broker.isProjectAccessDenied({ status: 404, body }), true);
  for (const body of ['{"error":"NOT_FOUND"}', '{"error":"UPSTREAM_NOT_FOUND"}', 'not JSON', 'null', '{}']) assert.equal(broker.isProjectAccessDenied({ status: 404, body }), false);
  assert.equal(broker.isProjectAccessDenied({ status: 500, body: '{"error":"PROJECT_NOT_FOUND"}' }), false);
});
for (const action of ['loadMembership', 'saveFiles', 'generate']) test(`${action}: user API 404 locks editing, generation, saving and writes`, async t => {
  const h = harness(t); await h.controller.open('p');
  assert.equal(h.controller.getSnapshot().accessRevoked, false);
  h.fail(url => action === 'loadMembership' ? url.endsWith('/membership') && denied : action === 'saveFiles' ? url.endsWith('/source') && denied : url.endsWith('/generations') && denied);
  await h.controller[action]('a valid prompt'); locked(h.controller);
  const files = h.controller.getSnapshot().files, count = h.calls.length;
  h.controller.edit('forbidden'); await h.controller.saveFiles(); await h.controller.generate('forbidden'); await h.controller.setWriteAllowed(true);
  assert.deepEqual(h.controller.getSnapshot().files, files); assert.equal(h.calls.length, count); locked(h.controller);
});
test('30-second membership checks detect removal without preview requests and stop on dispose', async t => {
  const h = harness(t); await h.controller.open('p'); const count = h.calls.length;
  h.fail(url => url.endsWith('/membership') && denied);
  t.mock.timers.tick(29999); assert.equal(h.calls.length, count);
  t.mock.timers.tick(1); await Promise.resolve(); await Promise.resolve(); locked(h.controller);
  const after = h.calls.length; t.mock.timers.tick(60000); h.events.dispatchEvent(new Event('focus'));
  assert.equal(h.calls.length, after);
});
test('focus checks membership; transient failure does not revoke; disposal removes listener', async t => {
  const h = harness(t); await h.controller.open('p');
  h.fail(url => url.endsWith('/membership') && new HttpError(503, {}));
  h.events.dispatchEvent(new Event('focus')); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.controller.getSnapshot().accessRevoked, false);
  h.controller.dispose(); const count = h.calls.length; h.events.dispatchEvent(new Event('focus')); t.mock.timers.tick(30000);
  assert.equal(h.calls.length, count);
});
test('returning home clears only the denied project recovery and backups', async t => {
  const h = harness(t); const values = new Map([['toi-studio-generation-v1:p', '{}'], ['toi-studio-backups-v1:p', '[]'], ['toi-studio-generation-v1:other', '{}']]);
  const oldStorage = globalThis.sessionStorage, oldLocation = globalThis.location;
  let destination = '';
  Object.assign(globalThis, { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key) }, location: { assign: (path: string) => { destination = path; } } });
  t.after(() => Object.assign(globalThis, { sessionStorage: oldStorage, location: oldLocation }));
  h.fail(() => denied); await h.controller.open('p'); locked(h.controller);
  h.controller.returnHome(); assert.equal(destination, '/');
  assert.deepEqual([...values.keys()], ['toi-studio-generation-v1:other']);
});
