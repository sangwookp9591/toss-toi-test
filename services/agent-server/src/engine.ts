import { randomUUID } from 'node:crypto';
import type { CreateGenerationRequest, GenerationEvent, GenerationState } from '../../../contracts/src/generation.ts';
import { Store, type GenerationRecord } from './store.ts';
import { canonicalJson, sourceDigest } from './digest.ts';
import { CanceledError, HttpError, ModelError, ToolError, packageSetSchema, sourcePath } from './schema.ts';
import { PolicyClient } from './policy-client.ts';

type EventInput = GenerationEvent extends infer E ? E extends GenerationEvent ? Omit<E, 'seq' | 'generationId'> : never : never;
export const terminal = (state: GenerationState) => ['done', 'failed', 'canceled'].includes(state);
export interface AgentContext {
  record: GenerationRecord; signal: AbortSignal;
  active(): void;
  text(delta: string): void;
  tool(name: string, args: Record<string, unknown>): Promise<unknown>;
}
export interface AgentDriver { mode: 'claude' | 'mock'; run(context: AgentContext): Promise<void> }
interface Execution { controller: AbortController; answer?: { questionId: string; resolve: (answer: string) => void; reject: (error: Error) => void } }
export class Engine {
  private execution = new Map<string, Execution>();
  private listeners = new Map<string, Set<(event: GenerationEvent) => void>>();
  constructor(readonly store: Store, readonly driver: AgentDriver, readonly policy = new PolicyClient()) {
    for (const record of store.generations.values()) {
      if (!terminal(record.state)) this.fail(record, 'Server restarted before generation completed', 'internal');
    }
  }
  private emit(record: GenerationRecord, input: EventInput) {
    const event = { ...input, generationId: record.generationId, seq: record.events.length + 1 } as GenerationEvent;
    record.events.push(event);
    this.store.persist(record);
    for (const listener of this.listeners.get(record.generationId) ?? []) listener(structuredClone(event));
  }
  private state(record: GenerationRecord, state: GenerationState) { record.state = state; this.emit(record, { type: 'state', state }); }
  private active(record: GenerationRecord) {
    if (terminal(record.state) || this.execution.get(record.generationId)?.controller.signal.aborted) throw new CanceledError('Generation is no longer active');
  }
  subscribe(id: string, listener: (event: GenerationEvent) => void) {
    this.store.generation(id);
    const listeners = this.listeners.get(id) ?? new Set();
    this.listeners.set(id, listeners); listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); };
  }
  create(request: CreateGenerationRequest): string {
    const existingId = this.store.requestIds.get(request.requestId);
    if (existingId) {
      if (canonicalJson(this.store.generation(existingId).request) !== canonicalJson(request)) throw new HttpError(409, 'requestId reused with different input');
      return existingId;
    }
    const project = this.store.project(request.projectId);
    const generationId = randomUUID();
    const record: GenerationRecord = { generationId, request: structuredClone(request), state: 'requested', files: project.files, packageSet: project.packageSet, events: [] };
    this.store.generations.set(generationId, record);
    this.store.requestIds.set(request.requestId, generationId);
    this.execution.set(generationId, { controller: new AbortController() });
    this.emit(record, { type: 'state', state: 'requested' });
    setImmediate(() => { void this.run(record); });
    return generationId;
  }
  private async run(record: GenerationRecord) {
    try {
      this.active(record);
      this.state(record, 'staging');
      const context: AgentContext = {
        record, signal: this.execution.get(record.generationId)!.controller.signal,
        active: () => this.active(record),
        text: delta => { this.active(record); this.emit(record, { type: 'text', delta }); },
        tool: (name, args) => this.tool(record, name, args),
      };
      await this.driver.run(context);
      if (!terminal(record.state)) this.fail(record, 'Model completed without calling finish', 'model_error');
    } catch (error) {
      if (terminal(record.state)) return;
      if (error instanceof HttpError && error.status === 409) this.fail(record, 'Source revision changed during generation', 'conflict');
      else if (error instanceof ToolError) this.fail(record, error.message, 'tool_error');
      else this.fail(record, error instanceof ModelError ? error.message : 'Generation failed', 'model_error');
    } finally { this.execution.delete(record.generationId); }
  }
  private fail(record: GenerationRecord, message: string, code: 'conflict' | 'model_error' | 'tool_error' | 'internal') {
    if (terminal(record.state)) return;
    this.state(record, 'failed');
    this.emit(record, { type: 'failed', message, code });
    this.execution.get(record.generationId)?.controller.abort();
  }
  cancel(id: string) {
    const record = this.store.generation(id);
    if (terminal(record.state)) return;
    const execution = this.execution.get(id);
    // Mark terminal before aborting so resumed promise callbacks can never mutate staging.
    this.state(record, 'canceled');
    this.emit(record, { type: 'canceled' });
    execution?.controller.abort();
    execution?.answer?.reject(new CanceledError('Generation canceled'));
    if (execution) execution.answer = undefined;
  }
  answer(id: string, questionId: string, answer: string) {
    const record = this.store.generation(id);
    const execution = this.execution.get(id);
    if (record.state !== 'awaiting_answer' || !execution?.answer || execution.answer.questionId !== questionId) throw new HttpError(409, 'question is not pending');
    const pending = execution.answer;
    execution.answer = undefined;
    this.state(record, 'staging');
    pending.resolve(answer);
  }
  private async tool(record: GenerationRecord, name: string, args: Record<string, unknown>): Promise<unknown> {
    this.active(record);
    const execution = this.execution.get(record.generationId)!;
    switch (name) {
      case 'list_registered_apis': case 'get_api_schema': {
        if (name === 'get_api_schema' && (typeof args.apiId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(args.apiId))) throw new ToolError('invalid apiId');
        const result = await this.policy.get(name === 'list_registered_apis' ? '/apis' : '/apis/' + args.apiId, execution.controller.signal);
        this.active(record);
        return result;
      }
      case 'list_files': return Object.keys(record.files).sort();
      case 'read_file': {
        const path = sourcePath(String(args.path));
        if (!Object.hasOwn(record.files, path)) throw new ToolError('file not found');
        return record.files[path];
      }
      case 'write_file': {
        const path = sourcePath(String(args.path));
        if (typeof args.content !== 'string') throw new ToolError('content must be a string');
        record.files[path] = args.content;
        this.emit(record, { type: 'file', path, content: args.content });
        return { path, staged: true };
      }
      case 'delete_file': {
        const path = sourcePath(String(args.path));
        delete record.files[path]; this.emit(record, { type: 'file_deleted', path }); return { path, deleted: true };
      }
      case 'request_packages': {
        const parsed = packageSetSchema.safeParse(args.packageSet);
        if (!parsed.success) throw new ToolError(parsed.error.issues.map(issue => issue.message).join('; '));
        record.packageSet = parsed.data;
        this.emit(record, { type: 'packages_requested', packageSet: record.packageSet }); return record.packageSet;
      }
      case 'ask_user': {
        if (record.state === 'awaiting_answer' || execution.answer) throw new ToolError('one question may be pending at a time');
        if (typeof args.question !== 'string' || !args.question.trim()) throw new ToolError('question is required');
        const questionId = randomUUID();
        const answer = new Promise<string>((resolve, reject) => { execution.answer = { questionId, resolve, reject }; });
        this.state(record, 'awaiting_answer');
        this.emit(record, { type: 'question', questionId, question: args.question, ...(Array.isArray(args.options) ? { options: args.options.map(String) } : {}) });
        const value = await answer; this.active(record); return value;
      }
      case 'finish': {
        if (execution.answer) throw new ToolError('answer the pending question before finish');
        let project;
        try { project = this.store.save(record.request.projectId, record.request.baseRevision, record.files, record.packageSet); }
        catch (error) {
          if (error instanceof HttpError && error.status === 409) this.fail(record, 'Source revision changed during generation', 'conflict');
          throw error;
        }
        this.state(record, 'revision_ready');
        this.emit(record, { type: 'revision_ready', revision: project.revision, sourceDigest: sourceDigest(project.files), files: project.files, packageSet: project.packageSet });
        this.state(record, 'done');
        this.emit(record, { type: 'done', summary: typeof args.summary === 'string' ? args.summary : 'Generation complete' });
        execution.controller.abort();
        return { revision: project.revision };
      }
      default: throw new ToolError(`unknown tool: ${name}`);
    }
  }
  close() { for (const record of this.store.generations.values()) if (!terminal(record.state)) this.cancel(record.generationId); }
}
