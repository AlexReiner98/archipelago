// Model calls: the one place the server asks a language model anything, with
// plain fetch. A conversation is said in one shape (Anthropic's messages,
// which the reader was written against) and sent one of two ways:
//
// - to Anthropic's own API, by default, on the workspace's key;
// - to any OpenAI-compatible URL (PELAGO_MODEL_URL: LiteLLM in front of
//   open-weight models, say), turned into a chat completion and its answer
//   turned back. PELAGO_MODEL_KEY is the key for that URL.
//
// Which model is a name (PELAGO_READER_MODEL), so moving from one to the other
// is configuration alone.

import { env } from './env.ts';

export interface TextBlock { type: 'text'; text: string }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
/** A block of a message. Others the model may send (its thinking, say) are passed back as they came. */
export type Block = TextBlock | ToolUseBlock | ToolResultBlock | { type: string; [k: string]: unknown };
export interface Turn { role: 'user' | 'assistant'; content: string | Block[] }
export interface Tool { name: string; description?: string; input_schema: Record<string, unknown> }

export interface Params {
  model: string;
  max_tokens: number;
  system?: string;
  tools?: Tool[];
  messages: Turn[];
  /** Anthropic's betas, sent as its header. The rest of what is given is sent to Anthropic as it is, and left out of a chat completion. */
  betas?: string[];
  [k: string]: unknown;
}

export interface Answer {
  content: Block[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn' | 'stop_sequence' | null;
  stop_details?: { explanation?: string } | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
}

/** One request to the model. Replaced in tests by something that answers from a script. */
export type Ask = (params: Params) => Promise<Answer>;

/** Where model calls go. Without a url, to Anthropic. */
export interface Endpoint {
  /** An OpenAI-compatible base, up to and including its version (http://litellm:4000/v1). */
  url?: string;
  /** The key for that url; when there is none, the workspace's key is sent to it. */
  key?: string;
}
export const configured = (): Endpoint => ({ url: env('MODEL_URL')?.replace(/\/+$/, '') || undefined, key: env('MODEL_KEY') || undefined });

const ANTHROPIC = 'https://api.anthropic.com';

/** A model's refusal, by what the owner can do about it. */
export class ModelError extends Error {
  readonly status: number | undefined;
  constructor(status: number | undefined, message: string) {
    super(message);
    this.status = status;
  }
  get kind(): 'auth' | 'rate' | 'api' | 'network' {
    if (this.status === 401 || this.status === 403) return 'auth';
    if (this.status === 429) return 'rate';
    return this.status ? 'api' : 'network';
  }
}

type Fetch = typeof fetch;
const RETRIES = 2;
const retried = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A request, tried again on what passes (a rate limit, an overload, a dropped connection), as the SDK did. */
async function send(f: Fetch, url: string, init: RequestInit, timeout: number): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await f(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      if (attempt < RETRIES) { await pause(500 * 2 ** attempt); continue; }
      throw new ModelError(undefined, `could not be reached: ${(err as Error).message}`);
    }
    if (res.ok) return res.json();
    const text = await res.text().catch(() => '');
    if (attempt < RETRIES && retried(res.status)) {
      const after = Number(res.headers.get('retry-after'));
      await pause(after > 0 && after < 60 ? after * 1000 : 500 * 2 ** attempt);
      continue;
    }
    let said = text;
    try { said = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { /* not JSON */ }
    throw new ModelError(res.status, said.slice(0, 1000) || res.statusText);
  }
}

const anthropicHeaders = (key: string, betas?: string[]): Record<string, string> => ({
  'content-type': 'application/json',
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  ...(betas?.length && { 'anthropic-beta': betas.join(',') }),
});
const bearer = (key: string | undefined): Record<string, string> => ({ 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) });

/** A conversation as a chat completion request. What only Anthropic understands (caching, effort, fallbacks) is left out. */
export function toChat(params: Params): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [];
  if (params.system) messages.push({ role: 'system', content: params.system });
  for (const turn of params.messages) {
    if (typeof turn.content === 'string') { messages.push({ role: turn.role, content: turn.content }); continue; }
    const text = turn.content.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n');
    if (turn.role === 'assistant') {
      const calls = turn.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: text || null, ...(calls.length && { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) }) });
      continue;
    }
    // A user's turn of tool results is one message for each, as chat completions has them.
    for (const r of turn.content.filter((b): b is ToolResultBlock => b.type === 'tool_result')) messages.push({ role: 'tool', tool_call_id: r.tool_use_id, content: r.is_error ? `Error: ${r.content}` : r.content });
    if (text) messages.push({ role: 'user', content: text });
  }
  return {
    model: params.model,
    max_tokens: params.max_tokens,
    messages,
    ...(params.tools?.length && { tools: params.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } })) }),
  };
}

interface Chat {
  choices?: { finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null; tool_calls?: { id: string; function: { name: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/** A chat completion's answer as a message. Arguments that are not JSON are handed on as they came, for the tool to refuse. */
export function fromChat(chat: Chat): Answer {
  const choice = chat.choices?.[0];
  const said = choice?.message;
  const calls = said?.tool_calls ?? [];
  const content: Block[] = [];
  if (said?.content) content.push({ type: 'text', text: said.content });
  for (const c of calls) {
    let input: unknown;
    try { input = JSON.parse(c.function.arguments || '{}'); } catch { input = { arguments: c.function.arguments }; }
    content.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
  }
  const finish = choice?.finish_reason;
  const stop_reason: Answer['stop_reason'] = calls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : finish === 'content_filter' || said?.refusal ? 'refusal' : 'end_turn';
  const cached = chat.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    content,
    stop_reason,
    ...(said?.refusal && { stop_details: { explanation: said.refusal } }),
    // Counted as Anthropic counts: what was read from the cache is not in the input.
    usage: { input_tokens: (chat.usage?.prompt_tokens ?? 0) - cached, output_tokens: chat.usage?.completion_tokens ?? 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 },
  };
}

/** Asking the model, on a key, where the endpoint says. */
export function asker(key: string | undefined, at: Endpoint = configured(), f: Fetch = fetch, timeout = 600_000): Ask {
  if (at.url) {
    const url = at.url;
    const token = at.key ?? key;
    return async (params) => fromChat((await send(f, `${url}/chat/completions`, { method: 'POST', headers: bearer(token), body: JSON.stringify(toChat(params)) }, timeout)) as Chat);
  }
  if (!key) throw new ModelError(401, 'there is no key to ask Anthropic with');
  return async ({ betas, ...body }) => (await send(f, `${ANTHROPIC}/v1/messages`, { method: 'POST', headers: anthropicHeaders(key, betas), body: JSON.stringify(body) }, timeout)) as Answer;
}

/** Whether a key is taken, asked by listing the models: it costs nothing. Undefined when the endpoint could not be reached to ask. */
export async function keyTaken(key: string, at: Endpoint = configured(), f: Fetch = fetch): Promise<boolean | undefined> {
  const [url, headers] = at.url ? [`${at.url}/models`, bearer(key)] : [`${ANTHROPIC}/v1/models?limit=1`, anthropicHeaders(key)];
  try {
    const res = await f(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) return false;
    return res.ok ? true : undefined;
  } catch {
    return undefined;
  }
}

/** Who answers, in a word or two, for what the owner is told. */
export const provider = (at: Endpoint = configured()): string => (at.url ? 'The model server' : 'Anthropic');
