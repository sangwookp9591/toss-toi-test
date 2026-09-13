import { createCipheriv, createDecipheriv, randomBytes, randomUUID, createHmac, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import type { DownloadRequest, DownloadTicket, EncryptedDownloadRecord } from '../../../contracts/src/policy.js';
import type { DownloadConfig } from './config.js';
import type { ObjectStore } from './objects.js';
import { durableWrite, sha256 } from './audit.js';
import { HttpError } from './tokens.js';
const derive = promisify(scrypt);
function seal(data: Buffer, key: Buffer, aad: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return { ciphertext, iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}
function unseal(data: Buffer, key: Buffer, iv: string, authTag: string, aad: string) {
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
export function envelopeEncrypt(data: Buffer, kek: Buffer, context: string) {
  const key = randomBytes(32);
  try {
    const encrypted = seal(data, key, context), wrapped = seal(key, kek, 'key:' + context);
    return { ...encrypted, wrappedDataKey: Buffer.from(JSON.stringify({ ...wrapped, ciphertext: wrapped.ciphertext.toString('base64') })).toString('base64'), ciphertextSha256: sha256(encrypted.ciphertext) };
  } finally { key.fill(0); }
}
export function envelopeDecrypt(data: Buffer, record: Pick<EncryptedDownloadRecord, 'wrappedDataKey' | 'iv' | 'authTag' | 'ciphertextSha256'>, kek: Buffer, context: string) {
  if (sha256(data) !== record.ciphertextSha256) throw new Error('Encrypted object integrity check failed');
  const wrap = JSON.parse(Buffer.from(record.wrappedDataKey, 'base64').toString());
  const key = unseal(Buffer.from(wrap.ciphertext, 'base64'), kek, wrap.iv, wrap.authTag, 'key:' + context);
  try { return unseal(data, key, record.iv, record.authTag, context); } finally { key.fill(0); }
}
const cell = (value: unknown) => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export function csvCell(value: unknown) {
  let text = cell(value); if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function downloadRows(value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as {items?:unknown}).items) ? (value as {items:unknown[]}).items : value && typeof value === 'object' ? [value] : [];
  if (rows.length > 10000) throw new HttpError(413, 'DOWNLOAD_ROW_LIMIT');
  if (!rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) throw new HttpError(502, 'DOWNLOAD_DATA_INVALID');
  return rows as Record<string, unknown>[];
}
export async function generateFile(rows: Record<string, unknown>[], format: DownloadRequest['format']) {
  const columns = [...new Set(rows.flatMap(Object.keys))];
  if (format === 'csv') return Buffer.from('\ufeff' + [columns.map(csvCell).join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n'));
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Data');
  sheet.addRow(columns); for (const row of rows) sheet.addRow(columns.map(key => cell(row[key])));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function encryptedZip(file: Buffer, filename: string, password: string) {
  const zip = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await zip.add(filename, new Uint8ArrayReader(file), { password, encryptionStrength: 3, zipCrypto: false });
  return Buffer.from(await zip.close());
}
export class Downloads {
  readonly records = new Map<string, EncryptedDownloadRecord>();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  constructor(private directory: string, private objects: ObjectStore, private config: DownloadConfig) {}
  private serial<T>(fn: () => Promise<T>) { const op = this.queue.then(fn); this.queue = op.catch(() => {}); return op; }
  private async save(record: EncryptedDownloadRecord) {
    const file = path.join(this.directory, record.downloadId + '.json');
    await durableWrite(file + '.tmp', JSON.stringify(record)); await rename(file + '.tmp', file); this.records.set(record.downloadId, record);
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) if (/^[a-f0-9-]{36}\.json$/.test(name)) {
      const record = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as EncryptedDownloadRecord; this.records.set(record.downloadId, record);
    }
    await this.cleanup().catch(() => {});
    this.timer = setInterval(() => { void this.cleanup().catch(() => {}); }, 1000); this.timer.unref();
  }
  close() { if (this.timer) clearInterval(this.timer); }
  private signature(id: string, sub: string, exp: string) { return createHmac('sha256', Buffer.from(this.config.urlSecret, 'hex')).update(JSON.stringify([id, sub, exp])).digest('hex'); }
  async create(input: DownloadRequest, requestedBy: string, value: unknown, maskedFields: string[]): Promise<DownloadTicket> {
    const rows = downloadRows(value), downloadId = randomUUID(), zipPassword = randomBytes(24).toString('base64url');
    const file = await generateFile(rows, input.format);
    let zip: Buffer | undefined;
    const kek = Buffer.from(this.config.kek, 'hex');
    try {
      zip = await encryptedZip(file, `data.${input.format}`, zipPassword);
      const sealed = envelopeEncrypt(zip, kek, downloadId), salt = randomBytes(16).toString('hex');
      const hash = await derive(zipPassword, salt, 32) as Buffer;
      const now = Date.now(), retainUntil = new Date(now + this.config.retainMs).toISOString();
      const record: EncryptedDownloadRecord = { downloadId, projectId: input.projectId, apiId: input.apiId, requestedBy, format: input.format, createdAt: new Date(now).toISOString(), retainUntil, kekId: this.config.kekId, wrappedDataKey: sealed.wrappedDataKey, iv: sealed.iv, authTag: sealed.authTag, ciphertextSha256: sealed.ciphertextSha256, zipPasswordHash: `scrypt:${salt}:${hash.toString('hex')}`, maskedFields, fetchCount: 0 };
      await this.serial(async () => {
        // Persist the retention tombstone before upload so even a failed/ambiguous
        // object write is eventually cleaned after a crash.
        await this.save(record);
        await this.objects.put(`downloads/${downloadId}.bin`, sealed.ciphertext);
      });
      const exp = String(Math.floor(Math.min(now + 60000, Date.parse(retainUntil)) / 1000));
      return { downloadId, zipPassword, url: `/downloads/${downloadId}?exp=${exp}&sig=${this.signature(downloadId, requestedBy, exp)}`, expiresAt: new Date(Number(exp) * 1000).toISOString(), rowCount: rows.length, retainUntil };
    } finally { file.fill(0); zip?.fill(0); kek.fill(0); }
  }
  fetch(id: string, sub: string, exp: string, sig: string) {
    return this.serial(async () => {
      const r = this.records.get(id); if (!r || r.requestedBy !== sub) throw new HttpError(404, 'DOWNLOAD_NOT_FOUND');
      if (!/^\d{10}$/.test(exp) || !/^[a-f0-9]{64}$/.test(sig) || !timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(this.signature(id, sub, exp), 'hex'))) throw new HttpError(403, 'DOWNLOAD_SIGNATURE_INVALID');
      if (Number(exp) * 1000 <= Date.now() || Number(exp) * 1000 > Date.parse(r.createdAt) + 60000 || Date.parse(r.retainUntil) <= Date.now() || r.fetchCount || !r.wrappedDataKey) throw new HttpError(410, 'DOWNLOAD_GONE');
      if (r.kekId !== this.config.kekId) throw new HttpError(503, 'DOWNLOAD_KEY_UNAVAILABLE');
      const kek = Buffer.from(this.config.kek, 'hex'); let zip: Buffer;
      try { zip = envelopeDecrypt(await this.objects.get(`downloads/${id}.bin`), r, kek, id); } catch { throw new HttpError(503, 'DOWNLOAD_UNAVAILABLE'); } finally { kek.fill(0); }
      try { await this.save({ ...r, fetchCount: 1 }); } catch { zip.fill(0); throw new HttpError(503, 'DOWNLOAD_UNAVAILABLE'); }
      return { zip, record: { ...r, fetchCount: 1 } };
    });
  }
  remove(id: string) { return this.serial(async () => {
    const r = this.records.get(id); if (!r?.wrappedDataKey) return;
    await this.objects.remove(`downloads/${id}.bin`); await this.save({ ...r, wrappedDataKey: '' });
  }); }
  async cleanup() {
    for (const r of this.records.values()) if (r.wrappedDataKey && (Date.parse(r.retainUntil) <= Date.now() || r.fetchCount > 0)) await this.remove(r.downloadId);
  }
}
