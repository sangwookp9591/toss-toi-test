import type { VfsFiles } from '../../../contracts/src/runtime.ts';
import type { PackageSetRequest } from '../../../contracts/src/package-set.ts';
export const defaultPackageSet: PackageSetRequest = {
  entries: ['react', 'react-dom/client', 'react/jsx-runtime', '@tanstack/react-query', '@toi/tds', '@toi/fetch'],
  dependencies: { react: '19.3.0', 'react-dom': '19.3.0', '@tanstack/react-query': '^5.0.0', '@toi/tds': '1.0.0', '@toi/fetch': '1.0.0' }
};
export function templateFiles(apiId = 'customers'): VfsFiles {
  return {
    '/src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
    '/src/App.tsx': "export default function App() { return <main><h1>새 어드민</h1><p>채팅으로 화면을 만들어 보세요.</p></main>; }\n",
    '/src/api.ts': `import { configureToiFetch, toiFetch } from '@toi/fetch';
// The trusted preview host injects runtime credentials; generated code never mints them.
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
`

  };
}
export function mockFiles(prompt: string, defaultReason: string): VfsFiles {
  const detail = prompt.includes('상세');
  const write = prompt.includes('상태 변경');
  const title = write ? '고객 상태 변경' : detail ? '고객 상세' : '고객 목록';
  return { '/src/App.tsx': `import { useState } from 'react';
import { Button, TextField, Table } from '@toi/tds';
import { listRecords, getRecord } from './api';
export default function App() {
  const [reason, setReason] = useState(${JSON.stringify(defaultReason)});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [customerId, setCustomerId] = useState('1');
  const [error, setError] = useState('');
  async function load() {
    if (reason.trim().length < 5) { setError('조회 사유를 5자 이상 입력하세요.'); return; }
    try { const data = await ${detail ? 'getRecord(customerId, reason)' : 'listRecords(reason)'}; setRows(data.items ?? [data]); setError(''); } catch { setError('조회 권한과 연결 상태를 확인하세요.'); }
  }
  return <main><h1>${title}</h1><TextField label="조회 사유" value={reason} onChange={e => setReason(e.target.value)} />
    <Button onClick={load}>조회</Button><p role="alert">{error}</p>
    ${detail ? '<TextField label="고객 ID" value={customerId} onChange={e => setCustomerId(e.target.value)} />' : ''}
    ${write ? '<Button disabled title="서버가 발급한 쓰기 capability가 필요합니다.">상태 변경 권한 필요</Button>' : ''}
    <Table columns={[{key:'id',header:'ID'},{key:'name',header:'이름'},{key:'status',header:'상태'}]} rows={rows} rowKey="id" /></main>;
}
` };
}
