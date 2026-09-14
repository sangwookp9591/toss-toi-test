import type { AgentContext, AgentDriver } from '../engine.ts';
import { createTools } from '../claude.ts';
import { CanceledError, ModelError, ToolError } from '../schema.ts';
import { SYSTEM_PROMPT } from '../system-prompt.ts';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MAX_TURNS = 24;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const MAX_TEXT_RETRIES = 2;
const CONTINUE_TO_FINISH = '작업을 계속하고 끝나면 finish 도구를 호출하라.';

export interface GeminiMetrics {
  turns: number; toolCalls: number; toolErrors: number; inputTokens: number; outputTokens: number; thoughtsTokens: number; durationMs: number; costUsd: number;
}
export interface GeminiOptions {
  apiKey?: string; model?: string; baseUrl?: string; maxTurns?: number; maxOutputTokens?: number; maxDurationMs?: number;
  timeoutMs?: number; maxCostUsd?: number; inputUsdPerMtok?: number; outputUsdPerMtok?: number; fetcher?: typeof fetch;
  onCostReservation?: (costUsd: number) => ((actualCostUsd?: number) => void) | void;
  onMetrics?: (generationId: string, metrics: GeminiMetrics) => void;
}
interface Part { text?: string; functionCall?: { name?: string; args?: unknown }; functionResponse?: { name: string; response: unknown } }
interface Content { role: 'user' | 'model'; parts: Part[] }
interface GeminiResponse { candidates?: Array<{ content?: { role?: string; parts?: Part[] }; finishReason?: string }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; toolUsePromptTokenCount?: number } }

export class GeminiDriver implements AgentDriver {
  readonly mode = 'gemini' as const;
  private readonly options: GeminiOptions;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  constructor(options: GeminiOptions = {}) {
    this.options = options;
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? '';
    if (!this.apiKey) throw new Error('Gemini credentials are unavailable');
    this.timeoutMs = options.timeoutMs ?? positiveEnv('GEMINI_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS;
    for (const [name, value] of [['maxTurns', options.maxTurns], ['maxOutputTokens', options.maxOutputTokens], ['maxDurationMs', options.maxDurationMs], ['timeoutMs', this.timeoutMs]] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new Error(`${name} must be a positive integer`);
    }
    for (const [name, value] of [['maxCostUsd', options.maxCostUsd], ['inputUsdPerMtok', options.inputUsdPerMtok], ['outputUsdPerMtok', options.outputUsdPerMtok]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`${name} must be a non-negative number`);
    }
  }
  async run(context: AgentContext): Promise<void> {
    const started = Date.now();
    const metrics: GeminiMetrics = { turns: 0, toolCalls: 0, toolErrors: 0, inputTokens: 0, outputTokens: 0, thoughtsTokens: 0, durationMs: 0, costUsd: 0 };
    const specs = createTools(context);
    const declarations = specs.map(tool => ({ name: tool.name, description: 'description' in tool ? tool.description : '', parametersJsonSchema: 'input_schema' in tool ? stripSchemaMeta(tool.input_schema) : { type: 'object', properties: {} } }));
    const messages: Content[] = [{ role: 'user', parts: [{ text: safe(JSON.stringify({ request: context.record.request.prompt, files: context.record.files, packageSet: context.record.packageSet }), this.apiKey) }] }];
    let textRetries = 0;
    const timeout = this.options.maxDurationMs === undefined ? undefined : AbortSignal.timeout(this.options.maxDurationMs);
    const signal = timeout ? AbortSignal.any([context.signal, timeout]) : context.signal;
    try {
      for (let turn = 0; turn < (this.options.maxTurns ?? DEFAULT_MAX_TURNS); turn++) {
        context.active(); metrics.turns++;
        const body = JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents: messages,
          tools: [{ functionDeclarations: declarations }], generationConfig: { maxOutputTokens: this.options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, temperature: 0 },
          toolConfig: { functionCallingConfig: { mode: 'ANY' } },
        });
        const settleReservation = this.reserveCost(metrics, body);
        const requestTimeout = AbortSignal.timeout(this.timeoutMs);
        const requestSignal = AbortSignal.any([signal, requestTimeout]);
        let response: Response;
        let settled = false;
        try {
          try {
            response = await (this.options.fetcher ?? fetch)(this.url(), { method: 'POST', signal: requestSignal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body });
          } catch (error) {
            if (context.signal.aborted) throw error;
            if (requestSignal.aborted) throw new ModelError('Gemini request timed out');
            throw new ModelError('Gemini connection failed');
          }
        if (context.signal.aborted) throw new CanceledError('Generation is no longer active');
        if (requestSignal.aborted) throw new ModelError('Gemini request timed out');
        if (!response.ok) { await response.body?.cancel(); throw this.httpError(response.status); }
        let value: GeminiResponse;
        try { value = await response.json() as GeminiResponse; } catch { if (requestSignal.aborted) throw new ModelError('Gemini request timed out'); throw new ModelError('Gemini returned invalid JSON'); }
        if (context.signal.aborted) throw new CanceledError('Generation is no longer active');
        if (requestSignal.aborted) throw new ModelError('Gemini request timed out');
        const candidate = value.candidates?.[0];
        const parts = candidate?.content?.parts;
        if (!candidate || !Array.isArray(parts)) throw new ModelError('Gemini returned no candidate');
        const usage = value.usageMetadata;
        settleReservation(usage ? this.cost(integer(usage.promptTokenCount) + integer(usage.toolUsePromptTokenCount), integer(usage.candidatesTokenCount) + integer(usage.thoughtsTokenCount)) : undefined);
        settled = true;
        const thoughtsTokens = integer(usage?.thoughtsTokenCount);
        metrics.inputTokens += integer(usage?.promptTokenCount) + integer(usage?.toolUsePromptTokenCount);
        metrics.outputTokens += integer(usage?.candidatesTokenCount) + thoughtsTokens;
        metrics.thoughtsTokens += thoughtsTokens;
        metrics.costUsd = this.cost(metrics.inputTokens, metrics.outputTokens);
        const finishReason = candidate.finishReason;
        if (finishReason && (!FINISH_REASONS.has(finishReason) || finishReason.length > MAX_FINISH_REASON_LENGTH)) throw new ModelError('Gemini returned unsupported finish reason');
        if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') throw new ModelError(`Gemini stopped with ${finishReason}`);
        messages.push({ role: 'model', parts: sanitize(parts, this.apiKey) as Part[] });
        for (const part of parts) if (typeof part.text === 'string') context.text(safe(part.text, this.apiKey));
        const calls = parts.filter(part => part.functionCall);
        const responses: Part[] = [];
        let finished = false;
        for (const part of calls) {
          context.active(); metrics.toolCalls++;
          const call = part.functionCall!; const name = typeof call.name === 'string' ? call.name : 'invalid_tool';
          try {
            const spec = specs.find(item => item.name === name);
            if (!spec) throw new ToolError(`Unknown tool: ${name}`);
            const sanitizedArgs = sanitize(call.args, this.apiKey);
            const args = sanitizedArgs && typeof sanitizedArgs === 'object' && !Array.isArray(sanitizedArgs) ? sanitizedArgs as Record<string, unknown> : {};
            const parsed = spec.parse ? spec.parse(args) : args;
            const output = await spec.run(parsed as Record<string, unknown>);
            responses.push({ functionResponse: { name, response: sanitize(typeof output === 'string' ? functionResponse(output, this.apiKey) : output, this.apiKey) } });
            if (name === 'finish') finished = true;
          } catch (error) {
            if (context.signal.aborted) throw error;
            metrics.toolErrors++;
            responses.push({ functionResponse: { name, response: { is_error: true, error: safe(error instanceof Error ? error.message : 'Invalid tool call', this.apiKey) } } });
          }
        }
        if (responses.length) messages.push({ role: 'user', parts: responses });
          if (finished) return;
          if (!calls.length) {
            if (finishReason && finishReason !== 'STOP') return;
            if (textRetries++ >= MAX_TEXT_RETRIES) return;
            messages.push({ role: 'user', parts: [{ text: CONTINUE_TO_FINISH }] });
          }
        } catch (error) {
          if (!settled) settleReservation();
          throw error;
        }
      }
      throw new ModelError(`Gemini exceeded ${this.options.maxTurns ?? DEFAULT_MAX_TURNS} turns`);
    } catch (error) {
      if (context.signal.aborted || error instanceof CanceledError) throw error;
      if (error instanceof ModelError) throw error;
      throw new ModelError('Gemini request failed');
    } finally {
      metrics.durationMs = Date.now() - started;
      this.options.onMetrics?.(context.record.generationId, { ...metrics });
    }
  }
  private url() { return `${(this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/${encodeURIComponent(this.options.model || process.env.GEMINI_MODEL || DEFAULT_MODEL)}:generateContent`; }
  private cost(inputTokens: number, outputTokens: number) { return (inputTokens * (this.options.inputUsdPerMtok ?? 0) + outputTokens * (this.options.outputUsdPerMtok ?? 0)) / 1_000_000; }
  private reserveCost(metrics: GeminiMetrics, body: string) {
    const input = Buffer.byteLength(body); const output = this.options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const reserve = (input * (this.options.inputUsdPerMtok ?? 0) + output * (this.options.outputUsdPerMtok ?? 0)) / 1_000_000;
    const settle = this.options.onCostReservation?.(reserve);
    if (!this.options.onCostReservation && this.options.maxCostUsd !== undefined && metrics.costUsd + reserve > this.options.maxCostUsd) throw new ModelError('Gemini cost limit exceeded');
    return settle ?? (() => {});
  }
  private httpError(status: number) {
    if (status === 429) return new ModelError('Gemini rate limit exceeded');
    if (status >= 500) return new ModelError('Gemini service unavailable');
    return new ModelError(`Gemini API error (HTTP ${status})`);
  }
}

const FINISH_REASONS = new Set(['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL', 'IMAGE_SAFETY', 'UNEXPECTED_TOOL_CALL', 'NO_IMAGE']);
const MAX_FINISH_REASON_LENGTH = 64;
function positiveEnv(name: string) { const value = Number(process.env[name]); return Number.isInteger(value) && value > 0 ? value : undefined; }
function integer(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0; }
function stripSchemaMeta(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchemaMeta);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema').map(([key, item]) => [key, stripSchemaMeta(item)]));
}
function safe(value: string, secret: string) { return secret ? value.split(secret).join('[REDACTED]') : value; }
function sanitize(value: unknown, secret: string): unknown {
  if (typeof value === 'string') return safe(value, secret);
  if (Array.isArray(value)) return value.map(item => sanitize(item, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [safe(key, secret), sanitize(item, secret)]));
  return value;
}
function functionResponse(output: string, secret: string) {
  try {
    const parsed = JSON.parse(output);
    if (parsed !== null && typeof parsed === 'object') return { result: sanitize(parsed, secret) };
  } catch { /* preserve the existing string response for malformed JSON */ }
  return { result: safe(output, secret) };
}
