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
export function maskJson(input: unknown, rules: Record<string, MaskKind>): { value: unknown; maskedFields: string[] } {
  const value = structuredClone(input), fields = new Set<string>();
  for (const [pattern, kind] of Object.entries(rules)) {
    if (kind === 'none') continue;
    const segments = pattern.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    const walk = (node: unknown, index: number, pointer: string) => {
      if (!node || typeof node !== 'object') return;
      const segment = segments[index];
      const keys = segment === '*' ? (Array.isArray(node) ? Object.keys(node) : []) : [segment];
      for (const key of keys) {
        if (!Object.hasOwn(node, key)) continue;
        const object = node as Record<string, unknown>, next = `${pointer}/${escape(key)}`;
        if (index === segments.length - 1) {
          if (object[key] !== null && ['string', 'number'].includes(typeof object[key])) { object[key] = maskValue(String(object[key]), kind); fields.add(next); }
        } else walk(object[key], index + 1, next);
      }
    };
    walk(value, 0, '');
  }
  return { value, maskedFields: [...fields].sort() };
}
