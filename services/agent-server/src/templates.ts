import type { VfsFiles } from '../../../contracts/src/runtime.ts';
import type { PackageSetRequest } from '../../../contracts/src/package-set.ts';
export const defaultPackageSet: PackageSetRequest = {
  entries: ['react', 'react-dom/client', 'react/jsx-runtime', '@tanstack/react-query', '@toi/tds', '@toi/fetch'],
  dependencies: { react: '19.3.0', 'react-dom': '19.3.0', '@tanstack/react-query': '^5.0.0', '@toi/tds': '1.0.0', '@toi/fetch': '1.1.1' }
};
export function templateFiles(apiId = 'customers'): VfsFiles {
  return {
    '/src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
    '/src/App.tsx': "export default function App() { return <main><h1>새 어드민</h1><p>채팅으로 화면을 만들어 보세요.</p></main>; }\n",
    '/src/api.ts': `import { configureToiFetch, toiFetch } from '@toi/fetch';
// The trusted preview host provides credential-free broker routing.
type HostConfig = Parameters<typeof configureToiFetch>[0];
const hostConfig = (globalThis as typeof globalThis & { __TOI_FETCH_CONFIG__?: HostConfig }).__TOI_FETCH_CONFIG__;
if (!hostConfig) throw new Error('Preview host configuration missing: __TOI_FETCH_CONFIG__');
configureToiFetch(hostConfig);
export async function listRecords(reason: string) {
  const response = await toiFetch(${JSON.stringify(apiId)}, '/customers', { reason });
  return response.json();
}
export async function getRecord(id: string, reason: string) {
  const response = await toiFetch(${JSON.stringify(apiId)}, '/customers/' + encodeURIComponent(id), { reason });
  return response.json();
}
export async function updateStatus(id: string, status: 'active' | 'inactive' | 'suspended', reason: string) {
  const response = await toiFetch(${JSON.stringify(apiId)}, '/customers/' + encodeURIComponent(id), {
    method: 'PATCH', reason, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
  });
  return response.json();
}
`

  };
}
export function mockFiles(prompt: string, defaultReason: string): VfsFiles {
  const detail = prompt.includes('상세');
  const write = prompt.includes('상태 변경');
  const title = write ? '고객 상태 변경' : detail ? '고객 상세' : '고객 목록';
  return { '/src/App.tsx': `import { useRef, useState } from 'react';
import { Button, TextField, Table } from '@toi/tds';
import { ToiAccessRevokedError, ToiFetchError, ToiForbiddenError, ToiReasonRequiredError } from '@toi/fetch';
import { listRecords, getRecord, updateStatus } from './api';
function errorMessage(error: unknown, writing = false) {
  const status = error instanceof ToiFetchError ? error.status : undefined;
  if (error instanceof ToiAccessRevokedError || (error instanceof ToiFetchError && error.code === 'PROJECT_NOT_FOUND')) return '이 프로젝트에 접근할 수 없어요. 멤버에서 제거되었거나 권한이 바뀌었을 수 있어요';
  if (error instanceof ToiReasonRequiredError || status === 428) return '조회 사유를 5자 이상 입력하세요.';
  if (error instanceof ToiForbiddenError || status === 403) return writing
    ? '쓰기 권한이 없거나 허용 시간이 끝났어요. 스튜디오에서 쓰기 테스트를 다시 허용하세요.'
    : '조회 권한이 없어요. 스튜디오에서 접근 권한을 확인하세요.';
  if (status !== undefined && status >= 500) return '고객 시스템이 응답하지 않아요. 잠시 후 다시 시도하세요.';
  if (error instanceof TypeError) return '정책 서버에 연결하지 못했어요. 잠시 후 다시 시도하세요.';
  return writing ? '상태를 바꾸지 못했어요. 잠시 후 다시 시도하세요.' : '고객을 조회하지 못했어요. 잠시 후 다시 시도하세요.';
}
export default function App() {
  const [reason, setReason] = useState(${JSON.stringify(defaultReason)});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [customerId, setCustomerId] = useState('C001');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queryState, setQueryState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [writing, setWriting] = useState(false);
  const queryPending = useRef(false);
  const writePending = useRef(false);
  async function suspend() {
    if (writePending.current || queryPending.current) return;
    writePending.current = true; setWriting(true);
    try { await updateStatus(customerId, 'suspended', reason); setNotice('상태를 정지로 바꿨어요.'); setError(''); await load(); }
    catch (e) { setNotice(''); setError(errorMessage(e, true)); }
    finally { writePending.current = false; setWriting(false); }
  }
  async function load() {
    if (queryPending.current) return;
    if (reason.trim().length < 5) { setError('조회 사유를 5자 이상 입력하세요.'); setQueryState('error'); return; }
    queryPending.current = true; setQueryState('loading'); setError('');
    try {
      const data = await ${detail ? 'getRecord(customerId, reason)' : 'listRecords(reason)'};
      setRows(data == null ? [] : Array.isArray(data.items) ? data.items : [data]); setQueryState('success');
    } catch (e) {
      if (e instanceof ToiFetchError && e.status === 404 && e.code !== 'PROJECT_NOT_FOUND') { setRows([]); setQueryState('success'); }
      else { setError(errorMessage(e)); setQueryState('error'); }
    } finally { queryPending.current = false; }
  }
  return <main><h1>${title}</h1><TextField label="조회 사유" value={reason} onChange={e => setReason(e.target.value)} />
    <Button onClick={load} disabled={queryState === 'loading' || writing}>{queryState === 'loading' ? '조회 중…' : '조회'}</Button><p role="alert">{error}</p>
    ${detail || write ? '<TextField label="고객 ID" value={customerId} onChange={e => setCustomerId(e.target.value)} />' : ''}
    ${write ? '<Button onClick={suspend} disabled={writing || queryState === \'loading\'}>고객 상태를 정지로 변경</Button>' : ''}
    <div role="status"><p>{notice}</p>
      {queryState === 'idle' ? <p>조회 사유를 입력하고 조회를 눌러 주세요</p> : null}
      {queryState === 'loading' ? <p>조회 중…</p> : null}
      {queryState === 'success' && rows.length === 0 ? <p>조건에 맞는 고객이 없어요</p> : null}
    </div>
    {queryState === 'success' && rows.length > 0 ?
      <Table columns={[{key:'id',header:'ID'},{key:'name',header:'이름'},{key:'phone',header:'휴대폰'},{key:'status',header:'상태'}]} rows={rows} rowKey="id" /> : null}</main>;
}
` };
}
