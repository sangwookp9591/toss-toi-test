import type { RegisteredApi, MaskKind } from '../../../contracts/src/policy.js';
import type { PolicyConfig } from './config.js';
import { PolicyStorage, validateApi } from './storage.js';
export async function seedRegistry(storage: PolicyStorage, config: PolicyConfig, force = false) {
  if (!force && storage.apis.has('customers')) return;
  const response = await fetch(`${config.upstreamUrl}/openapi.json`, { headers: { 'X-Service-Token': config.upstreamToken }, signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('Could not load customer API schema');
  const fields: Record<string, MaskKind> = { name: 'name', phone: 'phone', email: 'email', rrn: 'rrn', account: 'account' };
  const mask = Object.fromEntries(Object.entries(fields).flatMap(([field, kind]) => [[`/${field}`, kind], [`/items/*/${field}`, kind]]));
  const api: RegisteredApi = { apiId: 'customers', name: '고객 관리', description: '고객 검색·조회·상태 변경과 주문 조회; 민감정보 마스킹 및 조회 사유 필수', upstreamBaseUrl: config.upstreamUrl, openapi: await response.json(), schemaVersion: 1, policy: { mask, requireReason: true, allowedRoles: ['viewer', 'editor'], allowWrite: true } };
  await storage.save(validateApi(api, config.upstreamAllowlist));
}
