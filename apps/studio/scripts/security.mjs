import { randomBytes } from 'node:crypto';

export const studioOrigin = 'http://localhost:5173';
export const previewHostPattern = /^p-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.preview\.localhost:5174$/;
export const studioHeaders = {
  'Content-Security-Policy': "frame-ancestors 'self'; frame-src http://*.preview.localhost:5174",
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
};
export function previewDocument(template) {
  const nonce = randomBytes(24).toString('base64');
  const csp = ["default-src 'none'", 'connect-src http://localhost:7200',
    `script-src 'self' http://localhost:7100 data: 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'", 'img-src data: blob:', 'font-src data:',
    "form-action 'none'", "base-uri 'none'", `frame-ancestors ${studioOrigin}`,
    "worker-src 'none'", "object-src 'none'"].join('; ');
  return { body: template.replaceAll('__TOI_NONCE__', nonce), headers: {
    'Content-Security-Policy': csp, 'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } };
}
