import { useEffect, useRef, useState } from 'react';
import { API, authenticatedFetch, json } from './api.ts';
import type { DownloadFormat, DownloadTicket } from '../../../contracts/src/policy.ts';
export function DownloadPanel({ projectId, apiIds, disabled }: { projectId: string; apiIds: string[]; disabled: boolean }) {
  const [format, setFormat] = useState<DownloadFormat>('csv');
  const [apiId, setApiId] = useState(apiIds[0] ?? '');
  const [path, setPath] = useState('/customers');
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState<DownloadTicket>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  useEffect(() => () => { active.current = false; }, []);
  async function create() {
    setBusy(true); setNotice('');
    try {
      const capability = await json<{ token: string }>(API.policy + '/capabilities', { projectId, mode: 'read', env: 'preview', ttlSec: 120 });
      const response = await authenticatedFetch(API.policy + '/downloads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toi-Project': projectId, 'X-Toi-Capability': capability.token }, body: JSON.stringify({ projectId, apiId, path, format, reason }) });
      if (!response.ok) throw new Error();
      const result: DownloadTicket = await response.json(); if (active.current) setTicket(result);
    } catch { if (active.current) setNotice('다운로드를 준비하지 못했어요. 권한과 조회 경로를 확인해 주세요.'); }
    finally { if (active.current) setBusy(false); }
  }
  async function save() {
    if (!ticket) return;
    setBusy(true); setNotice('');
    try {
      const response = await authenticatedFetch(new URL(ticket.url, API.policy).href);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (!active.current) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'download.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('ZIP을 저장했어요. 복사한 비밀번호로 열어 주세요.');
    } catch { if (active.current) setNotice('링크가 만료되었거나 이미 사용됐어요. 새 다운로드를 만들어 주세요.'); }
    finally { if (active.current) setBusy(false); }
  }
  return <details className="access-panel" onToggle={event => { if (!event.currentTarget.open) setTicket(undefined); }}><summary>암호화 다운로드</summary>
    {ticket ? <div role="dialog" aria-label="다운로드 비밀번호">
      <p>비밀번호는 이번에만 표시돼요. 닫으면 다시 볼 수 없어요.</p>
      <output aria-label="ZIP 비밀번호" style={{ overflowWrap: 'anywhere' }}>{ticket.zipPassword}</output>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(ticket.zipPassword); setNotice('비밀번호를 복사했어요.'); } catch { setNotice('복사하지 못했어요. 비밀번호를 직접 선택해 주세요.'); } }}>비밀번호 복사</button>
      <p>{ticket.rowCount}행 · 링크는 60초 동안 한 번 사용할 수 있어요.</p>
      <button type="button" disabled={busy} onClick={() => void save()}>ZIP 저장</button>
      <button type="button" disabled={busy} onClick={() => { setTicket(undefined); setNotice(''); }}>비밀번호 닫기</button>
    </div> : <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <label>다운로드 API<select aria-label="다운로드 API" value={apiId} onChange={event => setApiId(event.target.value)}>{apiIds.map(id => <option key={id}>{id}</option>)}</select></label>
      <label>조회 경로<input aria-label="다운로드 조회 경로" value={path} onChange={event => setPath(event.target.value)} required/></label>
      <label>파일 형식<select aria-label="다운로드 형식" value={format} onChange={event => setFormat(event.target.value as DownloadFormat)}><option value="csv">CSV</option><option value="xlsx">XLSX</option></select></label>
      <label>다운로드 사유<input aria-label="다운로드 사유" value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={500} required/></label>
      <button disabled={disabled || busy || reason.trim().length < 5 || !apiId}>{busy ? '준비 중…' : '암호화 파일 만들기'}</button>
    </form>}
    {notice ? <p role="status">{notice}</p> : null}
  </details>;
}
