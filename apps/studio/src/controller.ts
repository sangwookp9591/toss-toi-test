import { createPreviewRuntime, digestJson, sourceDigest } from '../../../packages/preview-runtime/src/index.ts';
import type { PreviewRuntime, PreviewEvent, RevisionToken, PreviewHostConfig } from '../../../contracts/src/runtime.ts';
import type { Project, GenerationEvent } from '../../../contracts/src/generation.ts';
import type { PackageSetStatus, PackageSetRequest } from '../../../contracts/src/package-set.ts';
import type { AuditRecord, PublicApi } from '../../../contracts/src/policy.ts';
import { API, json, HttpError, consumeGeneration } from './api.ts';
export interface StudioState {
  project?: Project; files: Record<string, string>; selected: string; dirty: boolean;
  status: string; busy: boolean; saving: boolean; conflict: boolean; writeAllowed: boolean;
  chats: Array<{ role: 'user' | 'assistant'; text: string }>;
  question?: Extract<GenerationEvent, { type: 'question' }>;
  events: PreviewEvent[]; lastCommit?: Extract<PreviewEvent, { type: 'committed' }>;
  generationEvents: GenerationEvent[]; audit: AuditRecord[];
}
export class StudioController {
  #state: StudioState = { files: {}, selected: '/src/App.tsx', dirty: false, status: '어떤 화면이 필요한가요?', busy: false, saving: false, conflict: false, writeAllowed: false, chats: [], events: [], generationEvents: [], audit: [] };
  #listeners = new Set<() => void>(); #runtime?: PreviewRuntime;
  #editorSession = ''; #viewerSession = ''; #sessions?: Promise<void>;
  #intent = 0; #attempt?: RevisionToken; #generationId?: string; #stream?: AbortController;
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  private update(change: Partial<StudioState>) { this.#state = { ...this.#state, ...change }; for (const listener of this.#listeners) listener(); }
  attach(container: HTMLElement) {
    if (this.#runtime) return;
    this.#runtime = createPreviewRuntime({ container, previewOrigin: 'http://localhost:5174', frameUrl: 'http://localhost:5174/frame.html', esbuildWasmUrl: location.origin + '/esbuild.wasm', entry: '/src/main.tsx', bootTimeoutMs: 15000 });
    this.#runtime.on(event => {
      const change: Partial<StudioState> = { events: [...this.#state.events.slice(-49), event] };
      if (event.type === 'committed') { change.lastCommit = event; change.status = '화면에 반영했어요'; }
      else if (event.token.attemptId === this.#attempt?.attemptId) {
        if (event.type === 'build_started') change.status = '화면을 준비하고 있어요';
        if (event.type === 'build_failed') change.status = `이전 화면을 유지했어요: 문법 오류 ${event.diagnostics.length}건`;
        if (event.type === 'runtime_failed') change.status = '이전 화면을 유지했어요: 실행 중 오류가 발생했어요';
        if (event.type === 'stale_discarded') change.status = '이전 화면을 유지했어요: 더 최신 요청이 있어요';
      }
      this.update(change);
    });
  }
  private async sessions() {
    this.#sessions ??= (async () => {
      let user = localStorage.getItem('toi-studio-user-v1');
      if (!user) { user = 'studio-' + crypto.randomUUID(); localStorage.setItem('toi-studio-user-v1', user); }
      const [editor, viewer] = await Promise.all([
        json<{ token: string }>(API.policy + '/dev/session', { user, roles: ['viewer', 'editor'] }),
        json<{ token: string }>(API.policy + '/dev/session', { user, roles: ['viewer'] }),
      ]);
      this.#editorSession = editor.token; this.#viewerSession = viewer.token;
    })();
    return this.#sessions;
  }
  async open(projectId?: string, name = '고객 어드민') {
    try {
      this.update({ status: '프로젝트를 준비하고 있어요' });
      await this.sessions();
      const project = projectId ? await json<Project>(`${API.agent}/projects/${projectId}`) : await json<Project>(API.agent + '/projects', { name, apiIds: ['customers'] });
      history.replaceState(null, '', '?project=' + project.projectId);
      this.update({ project, files: { ...project.files }, dirty: false, conflict: false });
      void this.preview(project);
    } catch { this.update({ status: '프로젝트를 열지 못했어요. 서비스 연결을 확인해 주세요.' }); }
  }
  select(path: string) { this.update({ selected: path }); }
  edit(content: string) { this.update({ files: { ...this.#state.files, [this.#state.selected]: content }, dirty: true }); }
  async saveFiles(files = this.#state.files): Promise<Project | undefined> {
    const current = this.#state.project; if (!current) return;
    this.update({ saving: true, conflict: false });
    try {
      const project = await json<Project>(`${API.agent}/projects/${current.projectId}/source`, { baseRevision: current.revision, files }, 'PUT');
      this.update({ project, files: { ...project.files }, dirty: false, saving: false });
      void this.preview(project); return project;
    } catch (error) {
      this.update({ saving: false, conflict: error instanceof HttpError && error.status === 409, status: error instanceof HttpError && error.status === 409 ? '다른 탭에서 먼저 저장했어요. 최신 내용을 불러온 뒤 다시 저장해 주세요.' : '저장하지 못했어요. 다시 시도해 주세요.' });
    }
  }
  async reload() { if (this.#state.project) await this.open(this.#state.project.projectId); }
  async generate(prompt: string) {
    const project = this.#state.project; if (!project || this.#state.busy || !prompt.trim()) return;
    this.update({ busy: true, question: undefined, status: '화면을 만들고 있어요', chats: [...this.#state.chats, { role: 'user', text: prompt }, { role: 'assistant', text: '' }] });
    try {
      const { generationId } = await json<{ generationId: string }>(API.agent + '/generations', { projectId: project.projectId, baseRevision: project.revision, prompt, requestId: crypto.randomUUID() });
      this.#generationId = generationId; this.#stream?.abort(); this.#stream = new AbortController();
      await consumeGeneration(generationId, this.#stream.signal, event => this.handleGeneration(event), () => this.update({ status: '연결이 끊겨 다시 연결하고 있어요' }));
    } catch { this.update({ busy: false, status: '화면 생성을 시작하지 못했어요. 다시 시도해 주세요.' }); }
  }
  private handleGeneration(event: GenerationEvent) {
    this.update({ generationEvents: [...this.#state.generationEvents, event] });
    if (event.type === 'text') {
      const chats = [...this.#state.chats]; const last = chats.at(-1);
      if (last?.role === 'assistant') chats[chats.length - 1] = { ...last, text: last.text + event.delta };
      this.update({ chats });
    } else if (event.type === 'question') this.update({ question: event, status: '한 가지만 더 알려 주세요' });
    else if (event.type === 'file') this.update({ files: { ...this.#state.files, [event.path]: event.content } });
    else if (event.type === 'file_deleted') { const files = { ...this.#state.files }; delete files[event.path]; this.update({ files }); }
    else if (event.type === 'revision_ready') {
      const project = { ...this.#state.project!, files: event.files, packageSet: event.packageSet, revision: event.revision };
      this.update({ project, files: event.files, dirty: false, question: undefined }); void this.preview(project);
    } else if (event.type === 'done') this.update({ busy: false, question: undefined });
    else if (event.type === 'canceled') this.update({ busy: false, question: undefined, status: '생성을 중단했어요. 이전 화면은 그대로예요.' });
    else if (event.type === 'failed') this.update({ busy: false, question: undefined, status: event.code === 'conflict' ? '생성 중 다른 변경이 저장됐어요. 최신 내용을 불러와 주세요.' : '화면을 만들지 못했어요. 이전 화면을 유지했어요.', conflict: event.code === 'conflict' });
  }
  async answer(answer: string) {
    if (!this.#generationId || !this.#state.question) return;
    await json(`${API.agent}/generations/${this.#generationId}/answers`, { questionId: this.#state.question.questionId, answer });
    this.update({ question: undefined, status: '답변을 반영하고 있어요' });
  }
  async cancel() {
    ++this.#intent; if (this.#attempt) this.#runtime?.cancel(this.#attempt);
    if (this.#generationId) await json(`${API.agent}/generations/${this.#generationId}/cancel`, {}, 'POST');
  }
  async setWriteAllowed(allowed: boolean) { this.update({ writeAllowed: allowed }); if (this.#state.project) await this.preview(this.#state.project); }
  private async capability(project: Project): Promise<PreviewHostConfig> {
    await this.sessions(); const write = this.#state.writeAllowed;
    const capability = await json<{ token: string }>(API.policy + '/capabilities', { projectId: project.projectId, mode: write ? 'write' : 'read', env: 'preview', ttlSec: write ? 120 : 300, ...(write ? { apiIds: project.apiIds } : {}) }, 'POST', write ? this.#editorSession : this.#viewerSession);
    return { toiFetch: { sessionToken: this.#viewerSession, capabilityToken: capability.token, projectId: project.projectId, proxyBaseUrl: API.policy, env: 'preview' } };
  }
  async preview(project: Project) {
    if (!this.#runtime) return;
    const intent = ++this.#intent;
    const token: RevisionToken = { projectId: project.projectId, revision: project.revision, attemptId: crypto.randomUUID(), sourceDigest: 'pending', manifestDigest: 'pending' };
    this.#attempt = token;
    // Invalidate older execution immediately, including while the new package set is preparing.
    this.#runtime.setDesiredRevision(token);
    this.update({ status: '필요한 구성 요소를 준비하고 있어요' });
    try {
      const [ready, hostConfig, digest] = await Promise.all([this.dependencies(project.packageSet, intent), this.capability(project), sourceDigest(project.files)]);
      if (intent !== this.#intent) return;
      token.sourceDigest = digest; token.manifestDigest = ready.manifestDigest;
      this.#attempt = token; this.#runtime.setDesiredRevision(token);
      return await this.#runtime.build({ token, layers: { project: project.files }, manifest: ready.manifest, hostConfig });
    } catch (error) { if (intent === this.#intent) this.update({ status: '이전 화면을 유지했어요: 구성 요소를 준비하지 못했어요' }); }
  }
  private async dependencies(packageSet: PackageSetRequest, intent: number): Promise<Extract<PackageSetStatus, { status: 'ready' }>> {
    let result = await json<PackageSetStatus>(API.deps + '/package-sets', packageSet);
    while (result.status === 'building') {
      if (intent === this.#intent) this.update({ status: '처음 사용하는 구성 요소를 준비하고 있어요' });
      result = await json<PackageSetStatus>(`${API.deps}/package-sets/${result.artifactKey}/wait?timeoutMs=30000`);
    }
    if (result.status !== 'ready') throw new Error('Package preparation failed'); return result;
  }
  async loadAudit() { await this.sessions(); if (this.#state.project) this.update({ audit: await json<AuditRecord[]>(`${API.policy}/audit?projectId=${this.#state.project.projectId}`, undefined, 'GET', this.#editorSession) }); }
}
