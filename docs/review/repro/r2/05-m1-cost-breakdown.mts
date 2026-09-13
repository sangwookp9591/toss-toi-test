// R2-M1: 20MB 응답에서 프록시 동기 처리 단계별 비용 (JSON.parse / maskJson(스캔 포함) / sanitize / stringify).
// 실행(루트): node --import ./services/policy-proxy/node_modules/tsx/dist/loader.mjs docs/review/repro/r2/05-m1-cost-breakdown.mts
import { maskJson } from '../../../../services/policy-proxy/src/mask.ts';
import { sanitize } from '../../../../services/policy-proxy/src/storage.ts';
const mask = Object.fromEntries(['name', 'phone', 'email', 'rrn', 'account'].flatMap(f => [[`/${f}`, f], [`/items/*/${f}`, f]])) as Record<string, any>;
const row = (i: number) => ({ id: 'C' + i, name: '홍길동', phone: '010-1234-5678', email: 'user' + i + '@example.com', memo: '메모 ' + 'x'.repeat(80) + ' 연락 010-9876-5432' });
const body = JSON.stringify({ items: Array.from({ length: 100000 }, (_, i) => row(i)) });
const t = (label: string, fn: () => unknown) => { const s = performance.now(); const v = fn(); console.log(label.padEnd(34), Math.round(performance.now() - s) + 'ms'); return v; };
const parsed = t('JSON.parse', () => JSON.parse(body));
const masked = t('maskJson (pointer + residual scan)', () => maskJson(parsed, mask)) as any;
const secrets = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'http://127.0.0.1:7300', '127.0.0.1:7300', 'http://localhost:7300', 'localhost:7300'];
const clean = t('sanitize (7 secrets x 3 repr)', () => sanitize(masked.value, secrets));
t('JSON.stringify', () => JSON.stringify(clean));
