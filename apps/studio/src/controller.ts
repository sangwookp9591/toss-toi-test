import { createPreviewRuntime, sourceDigest } from '../../../packages/preview-runtime/src/index.ts';
import { previewOriginForProject } from '../../../contracts/src/runtime.ts';
import type { PreviewRuntime, PreviewEvent, RevisionToken, PreviewHostConfig, Diagnostic } from '../../../contracts/src/runtime.ts';
import type { Project, GenerationEvent, ActiveGeneration } from '../../../contracts/src/generation.ts';
import type { PackageSetStatus, PackageSetRequest, PackageSetFailureCode } from '../../../contracts/src/package-set.ts';
import type { AuditRecord } from '../../../contracts/src/policy.ts';
import type { PreviewSession, ProjectMembership, ProjectRole, Approval } from '../../../contracts/src/auth.ts';
import { previewHostConfig } from './preview-auth.ts';
import { API, json, HttpError, consumeGeneration, isTerminal, accessMessage } from './api.ts';
interface GenerationRecovery {
  generationId: string; seq: number; chats: StudioState['chats'];
  question?: StudioState['question']; answeredQuestion?: StudioState['answeredQuestion']; status: string; files: Record<string, string>;
}
interface EditBackup { id: string; createdAt: string; files: Record<string, string> }
class DependencyError extends Error {}
function dependencyReason(code?: PackageSetFailureCode): string | undefined {
  switch (code) {
    case 'registry_unavailable': return '패키지 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.';
    case 'storage_unavailable': return '구성 요소 저장소에 연결하지 못했어요. 잠시 후 다시 시도하세요.';
    case 'input': return '패키지 또는 버전 확인 필요';
    case 'internal': return '구성 요소 빌드 실패';
  }
}
const generationKey = (id: string) => `toi-studio-generation-v1:${id}`;
const backupKey = (id: string) => `toi-studio-backups-v1:${id}`;
function stored<T>(key: string): T | undefined {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined; } catch { return undefined; }
}
function persist(key: string, value?: unknown) {
  try { if (value === undefined) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { /* A full or disabled session store must not interrupt the live stream. */ }
}
const MAX_BACKUPS = 3;
// Opt-in E2E hook read once at startup, clamped so it can only shorten the production TTL.
const testWriteTtlSec = Number((globalThis as { __STUDIO_TEST_CONFIG__?: { writeTtlSec?: number } }).__STUDIO_TEST_CONFIG__?.writeTtlSec);
const WRITE_TTL_SEC = Number.isInteger(testWriteTtlSec) && testWriteTtlSec > 0 ? Math.min(testWriteTtlSec, 120) : 120;
// Wording defined by preview-runtime (contracts/src/runtime.ts external allowlist rule).
const PACKAGE_DENIED = /package not in package set: (\S+)/;
export function diagnosticMessage(message: string) {
  const match = PACKAGE_DENIED.exec(message);
  return match ? `‘${match[1]}’ 패키지는 이 프로젝트에서 쓸 수 없어요` : message;
}
export interface StudioState {
  membership?: ProjectMembership; approvals: Approval[]; accessNotice?: string;
  project?: Project; files: Record<string, string>; selected: string; dirty: boolean;
  status: string; busy: boolean; saving: boolean; conflict: boolean; writeAllowed: boolean;
  chats: Array<{ role: 'user' | 'assistant'; text: string }>;
  question?: Extract<GenerationEvent, { type: 'question' }>;
  answeredQuestion?: Extract<GenerationEvent, { type: 'question' }>;
  events: PreviewEvent[]; lastCommit?: Extract<PreviewEvent, { type: 'committed' }>;
  generationEvents: GenerationEvent[]; audit: AuditRecord[];
  generationNotice?: string; generationStatus?: string; diagnostics: Diagnostic[]; backups: EditBackup[];
  previewError?: string; previewPending: boolean;
  writeExpiresAt?: number; writeRemaining: number; writeNotice?: string;
}
export class StudioController {
  #state: StudioState = { approvals: [], files: {}, selected: '/src/App.tsx', dirty: false, status: '어떤 화면이 필요한가요?', busy: false, saving: false, conflict: false, writeAllowed: false, chats: [], events: [], generationEvents: [], audit: [], diagnostics: [], backups: [], previewPending: false, writeRemaining: 0 };
  #listeners = new Set<() => void>(); #runtime?: PreviewRuntime;
  #container?: HTMLElement; #runtimeProjectId?: string;
  #openEpoch = 0;
  #intent = 0; #attempt?: RevisionToken; #generationId?: string; #stream?: AbortController;
  #lastSeq = 0; #recovering = false; #writeTimer?: ReturnType<typeof setInterval>; #writeEpoch = 0;
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  private update(change: Partial<StudioState>) { this.#state = { ...this.#state, ...change }; for (const listener of this.#listeners) listener(); }
  attach(container: HTMLElement) {
    this.#container = container;
    if (this.#state.project) void this.preview(this.#state.project);
  }
  private ensureRuntime(projectId: string) {
    const container = this.#container;
    if (!container || this.#runtimeProjectId === projectId) return;
    ++this.#intent; ++this.#writeEpoch; clearInterval(this.#writeTimer);
    this.#runtime?.dispose();
    this.#runtimeProjectId = projectId;
    this.update({ lastCommit: undefined, writeAllowed: false, writeExpiresAt: undefined, writeRemaining: 0, events: [], diagnostics: [] });
    const previewOrigin = previewOriginForProject(projectId);
    this.#runtime = createPreviewRuntime({ container, previewOrigin, frameUrl: previewOrigin + '/frame.html', esbuildWasmUrl: location.origin + '/esbuild.wasm', entry: '/src/main.tsx', bootTimeoutMs: 15000 });
    this.#runtime.on(event => {
      if (event.token.projectId !== this.#runtimeProjectId) return;
      const change: Partial<StudioState> = { events: [...this.#state.events.slice(-49), event] };
      if (event.type === 'committed') { change.lastCommit = event; change.status = '화면에 반영했어요'; change.diagnostics = []; change.previewPending = false; }
      else if (event.token.attemptId === this.#attempt?.attemptId) {
        if (event.type === 'build_started') {
          container.style.setProperty('--preview-width', `${container.clientWidth}px`);
          container.style.setProperty('--preview-height', `${container.clientHeight}px`);
          change.status = '화면을 준비하고 있어요';
        }
        if (event.type === 'build_failed') {
          const total = event.diagnostics.length;
          const packages = event.diagnostics.filter(d => PACKAGE_DENIED.test(d.message)).length;
          const kind = packages && packages === total ? '허용되지 않은 패키지' : '문법 오류';
          const mixed = packages && packages < total ? ' · 허용되지 않은 패키지 포함' : '';
          change.status = `${this.failurePrefix()}: ${kind} ${total}건${mixed}`;
          change.diagnostics = event.diagnostics; change.previewPending = false;
        }
        if (event.type === 'runtime_failed') { change.status = event.error.message.startsWith('CSP_BLOCKED:') ? '차단된 요청: 프리뷰 보안 정책이 요청을 막았어요' : `${this.failurePrefix()}: 실행 중 오류가 발생했어요`; change.diagnostics = [event.error]; change.previewPending = false; }
        if (event.type === 'stale_discarded') change.status = '이전 화면을 유지했어요: 더 최신 요청이 있어요';
      }
      this.update(change);
    });
  }
  private generationProgress(text: string, extra: Partial<StudioState> = {}) { this.update({ ...extra, generationStatus: text, status: text }); }
  private failurePrefix() { return this.#state.lastCommit ? '이전 화면을 유지했어요' : '화면을 처음 준비하지 못했어요'; }
  async open(projectId?: string, name = '고객 어드민') {
    const epoch = ++this.#openEpoch;
    try {
      this.update({ busy: true, status: '프로젝트를 준비하고 있어요' });
      const project = projectId ? await json<Project>(`${API.agent}/projects/${projectId}`) : await json<Project>(API.agent + '/projects', { name, apiIds: ['customers'] });
      const membership = await json<ProjectMembership>(`${API.agent}/projects/${project.projectId}/membership`);
      if (epoch !== this.#openEpoch) return;
      if (this.#state.project?.projectId !== project.projectId) {
        this.#stream?.abort(); this.#generationId = undefined; this.#lastSeq = 0; this.#recovering = false;
        this.update({ chats: [], question: undefined, answeredQuestion: undefined, generationEvents: [], generationNotice: undefined, generationStatus: undefined });
      }
      history.replaceState(null, '', '?project=' + project.projectId);
      this.update({ membership, accessNotice: undefined });
      this.update({ project, files: { ...project.files }, dirty: false, conflict: false, backups: stored<EditBackup[]>(backupKey(project.projectId)) ?? (this.#state.project?.projectId === project.projectId ? this.#state.backups : []) });
      void this.preview(project);
      const active = await this.activeGeneration(project.projectId);
      if (epoch !== this.#openEpoch) return;
      const saved = stored<GenerationRecovery>(generationKey(project.projectId));
      const recovery = saved && this.validRecovery(saved) ? saved : undefined;
      if (active && active.generationId !== this.#generationId) {
        const matches = recovery?.generationId === active.generationId && recovery.seq <= active.lastSeq;
        if (!matches) { this.followActive(active); return; }
      }
      if (!this.#generationId) {
        if (recovery) {
          this.#generationId = recovery.generationId; this.#lastSeq = recovery.seq; this.#recovering = true;
          this.update({ busy: true, chats: recovery.chats, question: recovery.question, answeredQuestion: recovery.answeredQuestion, status: recovery.status, generationStatus: recovery.status, files: recovery.files ?? project.files });
          void this.subscribeGeneration();
        } else this.update({ busy: false });
      }
    } catch (error) { if (epoch !== this.#openEpoch) return; this.update({ busy: false, accessNotice: accessMessage(error, '프로젝트를 열지 못했어요. 서비스 연결을 확인해 주세요.'), status: accessMessage(error, '프로젝트를 열지 못했어요. 서비스 연결을 확인해 주세요.') }); }
  }
  private validRecovery(recovery: GenerationRecovery) {
    return typeof recovery.generationId === 'string' && Number.isSafeInteger(recovery.seq) && recovery.seq >= 0 && Array.isArray(recovery.chats);
  }
  private async activeGeneration(projectId: string): Promise<ActiveGeneration | undefined> {
    try { return await json<ActiveGeneration>(`${API.agent}/projects/${projectId}/generations/active`); }
    catch (error) { if (error instanceof HttpError && error.status === 404) return undefined; throw error; }
  }
  private followActive(active: ActiveGeneration) {
    this.#generationId = active.generationId; this.#lastSeq = 0; this.#recovering = true;
    this.update({ busy: true, question: undefined, answeredQuestion: undefined, chats: [{ role: 'user', text: active.prompt }, { role: 'assistant', text: '' }], generationEvents: [],
      generationNotice: '다른 창에서 진행 중인 요청이 있어요', generationStatus: '진행 중인 요청을 불러오고 있어요' });
    this.saveGeneration();
    void this.subscribeGeneration();
  }
  select(path: string) { this.update({ selected: path }); }
  edit(content: string) { this.update({ files: { ...this.#state.files, [this.#state.selected]: content }, dirty: true }); }
  async saveFiles(files = this.#state.files): Promise<Project | undefined> {
    const current = this.#state.project; if (!current) return;
    this.update({ saving: true, conflict: false });
    try {
      const project = await json<Project>(`${API.agent}/projects/${current.projectId}/source`, { baseRevision: current.revision, files }, 'PUT');
      if (this.#state.project?.projectId !== current.projectId) return;
      this.update({ project, files: { ...project.files }, dirty: false, saving: false });
      void this.preview(project); return project;
    } catch (error) {
      this.update({ saving: false, conflict: error instanceof HttpError && error.status === 409, status: error instanceof HttpError && error.status === 409 ? '다른 탭에서 먼저 저장했어요. 최신 내용을 불러온 뒤 다시 저장해 주세요.' : accessMessage(error, '저장하지 못했어요. 다시 시도해 주세요.') });
    }
  }
  async reload() {
    if (!this.#state.project) return;
    if (this.#state.dirty) {
      const backups = [...this.#state.backups.slice(-(MAX_BACKUPS - 1)), { id: crypto.randomUUID(), createdAt: new Date().toISOString(), files: { ...this.#state.files } }];
      persist(backupKey(this.#state.project.projectId), backups); this.update({ backups });
    }
    await this.open(this.#state.project.projectId);
  }
  private saveGeneration() {
    if (!this.#generationId || !this.#state.project) return;
    const recovery: GenerationRecovery = { generationId: this.#generationId, seq: this.#lastSeq, chats: this.#state.chats, question: this.#state.question, answeredQuestion: this.#state.answeredQuestion, status: this.#state.generationStatus ?? this.#state.status, files: this.#state.files };
    persist(generationKey(this.#state.project.projectId), recovery);
  }
  private finishGeneration(result: string) {
    if (this.#state.project) persist(generationKey(this.#state.project.projectId));
    this.#generationId = undefined;
    this.update({ busy: false, question: undefined, generationStatus: undefined, ...(this.#recovering ? { generationNotice: `진행 중이던 생성이 끝났어요: ${result}` } : {}) });
    this.#recovering = false;
  }
  private async subscribeGeneration() {
    if (!this.#generationId) return;
    this.#stream?.abort(); const stream = new AbortController(); this.#stream = stream;
    try {
      await consumeGeneration(this.#generationId, stream.signal, event => this.handleGeneration(event), () => this.generationProgress('연결이 끊겨 다시 연결하고 있어요'), this.#lastSeq);
    } catch (error) {
      if (stream.signal.aborted) return;
      if (error instanceof HttpError && error.status === 404) this.finishGeneration('기록을 찾을 수 없어요');
      else this.update({ busy: false, status: accessMessage(error, '생성 연결을 복구하지 못했어요. 다시 열어 주세요.') });
    }
  }
  async generate(prompt: string) {
    const project = this.#state.project; if (!project || this.#state.busy || !prompt.trim()) return;
    this.update({ busy: true });
    try {
      // Recheck at send time: a tab opened earlier may have started a generation meanwhile.
      const active = await this.activeGeneration(project.projectId);
      if (active) { this.followActive(active); return; }
      this.generationProgress('화면을 만들고 있어요', { question: undefined, answeredQuestion: undefined, generationNotice: undefined, chats: [...this.#state.chats, { role: 'user', text: prompt }, { role: 'assistant', text: '' }] });
      const { generationId } = await json<{ generationId: string }>(API.agent + '/generations', { projectId: project.projectId, baseRevision: project.revision, prompt, requestId: crypto.randomUUID() });
      this.#generationId = generationId; this.#lastSeq = 0; this.#recovering = false; this.saveGeneration();
      await this.subscribeGeneration();
    } catch (error) { this.update({ busy: false, status: accessMessage(error, '화면 생성을 시작하지 못했어요. 다시 시도해 주세요.') }); }
  }
  private handleGeneration(event: GenerationEvent) {
    this.update({ generationEvents: [...this.#state.generationEvents, event] });
    this.#lastSeq = event.seq;
    if (event.type === 'state') {
      if (event.state === 'staging') this.generationProgress('화면을 만들고 있어요', { answeredQuestion: this.#state.question ?? this.#state.answeredQuestion, question: undefined });
      else if (event.state === 'awaiting_answer') this.generationProgress('한 가지만 더 알려 주세요');
    } else if (event.type === 'text') {
      const chats = [...this.#state.chats]; const last = chats.at(-1);
      if (last?.role === 'assistant') chats[chats.length - 1] = { ...last, text: last.text + event.delta };
      this.update({ chats });
    } else if (event.type === 'question') this.generationProgress('한 가지만 더 알려 주세요', { question: event });
    else if (event.type === 'file') this.update({ files: { ...this.#state.files, [event.path]: event.content } });
    else if (event.type === 'file_deleted') { const files = { ...this.#state.files }; delete files[event.path]; this.update({ files }); }
    else if (event.type === 'revision_ready') {
      const project = { ...this.#state.project!, files: event.files, packageSet: event.packageSet, revision: event.revision };
      this.update({ project, files: event.files, dirty: false, question: undefined }); void this.preview(project);
    } else if (event.type === 'done') this.update({ busy: false, question: undefined });
    else if (event.type === 'canceled') this.update({ busy: false, question: undefined, status: '생성을 중단했어요. 이전 화면은 그대로예요.' });
    else if (event.type === 'failed') this.update({ busy: false, question: undefined, status: event.code === 'conflict' ? '생성 중 다른 변경이 저장됐어요. 최신 내용을 불러와 주세요.' : '화면을 만들지 못했어요. 이전 화면을 유지했어요.', conflict: event.code === 'conflict' });
    if (isTerminal(event)) this.finishGeneration(event.type === 'done' ? '완료' : event.type === 'canceled' ? '중단' : '실패');
    // Text deltas are not checkpointed: resuming from the last checkpoint seq replays them.
    else if (event.type !== 'text') this.saveGeneration();
  }
  async answer(answer: string) {
    if (!this.#generationId || !this.#state.question || !answer.trim()) return;
    try { await json(`${API.agent}/generations/${this.#generationId}/answers`, { questionId: this.#state.question.questionId, answer });
    // The staging SSE event acknowledges the answer in every observing tab.
    this.saveGeneration();
    } catch (error) { this.update({ status: accessMessage(error, '답변을 보내지 못했어요. 다시 시도해 주세요.') }); }
  }
  async cancel() {
    ++this.#intent; if (this.#attempt) this.#runtime?.cancel(this.#attempt);
    try { if (this.#generationId) await json(`${API.agent}/generations/${this.#generationId}/cancel`, {}, 'POST'); }
    catch (error) { this.update({ status: accessMessage(error, '중단 요청을 보내지 못했어요. 다시 시도해 주세요.') }); }
  }
  async setWriteAllowed(allowed: boolean) {
    ++this.#writeEpoch; clearInterval(this.#writeTimer);
    this.update({ writeAllowed: allowed, writeExpiresAt: undefined, writeRemaining: 0, writeNotice: undefined });
    if (this.#state.project) await this.preview(this.#state.project);
  }
  private async capability(project: Project): Promise<PreviewHostConfig> {
    const write = this.#state.writeAllowed; const epoch = this.#writeEpoch;
    const session = await json<PreviewSession>(API.policy + '/preview-sessions', { projectId: project.projectId, ...(write ? { write: { apiIds: project.apiIds, ttlSec: WRITE_TTL_SEC } } : {}) });
    if (write && this.#state.project?.projectId === project.projectId && this.#state.writeAllowed && epoch === this.#writeEpoch) {
      const expiresAt = session.capability.exp * 1000;
      clearInterval(this.#writeTimer);
      const tick = () => {
        const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        if (this.#state.writeExpiresAt !== expiresAt || this.#state.writeRemaining !== remaining) this.update({ writeExpiresAt: expiresAt, writeRemaining: remaining });
        if (!remaining) {
          clearInterval(this.#writeTimer); ++this.#writeEpoch;
          this.update({ writeAllowed: false, writeNotice: '쓰기 허용 시간이 끝났어요. 다시 켜면 2분 동안 허용돼요.' });
          if (this.#state.project) void this.preview(this.#state.project);
        }
      };
      this.#writeTimer = setInterval(tick, 1000); tick();
    }
    return previewHostConfig(session, project.projectId, API.policy);
  }
  async retryPreview() { if (this.#state.project && !this.#state.previewPending) await this.preview(this.#state.project); }
  async preview(project: Project) {
    if (this.#state.project?.projectId !== project.projectId) return;
    this.ensureRuntime(project.projectId);
    if (!this.#runtime) return;
    const intent = ++this.#intent;
    const token: RevisionToken = { projectId: project.projectId, revision: project.revision, attemptId: crypto.randomUUID(), sourceDigest: 'pending', manifestDigest: 'pending' };
    this.#attempt = token;
    // Invalidate older execution immediately, including while the new package set is preparing.
    this.#runtime.setDesiredRevision(token);
    this.update({ status: '필요한 구성 요소를 준비하고 있어요', previewError: undefined, previewPending: true, diagnostics: [] });
    try {
      const [ready, hostConfig, digest] = await Promise.all([this.dependencies(project.packageSet, intent), this.capability(project), sourceDigest(project.files)]);
      if (intent !== this.#intent) return;
      token.sourceDigest = digest; token.manifestDigest = ready.manifestDigest;
      this.#attempt = token; this.#runtime.setDesiredRevision(token);
      return await this.#runtime.build({ token, layers: { project: project.files }, manifest: ready.manifest, hostConfig });
    } catch (error) {
      if (intent === this.#intent) {
        const reason = error instanceof DependencyError ? error.message : accessMessage(error, '프리뷰 연결 준비 실패');
        const previewError = `${this.failurePrefix()}: 구성 요소 준비 실패 · ${reason}`;
        this.update({ status: previewError, previewError, previewPending: false });
      }
    }
  }
  private async dependencies(packageSet: PackageSetRequest, intent: number): Promise<Extract<PackageSetStatus, { status: 'ready' }>> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 90000);
    try {
      let result = await json<PackageSetStatus>(API.deps + '/package-sets', packageSet, 'POST', undefined, abort.signal);
      while (result.status === 'building') {
        if (intent !== this.#intent) throw new DependencyError('더 최신 요청이 있어요');
        this.update({ status: '처음 사용하는 구성 요소를 준비하고 있어요' });
        result = await json<PackageSetStatus>(`${API.deps}/package-sets/${result.artifactKey}/wait?timeoutMs=30000`, undefined, 'GET', undefined, abort.signal);
      }
      if (result.status === 'failed') {
        // Map only known error categories. Never render raw builder logs/URLs/secrets.
        throw new DependencyError(dependencyReason(result.code) ?? '구성 요소 빌드 실패');
      }
      return result;
    } catch (error) {
      if (error instanceof DependencyError) throw error;
      if (abort.signal.aborted) throw new DependencyError('대기 시간 초과');
      if (error instanceof HttpError) throw new DependencyError(dependencyReason(error.body?.code ?? (error.status === 400 ? 'input' : undefined)) ?? '구성 요소 서비스 응답 오류');
      throw new DependencyError('구성 요소 서비스 연결 실패');
    } finally { clearTimeout(timeout); }
  }
  dispose() { ++this.#openEpoch; ++this.#intent; this.#stream?.abort(); clearInterval(this.#writeTimer); this.#runtime?.dispose(); this.#runtime = undefined; this.#runtimeProjectId = undefined; this.#container = undefined; }
  async loadMembership() {
    if (!this.#state.project) return;
    try { this.update({ membership: await json<ProjectMembership>(`${API.agent}/projects/${this.#state.project.projectId}/membership`), accessNotice: undefined }); }
    catch (error) { this.update({ accessNotice: accessMessage(error, '멤버를 불러오지 못했어요.') }); }
  }
  async addMember(username: string, role: ProjectRole) {
    if (!this.#state.project) return;
    try {
      const users = await json<Array<{ sub: string; username: string }>>(`${API.agent}/projects/${this.#state.project.projectId}/users?username=${encodeURIComponent(username.trim())}`);
      const user = users.find(user => user.username === username.trim());
      if (!user) { this.update({ accessNotice: '사용자를 찾을 수 없어요. 정확한 사용자 이름을 입력해 주세요.' }); return; }
      await this.changeMember(user.sub, role);
    } catch (error) { this.update({ accessNotice: accessMessage(error, '사용자를 찾지 못했어요.') }); }
  }
  async changeMember(sub: string, role?: ProjectRole) {
    if (!this.#state.project || !sub.trim()) return;
    try {
      const membership = await json<ProjectMembership>(`${API.agent}/projects/${this.#state.project.projectId}/members/${encodeURIComponent(sub.trim())}`, role ? { role } : {}, role ? 'PUT' : 'DELETE');
      this.update({ membership, accessNotice: undefined });
    } catch (error) { this.update({ accessNotice: accessMessage(error, '멤버를 변경하지 못했어요. 사용자 ID를 확인해 주세요.') }); }
  }
  async loadApprovals(projectId = this.#state.project?.projectId) {
    if (!projectId) return;
    try { this.update({ approvals: await json<Approval[]>(`${API.policy}/approvals?projectId=${encodeURIComponent(projectId)}`), accessNotice: undefined }); }
    catch (error) { this.update({ approvals: [], accessNotice: accessMessage(error, '승인 요청을 불러오지 못했어요.') }); }
  }
  async requestApproval(apiId: string, justification: string) {
    if (!this.#state.project) return;
    try { await json(API.policy + '/approvals', { projectId: this.#state.project.projectId, apiId, scope: 'live-write', justification }); await this.loadApprovals(); }
    catch (error) { this.update({ accessNotice: accessMessage(error, '승인을 요청하지 못했어요.') }); }
  }
  async decideApproval(approval: Approval, decision: 'approved' | 'rejected') {
    try { await json(`${API.policy}/approvals/${encodeURIComponent(approval.approvalId)}/decision`, { decision }); await this.loadApprovals(approval.projectId); }
    catch (error) { this.update({ accessNotice: accessMessage(error, '승인을 처리하지 못했어요.') }); }
  }
  async loadAudit() {
    if (!this.#state.project) return;
    try { this.update({ audit: await json<AuditRecord[]>(`${API.policy}/audit?projectId=${this.#state.project.projectId}`) }); }
    catch (error) { this.update({ status: accessMessage(error, '활동 기록을 불러오지 못했어요.') }); }
  }
}
