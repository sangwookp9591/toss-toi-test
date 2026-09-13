import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import type { ObjectStore } from '../src/store.js';

export const listen = (server: Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
export const close = (server: Server) => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); });

/** In-memory ObjectStore test double; `fail` simulates an unreachable storage backend. */
export class MemoryStore implements ObjectStore {
  objects = new Map<string, Buffer>();
  puts: string[] = [];
  fail = false;
  async get(key: string) { await Promise.resolve(); if (this.fail) throw new Error('ECONNREFUSED'); return this.objects.get(key); }
  async put(key: string, body: Buffer) { if (this.fail) throw new Error('MinIO disconnected'); this.puts.push(key); this.objects.set(key, body); }
  async stream(key: string) { return Readable.from(this.objects.get(key) ?? []); }
}
