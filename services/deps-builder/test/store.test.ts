import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { MinioStore } from '../src/store.js';

function fakeStore(getObject: () => Promise<Readable>) {
  const store = new MinioStore('test-bucket');
  Object.defineProperty(store, 'client', { value: { getObject }, writable: false });
  return store;
}

test('MinioStore.get maps missing MinIO objects to undefined', async () => {
  for (const code of ['NoSuchKey', 'NotFound']) {
    const store = fakeStore(async () => { const error = Object.assign(new Error(code), { code }); throw error; });
    assert.equal(await store.get('missing'), undefined);
  }
});

test('MinioStore.get collects an existing object with a fake client', async () => {
  const store = fakeStore(async () => Readable.from([Buffer.from('hello '), Buffer.from('world')]));
  assert.equal((await store.get('present'))?.toString(), 'hello world');
});
