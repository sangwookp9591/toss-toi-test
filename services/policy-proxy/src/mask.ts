import type { MaskKind } from '../../../contracts/src/policy.js';
export function maskValue(value: string, kind: MaskKind): string {
  if (kind === 'none') return value;
  if (kind === 'name') { const chars = [...value]; return chars.length < 2 ? '*' : chars.length === 2 ? chars[0] + '*' : chars[0] + '*'.repeat(chars.length - 2) + chars.at(-1); }
  if (kind === 'phone') { const digits = value.replace(/\D/g, ''); return digits.length >= 10 ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : '*'.repeat(value.length); }
  if (kind === 'email') { const index = value.lastIndexOf('@'); return index > 0 ? `${value.slice(0, Math.min(2, Math.max(0, index - 1)))}***${value.slice(index)}` : '***'; }
  if (kind === 'rrn') { const digits = value.replace(/\D/g, ''); return digits.length >= 6 ? `${digits.slice(0, 6)}-*******` : '*******'; }
  return `****-****-${value.replace(/\D/g, '').slice(-4)}`;
}
const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
export type PolicyWarning = 'unregistered_pii_field' | 'mask_rules_unmatched';
// Conservative Korean PII patterns. Boundaries exclude already-masked fragments.
const detectors: [MaskKind, RegExp][] = [
  ['email', /(?<![\w.*+-])[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}(?![\w*])/gi],
  ['rrn', /(?<![\d*])\d{6}-?[1-8]\d{6}(?![\d*])/g],
  ['phone', /(?<![\d*])(?:\+82[- .]?10|01[016789])[- .]?\d{3,4}[- .]?\d{4}(?![\d*])/g],
  ['account', /(?<![\d*])(?:\d{2,6}-\d{2,6}-\d{2,6}(?:-\d{1,6})?|\d{10,16})(?![\d*])/g],
];
export function scanPii(input: unknown): { value: unknown; maskedFields: string[] } {
  const fields = new Set<string>();
  const walk = (node: unknown, pointer: string): unknown => {
    if (typeof node === 'string') {
      let value = node;
      for (const [kind, pattern] of detectors) value = value.replace(pattern, match => { fields.add(`${pointer || '/'} (detected)`); return maskValue(match, kind); });
      return value;
    }
    if (Array.isArray(node)) return node.map((child, index) => walk(child, `${pointer}/${index}`));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child, `${pointer}/${escape(key)}`)]));
    return node;
  };
  return { value: walk(input, ''), maskedFields: [...fields].sort() };
}
export function maskJson(input: unknown, rules: Record<string, MaskKind>): { value: unknown; maskedFields: string[]; policyWarnings: PolicyWarning[] } {
  const value = structuredClone(input), fields = new Set<string>();
  let matched = false;
  for (const [pattern, kind] of Object.entries(rules)) {
    const segments = pattern.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    const maskTree = (node: unknown, pointer: string): unknown => {
      if (kind === 'none') return node;
      if (node !== null && ['string', 'number'].includes(typeof node)) { fields.add(pointer); return maskValue(String(node), kind); }
      if (Array.isArray(node)) return node.map((child, index) => maskTree(child, `${pointer}/${index}`));
      if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, maskTree(child, `${pointer}/${escape(key)}`)]));
      return node;
    };
    const walk = (node: unknown, index: number, pointer: string) => {
      if (!node || typeof node !== 'object') return;
      const segment = segments[index];
      const keys = segment === '*' ? (Array.isArray(node) ? Object.keys(node) : []) : Object.keys(node).filter(key => key.toLowerCase() === segment.toLowerCase());
      for (const key of keys) {
        const object = node as Record<string, unknown>, next = `${pointer}/${escape(key)}`;
        if (index === segments.length - 1) { matched = true; object[key] = maskTree(object[key], next); }
        else walk(object[key], index + 1, next);
      }
    };
    walk(value, 0, '');
  }
  const detected = scanPii(value), policyWarnings: PolicyWarning[] = [];
  if (detected.maskedFields.length) policyWarnings.push('unregistered_pii_field');
  if (Object.keys(rules).length && !matched) policyWarnings.push('mask_rules_unmatched');
  return { value: detected.value, maskedFields: [...new Set([...fields, ...detected.maskedFields])].sort(), policyWarnings };
}
