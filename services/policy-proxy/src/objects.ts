import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
export interface ListOptions { startAfter?: string; maxKeys?: number }
export interface ObjectStore {
  put(key: string, value: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  list(prefix: string, options?: ListOptions): Promise<string[]>;
}
export class S3Objects implements ObjectStore {
  private client: S3Client;
  constructor(endpoint: string, accessKeyId: string, secretAccessKey: string, private bucket: string, private retentionDays = 1) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500) throw new Error('Invalid audit retention days');
    this.client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2 });
  }
  async put(key: string, value: Buffer) {
    // A conditional create is atomic; never replace an existing audit object.
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: value, IfNoneMatch: '*', ContentType: 'application/octet-stream', ...(/^audit\/(segments|anchors)\//.test(key) ? { ObjectLockMode: 'COMPLIANCE' as const, ObjectLockRetainUntilDate: new Date(Date.now() + this.retentionDays * 86400000) } : {}) }), { abortSignal: AbortSignal.timeout(10000) });
  }
  async get(key: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) });
    return Buffer.from(await result.Body!.transformToByteArray());
  }
  async remove(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) }); }
  async list(prefix: string, options: ListOptions = {}) {
    const keys: string[] = []; let token: string | undefined;
    do {
      const result = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token, StartAfter: options.startAfter, MaxKeys: options.maxKeys }), { abortSignal: AbortSignal.timeout(10000) });
      keys.push(...(result.Contents ?? []).flatMap(item => item.Key ? [item.Key] : [])); token = result.NextContinuationToken;
    } while (token && options.maxKeys === undefined);
    return keys;
  }
}
