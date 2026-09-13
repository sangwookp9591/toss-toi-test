import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioController, diagnosticMessage } from './controller.ts';
import './style.css';
import { auth, initializeAuth } from './auth.ts';
import { DownloadPanel } from './download-panel.tsx';
import { AccessPanel } from './access-panel.tsx';
function EditBackups({ backups }: { backups: ReturnType<StudioController['getSnapshot']>['backups'] }) {
  const [copied, setCopied] = useState('');
  if (!backups.length) return null;
  return <details className="edit-backups" open><summary>내 편집 보관본</summary>{backups.map(backup => <div key={backup.id}>
    <small>{new Date(backup.createdAt).toLocaleString()}</small>{Object.entries(backup.files).map(([path, content]) => <details key={path}><summary>{path}</summary>
      <textarea aria-label={`보관본 ${path}`} readOnly value={content}/><button className="quiet" onClick={async () => {
        try { await navigator.clipboard.writeText(content); setCopied(backup.id + path); } catch { setCopied('복사하지 못했어요. 보관본에서 직접 선택해 주세요.'); }
      }}>복사</button>{copied === backup.id + path ? <span>복사했어요</span> : null}
    </details>)}</div>)}{copied.startsWith('복사하지') ? <p>{copied}</p> : null}</details>;
}
function App() {
  const [controller] = useState(() => new StudioController());
  const identity = useSyncExternalStore(auth().subscribe, auth().getSnapshot);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const preview = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('고객 어드민'); const [prompt, setPrompt] = useState(''); const [answer, setAnswer] = useState('');
  const [showAudit, setShowAudit] = useState(false);
  useEffect(() => { Object.assign(window, { studio: controller }); controller.attach(preview.current!); const id = new URLSearchParams(location.search).get('project'); if (id) void controller.open(id); return () => { controller.dispose(); delete (window as any).studio; }; }, [controller]);
  const viewer = state.membership?.members.find(member => member.sub === identity.sub)?.role === 'viewer';
  const send = () => { const text = prompt; setPrompt(''); void controller.generate(text); };
  return <div className="shell">
    <header><div className="brand">toi<span>studio</span></div><span className="divider"/><strong>{state.project?.name ?? '새로운 어드민'}</strong><span className="environment">로컬 실험</span><div className="header-spacer"/><span className="session">{identity.username} · 안전한 프리뷰</span><button className="quiet" onClick={() => void auth().logout()}>로그아웃</button></header>
    {!state.project ? <div className="start-banner"><div><strong>업무에 필요한 화면을 만들어 보세요</strong><p>채팅으로 만들고, 코드를 확인하고, 안전하게 미리 봅니다.</p></div><label>프로젝트 이름<input aria-label="프로젝트 이름" value={name} onChange={e => setName(e.target.value)} /></label><button onClick={() => void controller.open(undefined, name)}>프로젝트 만들기</button></div> : null}
    <AccessPanel controller={controller} state={state} identity={identity}/>
    {state.project ? <DownloadPanel key={state.project.projectId} projectId={state.project.projectId} apiIds={state.project.apiIds} disabled={viewer}/> : null}
    {state.accessNotice ? <p className="access-notice" role="alert">{state.accessNotice}</p> : null}
    {viewer ? <p className="access-notice">조회 권한이에요. 생성·저장·쓰기 테스트는 편집자 이상이 할 수 있어요.</p> : null}
    <main className="workspace">
      <section className="chat-pane"><div className="pane-title"><h2>화면 만들기</h2><span>01</span></div><div className="conversation">
        <div className="assistant welcome"><div className="avatar">✦</div><p>어떤 업무를 도와드릴까요?<br/><span>고객 목록, 상세 조회처럼 필요한 화면을 이야기해 주세요.</span></p></div>
        {state.generationNotice ? <p className="generation-notice" role="note">{state.generationNotice}</p> : null}
        {state.chats.map((message, index) => <div key={index} className={'message ' + message.role}>{message.text || (state.busy ? '생각을 정리하고 있어요…' : '')}</div>)}
        {state.answeredQuestion ? <div className="answered-question" data-state="answered"><strong>{state.answeredQuestion.question}</strong><p>답변이 반영됐어요</p></div> : null}
        {state.question ? <div className="question"><strong>{state.question.question}</strong><div className="answer-options">{state.question.options?.map(option => <button key={option} onClick={() => void controller.answer(option)}>{option}</button>)}</div><div className="free-answer"><input aria-label="추가 답변" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="직접 답변하기"/><button className="quiet" disabled={!answer.trim()} onClick={() => { void controller.answer(answer); setAnswer(''); }}>답변</button></div></div> : null}
      </div><form className="composer" onSubmit={e => { e.preventDefault(); send(); }}><label htmlFor="prompt">만들고 싶은 화면</label><textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="고객 목록 화면 만들어줘" disabled={!state.project || state.busy || viewer}/><div><small>업무 데이터는 정책을 거쳐 보호돼요</small>{state.busy ? <button type="button" className="secondary" onClick={() => void controller.cancel()}>생성 중단</button> : <button disabled={!state.project || !prompt.trim() || viewer}>보내기 ↑</button>}</div></form></section>
      <section className="code-pane"><div className="pane-title"><h2>코드 확인</h2><span>02</span></div><nav className="file-tree" aria-label="파일 목록">{Object.keys(state.files).sort().map(path => <button className={state.selected === path ? 'active' : ''} key={path} onClick={() => controller.select(path)}><span>⌘</span>{path.slice(5)}</button>)}</nav><div className="code-title"><span>{state.selected}</span><small>{state.dirty ? '저장하지 않은 변경' : '저장됨'}</small></div><textarea aria-label="소스 코드" className="source" spellCheck={false} value={state.files[state.selected] ?? ''} onChange={e => controller.edit(e.target.value)} disabled={!state.project || state.busy || viewer}/><div className="code-actions"><span>{state.project ? `저장 버전 ${state.project.revision}` : '프로젝트를 먼저 만들어 주세요'}</span><button disabled={!state.project || !state.dirty || state.saving || state.busy || viewer} onClick={() => void controller.saveFiles()}>{state.saving ? '저장 중…' : '저장하고 반영'}</button></div>{state.conflict ? <div className="conflict" role="alert">다른 탭에서 먼저 저장했어요.<button onClick={() => void controller.reload()}>최신 내용 불러오기</button><span>내 편집은 보관본으로 남겨요</span></div> : null}<EditBackups backups={state.backups}/></section>
      <section className="preview-pane"><div className="pane-title"><h2>미리보기</h2><span>03</span></div><div className="preview-toolbar"><span className="preview-label"><i/> {state.lastCommit ? `버전 ${state.lastCommit.token.revision} 반영됨` : '화면을 기다리고 있어요'}</span><label className="toggle"><input type="checkbox" checked={state.writeAllowed} onChange={e => void controller.setWriteAllowed(e.target.checked)} disabled={!state.project || viewer}/><span>쓰기 테스트 허용</span></label></div><div className="preview-surface"><div id="preview" ref={preview}/>{!state.lastCommit ? <div className="preview-empty"><div>◇</div><h3>{state.previewError ? '화면 준비를 다시 시도해 주세요' : '대화가 화면이 되는 곳'}</h3><p>{state.previewError ?? '정상적으로 실행된 화면만 여기에 반영해요.'}</p></div> : null}{state.previewError ? <div className="preview-retry"><button disabled={state.previewPending} onClick={() => void controller.retryPreview()}>다시 시도</button></div> : null}</div><div className="preview-foot"><span>{state.writeNotice ?? (state.writeAllowed ? (state.writeExpiresAt ? `쓰기 허용 ${Math.floor(state.writeRemaining / 60)}:${String(state.writeRemaining % 60).padStart(2, '0')} 남음` : '쓰기 권한을 준비하고 있어요') : '조회 전용 · 개인정보 마스킹 적용')}</span><button className="quiet" disabled={!state.project} onClick={() => { setShowAudit(!showAudit); void controller.loadAudit(); }}>활동 기록</button></div>{state.diagnostics.length ? <div className="diagnostics" role="alert" aria-label="편집 오류"><strong>편집 오류</strong><ul>{state.diagnostics.slice(0, 5).map((item, index) => <li key={index}>
        {item.file ? <code>{item.file}</code> : null}{item.line !== undefined ? <span> · {item.line}행{item.column !== undefined ? ` ${item.column}열` : ''}</span> : null}<p>{diagnosticMessage(item.message)}</p>
      </li>)}</ul>{state.diagnostics.length > 5 ? <p>외 {state.diagnostics.length - 5}건</p> : null}</div> : null}{showAudit ? <div className="audit"><div><strong>활동 기록</strong><button className="quiet" onClick={() => void controller.loadAudit()}>새로고침</button></div>{state.audit.length ? state.audit.slice(-20).reverse().map((item,index) => <p key={index}>{item.method} · {item.status} · {item.decision === 'allowed' ? '허용' : '차단'}<span>{item.reason ?? '사유 없음'}</span></p>) : <p>아직 요청 기록이 없어요.</p>}</div> : null}</section>
    </main><footer><div className="status" role="status"><span className={state.status.startsWith('이전') || state.conflict ? 'status-dot warning' : 'status-dot'}/>{state.busy ? state.generationStatus ?? state.status : state.status}{state.previewError ? <button disabled={state.previewPending} onClick={() => void controller.retryPreview()}>다시 시도</button> : null}</div><span>{state.lastCommit ? `${Math.round(state.lastCommit.timings.totalMs)}ms · 최근 화면 반영` : '생성한 화면은 마지막 정상 버전을 유지해요'}</span></footer>
  </div>;
}
function AuthGate() {
  const identity = useSyncExternalStore(auth().subscribe, auth().getSnapshot);
  return identity.status === 'authenticated' ? <App key={identity.sub}/> : <main className="login-panel"><h1>TOI Studio</h1><p role="alert">{identity.message ?? '로그인 상태를 확인하고 있어요.'}</p><button onClick={() => void auth().login()}>Keycloak으로 로그인</button></main>;
}
void initializeAuth().then(render => { if (render) createRoot(document.getElementById('root')!).render(<AuthGate/>); });
