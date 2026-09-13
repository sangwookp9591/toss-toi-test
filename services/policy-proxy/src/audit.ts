import { createHash } from 'node:crypto';
import { readFile, open, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AuditRecord } from '../../../contracts/src/policy.js';
import type { PolicyWarning } from './mask.js';
import type { ObjectStore } from './objects.js';
import { HttpError } from './tokens.js';
export type AuditInput = Omit<AuditRecord, 'seq' | 'prevHash' | 'hash'> & { policyWarnings?: PolicyWarning[]; legacySha256?: string };
export type ChainedAudit = AuditInput & Pick<AuditRecord, 'seq' | 'prevHash' | 'hash'>;
export const zeroHash = '0'.repeat(64);
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
  return JSON.stringify(value);
}
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function durableWrite(file: string, data: string, append = false) {
  const fd = await open(file, append ? 'a' : 'w', 0o600);
  try { await fd.writeFile(data); await fd.datasync(); } finally { await fd.close(); }
}
export class AuditChain {
  private queue: Promise<unknown> = Promise.resolve();
  private records: ChainedAudit[] = [];
  private lines: string[] = [];
  private replicated = new Set<string>();
  private replicatedThrough = 0;
  private lastReplication = Date.now();
  private replicationFailedAt: number | undefined;
  private anchorSeq = 0;
  private anchoredThrough = 0;
  private maintenanceRunning = false;
  private anchorChecked = false;
  private anchorFailedAt: number | undefined;
  brokenAt: number | undefined;
  private timer?: NodeJS.Timeout;
  constructor(readonly directory: string, private objects?: ObjectStore, private segmentSize = 1000, private intervalMs = 300000) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const op = this.queue.then(fn); this.queue = op.catch(() => {}); return op;
  }
  assertHealthy() { if (this.brokenAt !== undefined) throw new HttpError(503, 'AUDIT_CHAIN_BROKEN'); if (this.objects && (!this.anchorChecked || this.anchorFailureMs > 30000)) throw new HttpError(503, 'AUDIT_ANCHOR_UNAVAILABLE'); }
  private get anchorFailureMs() { return this.anchorFailedAt === undefined ? 0 : Date.now() - this.anchorFailedAt; }
  get health() { return { ok: this.brokenAt === undefined, degraded: this.brokenAt !== undefined || this.anchorFailureMs > 5000 || Boolean(this.objects && !this.anchorChecked), anchorSeq: this.anchorSeq, anchoredThrough: this.anchoredThrough, anchorAvailable: this.anchorFailedAt === undefined, anchorFailureMs: this.anchorFailureMs, lastSeq: this.records.length, lastHash: this.records.at(-1)?.hash ?? zeroHash, ...(this.brokenAt !== undefined ? { brokenAt: this.brokenAt } : {}), replicationPending: this.records.length - this.replicatedThrough, replicationLagMs: this.replicationFailedAt ? Date.now() - this.replicationFailedAt : this.records.length > this.replicatedThrough ? Date.now() - this.lastReplication : 0, replicationAvailable: !this.replicationFailedAt }; }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let raw = '';
    try { raw = await readFile(path.join(this.directory, 'audit.jsonl'), 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (raw) {
      try {
        const old = raw.trimEnd().split('\n').map(line => JSON.parse(line));
        if (old.every(record => record.seq === undefined && record.hash === undefined && record.prevHash === undefined)) {
          const digest = sha256(raw);
          await rename(path.join(this.directory, 'audit.jsonl'), path.join(this.directory, `audit.legacy.${digest}.jsonl`));
          this.anchorChecked = !this.objects;
          await this.appendRecord({ action: 'proxy', ts: new Date().toISOString(), user: 'system', projectId: 'system', apiId: 'system', method: 'MIGRATE', path: '/audit', status: 200, maskedFields: [], decision: 'allowed', legacySha256: digest }, true);
        }
      } catch { this.brokenAt = 1; }
    }
    try {
      const inventory: unknown = JSON.parse(await readFile(path.join(this.directory, 'audit-segments.json'), 'utf8'));
      if (!Array.isArray(inventory) || !inventory.every(key => typeof key === 'string' && /^audit\/segments\/[1-9]\d*-[1-9]\d*-[a-f0-9]{64}\.jsonl$/.test(key))) throw new Error('Invalid audit inventory');
      this.replicated = new Set(inventory);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.brokenAt = 1; }
    await this.verify();
    if (this.brokenAt === undefined) await this.anchor().catch(() => {});
    this.timer = setInterval(() => {
      if (this.maintenanceRunning) return;
      this.maintenanceRunning = true;
      void this.anchor().catch(() => {}).then(() => this.flush()).catch(() => {}).finally(() => { this.maintenanceRunning = false; });
    }, Math.min(1000, this.intervalMs)); this.timer.unref();
  }
  close() { if (this.timer) clearInterval(this.timer); }
  append(input: AuditInput) { return this.appendRecord(input); }
  private appendRecord(input: AuditInput, migratingLegacy = false) {
    return this.serial(async () => {
      if (this.brokenAt !== undefined) throw new HttpError(503, 'AUDIT_CHAIN_BROKEN');
      if (!migratingLegacy) this.assertHealthy();
      // Discard caller-provided chain fields, including records copied from a read.
      const { seq: _seq, prevHash: _prev, hash: _hash, ...clean } = input as ChainedAudit;
      const record = { ...clean, seq: this.records.length + 1, prevHash: this.records.at(-1)?.hash ?? zeroHash };
      const chained = { ...record, hash: sha256(canonicalJson(record)) };
      const line = canonicalJson(chained);
      try { await durableWrite(path.join(this.directory, 'audit.jsonl'), line + '\n', true); }
      catch { this.brokenAt = record.seq; throw new HttpError(503, 'AUDIT_CHAIN_BROKEN'); }
      this.records.push(chained); this.lines.push(line);
      if (['download-create', 'download-fetch', 'approval'].includes(input.action)) await this.writeAnchor();
      else if (this.records.length - this.anchorSeq >= 50) await this.writeAnchor().catch(() => {});
      if (this.records.length - this.replicatedThrough >= this.segmentSize) void this.flush(true).catch(() => {});
    });
  }
  async read(projectId: string | undefined, limit: number, subject?: string) {
    await this.queue; this.assertHealthy();
    return this.records.filter(r => (!projectId || r.projectId === projectId) && (!subject || r.user === subject)).slice(-limit);
  }
  verify() { return this.serial(async () => {
    if (this.brokenAt !== undefined) return this.health;
    let raw = '';
    try { raw = await readFile(path.join(this.directory, 'audit.jsonl'), 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { this.brokenAt = 1; return this.health; } }
    const lines = raw ? raw.replace(/\n$/, '').split('\n') : [];
    const verified: ChainedAudit[] = [];
    for (const [index, line] of lines.entries()) {
      try {
        const r = JSON.parse(line) as ChainedAudit, { hash, ...rest } = r;
        if (!raw.endsWith('\n') || r.seq !== index + 1 || r.prevHash !== (verified.at(-1)?.hash ?? zeroHash) || hash !== sha256(canonicalJson(rest))) throw new Error();
        if (r.legacySha256 && sha256(await readFile(path.join(this.directory, `audit.legacy.${r.legacySha256}.jsonl`))) !== r.legacySha256) throw new Error();
        verified.push(r);
      } catch { this.brokenAt = index + 1; return this.health; }
    }
    if (verified.length < this.records.length) { this.brokenAt = verified.length + 1; return this.health; }
    this.records = verified; this.lines = lines;
    if (this.objects) {
      try { await this.checkAnchor(); } catch { this.anchorFailedAt ??= Date.now(); return this.health; }
      if (this.brokenAt !== undefined) return this.health;
      try {
        const remote = await this.objects.list('audit/segments/');
        for (const expected of this.replicated) if (!remote.includes(expected)) { this.brokenAt = Number(expected.split('/').at(-1)!.split('-')[0]); return this.health; }
        for (const key of remote) {
          const m = /^audit\/segments\/(\d+)-(\d+)-([a-f0-9]{64})\.jsonl$/.exec(key);
          if (!m) { this.brokenAt = 1; return this.health; }
          const first = Number(m[1]), last = Number(m[2]);
          if (first < 1 || last < first || last > verified.length || verified[last - 1]?.hash !== m[3] || !(await this.objects.get(key)).equals(Buffer.from(lines.slice(first - 1, last).join('\n') + '\n'))) { this.brokenAt = first; return this.health; }
          this.replicated.add(key);
        }
        const spans = [...this.replicated].map(key => key.split('/').at(-1)!.split('-').slice(0, 2).map(Number)).sort((a, b) => a[0] - b[0]);
        this.replicatedThrough = 0;
        for (const [first, last] of spans) { if (first > this.replicatedThrough + 1) { this.brokenAt = this.replicatedThrough + 1; return this.health; } this.replicatedThrough = Math.max(this.replicatedThrough, last); }
        this.replicationFailedAt = undefined;
      } catch { this.replicationFailedAt ??= Date.now(); }
    }
    return this.health;
  }); }
  // StartAfter + MaxKeys bounds each response to one key. Exponential search then
  // binary search finds the greatest sequence in O(log seq), with no mutable pointer.
  private async checkAnchor() {
    if (!this.objects) return;
    const prefix = 'audit/anchors/';
    const probe = async (after: number) => {
      const keys = await this.objects!.list(prefix, { startAfter: prefix + String(after).padStart(20, '0') + '~', maxKeys: 1 });
      if (!keys.length) return undefined;
      const match = /^audit\/anchors\/(\d{20})-([a-f0-9]{64})$/.exec(keys[0]);
      if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) { this.brokenAt = 1; throw new Error('Invalid anchor'); }
      return { seq: Number(match[1]), hash: match[2], key: keys[0] };
    };
    let latest = await probe(0);
    if (latest) {
      let upper = Math.min(Number.MAX_SAFE_INTEGER, Math.max(2, latest.seq * 2));
      while (true) {
        const found = await probe(upper);
        if (!found) break;
        latest = found;
        upper = Math.min(Number.MAX_SAFE_INTEGER, latest.seq * 2);
      }
      let lower = latest.seq;
      while (lower < upper) {
        const mid = lower + Math.ceil((upper - lower) / 2);
        const found = await probe(mid - 1);
        if (found) { latest = found; lower = found.seq; } else upper = mid - 1;
      }
      const previousAnchorSeq = this.anchorSeq; this.anchorSeq = latest.seq;
      const sameSeq = await this.objects.list(prefix + String(latest.seq).padStart(20, '0') + '-', { maxKeys: 2 });
      const expected = Buffer.from(canonicalJson({ seq: latest.seq, hash: latest.hash }) + '\n');
      if (sameSeq.length !== 1 || !(await this.objects.get(latest.key)).equals(expected)) { this.brokenAt = latest.seq; return; }
      if (latest.seq < previousAnchorSeq || this.records[latest.seq - 1]?.hash !== latest.hash) { this.brokenAt = Math.min(latest.seq, this.records.length + 1); return; }
      this.anchoredThrough = latest.seq;
    } else if (this.anchorSeq) { this.brokenAt = this.anchorSeq; return; }
    this.anchorChecked = true;
  }
  private async writeAnchor() {
    if (!this.objects || this.brokenAt !== undefined) return;
    try {
      if (!this.anchorChecked) await this.checkAnchor();
      if (this.brokenAt !== undefined) throw new HttpError(503, 'AUDIT_CHAIN_BROKEN');
      const seq = this.records.length, hash = this.records.at(-1)?.hash ?? zeroHash;
      if (seq > this.anchorSeq) {
        const key = `audit/anchors/${String(seq).padStart(20, '0')}-${hash}`;
        const data = Buffer.from(canonicalJson({ seq, hash }) + '\n');
        try { await this.objects.put(key, data); }
        catch { if (!(await this.objects.get(key)).equals(data)) { this.brokenAt = seq; throw new HttpError(503, 'AUDIT_CHAIN_BROKEN'); } }
        this.anchorSeq = seq; this.anchoredThrough = seq;
      }
      // An outage with no new records still needs a storage round trip to recover.
      else if (this.anchorFailedAt !== undefined) await this.checkAnchor();
      this.anchorFailedAt = undefined;
    } catch (error) {
      this.anchorFailedAt ??= Date.now();
      throw error instanceof HttpError ? error : new HttpError(503, 'AUDIT_ANCHOR_UNAVAILABLE');
    }
  }
  anchor() { return this.serial(() => this.writeAnchor()); }
  async shutdown() {
    this.close();
    let anchorError: unknown;
    try { await this.anchor(); } catch (error) { anchorError = error; }
    do { const before = this.replicatedThrough; await this.flush(true); if (this.replicatedThrough === before && this.records.length > before && this.objects) throw new Error('Audit segment flush failed'); }
    while (this.objects && this.replicatedThrough < this.records.length);
    if (anchorError) throw anchorError;
  }
  flush(force = false) { return this.serial(async () => {
    if (this.brokenAt !== undefined) throw new HttpError(503, 'AUDIT_CHAIN_BROKEN');
    if (!this.objects || this.records.length === this.replicatedThrough || (!force && this.records.length - this.replicatedThrough < this.segmentSize && Date.now() - this.lastReplication < this.intervalMs)) return;
    const first = this.replicatedThrough + 1, last = Math.min(this.records.length, this.replicatedThrough + this.segmentSize);
    const key = `audit/segments/${first}-${last}-${this.records[last - 1].hash}.jsonl`;
    const data = Buffer.from(this.lines.slice(first - 1, last).join('\n') + '\n');
    try {
      try { await this.objects.put(key, data); }
      catch { const existing = await this.objects.get(key); if (!existing.equals(data)) { this.brokenAt = first; throw new Error(); } }
      this.replicated.add(key);
      await durableWrite(path.join(this.directory, 'audit-segments.json.tmp'), JSON.stringify([...this.replicated]));
      await rename(path.join(this.directory, 'audit-segments.json.tmp'), path.join(this.directory, 'audit-segments.json'));
      this.replicatedThrough = last; this.lastReplication = Date.now(); this.replicationFailedAt = undefined;
    } catch { this.replicationFailedAt ??= Date.now(); }
  }); }
}
