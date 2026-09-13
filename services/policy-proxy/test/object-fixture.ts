import type { ObjectStore } from '../src/objects.js';
export class MemoryObjects implements ObjectStore {
  values = new Map<string, Buffer>(); fail = false;
  async put(key: string, data: Buffer) { if (this.fail || this.values.has(key)) throw new Error('Object write failed'); this.values.set(key, Buffer.from(data)); }
  async get(key: string) { if (this.fail || !this.values.has(key)) throw new Error('Object read failed'); return Buffer.from(this.values.get(key)!); }
  async remove(key: string) { if (this.fail) throw new Error('Object delete failed'); this.values.delete(key); }
  async list(prefix: string) { if (this.fail) throw new Error('Object list failed'); return [...this.values.keys()].filter(k => k.startsWith(prefix)); }
}
