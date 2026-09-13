import { useState } from 'react';
import type { StudioController, StudioState } from './controller.ts';
import type { AuthState } from './auth.ts';
import type { ProjectRole } from '../../../contracts/src/auth.ts';
const roleLabels = { owner: '소유자', editor: '편집자', viewer: '조회자' };
const statusLabels = { pending: '승인 대기', approved: '승인됨', rejected: '거절됨', expired: '만료됨' };
export function AccessPanel({ controller, state, identity }: { controller: StudioController; state: StudioState; identity: AuthState }) {
  const [username, setUsername] = useState(''); const [role, setRole] = useState<ProjectRole>('viewer');
  const [projectId, setProjectId] = useState(''); const [reason, setReason] = useState(''); const [apiId, setApiId] = useState('customers');
  const owner = state.membership?.members.some(member => member.sub === identity.sub && member.role === 'owner');
  const approver = identity.roles.includes('api-owner');
  return <details className="access-panel"><summary onClick={() => { void controller.loadMembership(); void controller.loadApprovals(); }}>멤버 · live 쓰기 승인</summary>
    <div className="access-content">
      {state.accessNotice ? <p role="alert">{state.accessNotice}</p> : null}
      {state.project ? <section><h3>프로젝트 멤버</h3><button className="quiet" onClick={() => void controller.loadMembership()}>멤버 새로고침</button>
        <ul>{state.membership?.members.map(member => <li key={member.sub}><span>{member.username}</span>
          {owner ? <><select aria-label={`${member.username} 역할`} value={member.role} onChange={e => void controller.changeMember(member.sub, e.target.value as ProjectRole)}>{Object.entries(roleLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><button className="quiet" onClick={() => void controller.changeMember(member.sub)}>제거</button></> : <span>{roleLabels[member.role]}</span>}
        </li>)}</ul>
        {owner ? <form onSubmit={e => { e.preventDefault(); void controller.addMember(username, role); }}><label>사용자 이름<input aria-label="추가할 사용자 이름" value={username} onChange={e => setUsername(e.target.value)}/></label><label>역할<select aria-label="추가할 멤버 역할" value={role} onChange={e => setRole(e.target.value as ProjectRole)}>{Object.entries(roleLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><button disabled={!username.trim()}>멤버 추가</button></form> : <p>멤버 관리는 프로젝트 소유자만 할 수 있어요.</p>}
      </section> : null}
      <section><h3>live 쓰기 승인</h3><p>실제 데이터 쓰기는 프로젝트 소유자의 요청과 다른 API 소유자의 승인이 필요해요.</p>
        {owner ? <form onSubmit={e => { e.preventDefault(); void controller.requestApproval(apiId, reason); }}><label>API<select aria-label="승인 API" value={apiId} onChange={e => setApiId(e.target.value)}>{state.project?.apiIds.map(id => <option key={id}>{id}</option>)}</select></label><label>승인 요청 사유<input aria-label="승인 요청 사유" value={reason} onChange={e => setReason(e.target.value)}/></label><button disabled={reason.trim().length < 5}>live 쓰기 승인 요청</button></form> : null}
        {approver ? <form onSubmit={e => { e.preventDefault(); void controller.loadApprovals(projectId); }}><label>승인할 프로젝트 ID<input aria-label="승인할 프로젝트 ID" value={projectId} onChange={e => setProjectId(e.target.value)}/></label><button disabled={!projectId.trim()}>승인 요청 조회</button></form> : null}
        {state.project ? <button className="quiet" onClick={() => void controller.loadApprovals()}>승인 상태 새로고침</button> : null}
        <ul>{state.approvals.map(approval => <li className="approval-row" key={approval.approvalId}><strong>{approval.apiId} · {statusLabels[approval.status]}</strong><span>{approval.justification}</span><small>유효 기한 {new Date(approval.expiresAt).toLocaleString()}</small>{approver && approval.status === 'pending' ? <><button disabled={approval.requestedBy === identity.sub} onClick={() => void controller.decideApproval(approval, 'approved')}>승인</button><button disabled={approval.requestedBy === identity.sub} className="quiet" onClick={() => void controller.decideApproval(approval, 'rejected')}>거절</button>{approval.requestedBy === identity.sub ? <span>본인 요청은 승인할 수 없어요.</span> : null}</> : null}</li>)}</ul>
      </section>
    </div>
  </details>;
}
