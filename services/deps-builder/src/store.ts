import { Client } from 'minio';
import type { Readable } from 'node:stream';
import { settings } from './config.js';
export interface ObjectStore {
  get(key: string, signal?: AbortSignal): Promise<Buffer | undefined>;
  put(key: string, body: Buffer, contentType: string, signal?: AbortSignal): Promise<void>;
  stream(key: string, signal?: AbortSignal): Promise<Readable>;
}
export class MinioStore implements ObjectStore {
  readonly client: Client;
  constructor(readonly bucket = settings().bucket) {
    const cfg = settings(), endpoint = new URL(cfg.minioUrl);
    this.client = new Client({ endPoint: endpoint.hostname, port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)), useSSL: endpoint.protocol === 'https:', accessKey: cfg.accessKey, secretKey: cfg.secretKey });
  }
  async init() {
    if (!await this.client.bucketExists(this.bucket)) {
      try { await this.client.makeBucket(this.bucket); } catch (error) { if (!await this.client.bucketExists(this.bucket)) throw error; }
    }
  }
  async get(key: string, signal?: AbortSignal) {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        if (signal?.aborted) { stream.destroy(); throw new Error('Storage operation aborted'); }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (['NoSuchKey', 'NotFound'].includes((error as { code?: string }).code ?? '')) return undefined;
      throw error;
    }
  }
  async put(key: string, body: Buffer, contentType: string) { await this.client.putObject(this.bucket, key, body, body.length, { 'Content-Type': contentType }); }
  stream(key: string) { return this.client.getObject(this.bucket, key); }
}
