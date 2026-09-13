import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaMessage, BetaMessageParam, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages';
import { z } from 'zod';
import type { AgentContext, AgentDriver } from './engine.ts';
import { SYSTEM_PROMPT } from './system-prompt.ts';
import { packageSetSchema, ModelError } from './schema.ts';
export { ModelError } from './schema.ts';
import { MockDriver } from './mock.ts';

export function modelError(error: unknown): ModelError {
  if (error instanceof Anthropic.RateLimitError) return new ModelError('Claude rate limit exceeded');
  if (error instanceof Anthropic.AuthenticationError) return new ModelError('Claude authentication failed');
  if (error instanceof Anthropic.PermissionDeniedError) return new ModelError('Claude permission denied');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ModelError('Claude request timed out');
  if (error instanceof Anthropic.APIUserAbortError) return new ModelError('Claude request aborted');
  if (error instanceof Anthropic.APIConnectionError) return new ModelError('Claude connection failed');
  if (error instanceof Anthropic.APIError) return new ModelError(`Claude API error (HTTP ${error.status ?? 'unknown'})`);
  if (error instanceof ModelError) return error;
  if (error instanceof Anthropic.AnthropicError) return new ModelError('Claude SDK error');
  return new ModelError('Unexpected model failure');
}
export function createTools(context: AgentContext) {
  const specs: Array<{ name: string; description: string; inputSchema: z.ZodType }> = [
    { name: 'list_registered_apis', description: 'List registered public API contracts.', inputSchema: z.object({}) },
    { name: 'get_api_schema', description: 'Read an API schema and its access policy.', inputSchema: z.object({ apiId: z.string() }) },
    { name: 'list_files', description: 'List staged source paths.', inputSchema: z.object({}) },
    { name: 'read_file', description: 'Read a staged file under /src/.', inputSchema: z.object({ path: z.string() }) },
    { name: 'write_file', description: 'Stage a complete source file under /src/.', inputSchema: z.object({ path: z.string(), content: z.string() }) },
    { name: 'delete_file', description: 'Delete a staged file under /src/.', inputSchema: z.object({ path: z.string() }) },
    { name: 'ask_user', description: 'Ask one question and wait for its answer.', inputSchema: z.object({ question: z.string(), options: z.array(z.string()).optional() }) },
    { name: 'request_packages', description: 'Replace the package set using only the approved catalog.', inputSchema: z.object({ packageSet: packageSetSchema }) },
    { name: 'finish', description: 'CAS-save the staged project and complete generation.', inputSchema: z.object({ summary: z.string() }) },
  ];
  return specs.map(spec => betaZodTool({ ...spec, run: async args => JSON.stringify(await context.tool(spec.name, args as Record<string, unknown>)) }));
}
export interface Iteration extends AsyncIterable<BetaRawMessageStreamEvent> { finalMessage(): Promise<Pick<BetaMessage, 'stop_reason' | 'content'>> }
export interface Runner extends AsyncIterable<Iteration> { pushMessages(...messages: BetaMessageParam[]): void }
export type RunnerFactory = (params: Parameters<Anthropic['beta']['messages']['toolRunner']>[0], options: { signal: AbortSignal }) => Runner;
export class ClaudeDriver implements AgentDriver {
  private fallback = false;
  get mode(): 'claude' | 'mock' { return this.fallback ? 'mock' : 'claude'; }
  constructor(private runnerFactory: RunnerFactory, private autoFallback = false, private mock = new MockDriver()) {}
  async run(context: AgentContext) {
    if (this.fallback) return this.mock.run(context);
    let receivedContent = false;
    try {
      const runner = this.runnerFactory({
        model: 'claude-opus-5', max_tokens: 64000, thinking: { type: 'adaptive' }, stream: true,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: createTools(context), max_iterations: 50,
        messages: [{ role: 'user', content: JSON.stringify({ request: context.record.request.prompt, files: context.record.files, packageSet: context.record.packageSet }) }],
      }, { signal: context.signal });
      for await (const stream of runner) {
        context.active();
        for await (const event of stream) {
          context.active();
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            receivedContent = true;
            context.text(event.delta.text);
          }
        }
        const message = await stream.finalMessage();
        receivedContent = true;
        context.active();
        if (message.stop_reason === 'refusal') throw new ModelError('Claude refused the request');
        if (message.stop_reason === 'pause_turn') runner.pushMessages({ role: 'assistant', content: message.content });
      }
    } catch (error) {
      if (context.signal.aborted) throw error;
      if (this.autoFallback && !receivedContent && error instanceof Anthropic.AuthenticationError) {
        this.fallback = true;
        return this.mock.run(context);
      }
      throw modelError(error);
    }
  }
}

/** Resolve SDK default credentials once, without making a model request or exposing headers. */
export class CredentialClient extends Anthropic {
  async hasUsableCredentials(): Promise<boolean> {
    try {
      const headers = await this.authHeaders({ method: 'post', path: '/v1/messages' });
      if (!headers) return false;
      this.validateHeaders(headers);
      return true;
    } catch { return false; }
  }
}
export async function createDriver(mode: 'auto' | 'mock' | 'claude' = 'auto'): Promise<AgentDriver> {
  if (mode === 'mock') return new MockDriver();
  const client = new CredentialClient({ maxRetries: 0, timeout: 60000 });
  if (!await client.hasUsableCredentials()) {
    if (mode === 'auto') return new MockDriver();
    throw new ModelError('Claude credentials are unavailable');
  }
  return new ClaudeDriver((params, options) => client.beta.messages.toolRunner({ ...params, stream: true }, options), mode === 'auto');
}
