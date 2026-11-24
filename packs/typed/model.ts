/**
 * A model, as a typed call asks it: `{ system, messages, schema }` in,
 * parsed JSON (or the text it could not parse) and usage out. Any provider
 * fits behind it. A provider's own strict mode is only an optimization: the
 * subsets of JSON Schema they take differ, and the typed call checks every
 * reply itself (`schema.check`), so an adapter that can only return text
 * is enough.
 *
 * - `anthropic`: the Messages API, the schema as a forced tool's input.
 * - `openai`: any OpenAI-compatible chat completions endpoint (OpenAI,
 *   Gemini's and Ollama's compatible endpoints, a gateway), the schema as
 *   `response_format`, strict or not, or JSON mode with the schema said.
 * - `command`: any program that reads a prompt on stdin and writes text,
 *   the JSON parsed out of the text (`jsonIn`). `claude -p` is one.
 * - `scripted`: answers given in advance, for tests and demos.
 *
 * No client library: each is one `fetch` or one process.
 */
import type { JsonSchema } from "../../spec/action.ts";
import { strictSubset } from "./shape.ts";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ModelAsk {
  system: string;
  messages: Message[];
  schema: JsonSchema;
  /** A name for the shape asked for (a type's name): some providers want one. */
  name: string;
}

export interface Usage {
  input: number;
  output: number;
  model?: string;
}

export interface ModelReply {
  /** The parsed reply. Absent: the model's words held no JSON. */
  json?: unknown;
  /** What the model said, as it said it. */
  text: string;
  usage?: Usage;
}

export interface Model {
  /** Which model this is, for the record: `anthropic:<model>`, `command:claude`. */
  id: string;
  ask(ask: ModelAsk): Promise<ModelReply>;
}

/**
 * The JSON in a model's words: all of it, else a fenced block, else from
 * the first `{` or `[` to the last matching close. Undefined when none parses.
 */
export function jsonIn(text: string): unknown {
  const tryParse = (s: string) => {
    try {
      return { ok: true as const, v: JSON.parse(s) as unknown };
    } catch {
      return { ok: false as const };
    }
  };
  const whole = tryParse(text.trim());
  if (whole.ok) return whole.v;
  for (const m of text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)) {
    const p = tryParse(m[1]!.trim());
    if (p.ok) return p.v;
  }
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const a = text.indexOf(open);
    const b = text.lastIndexOf(close);
    if (a >= 0 && b > a) {
      const p = tryParse(text.slice(a, b + 1));
      if (p.ok) return p.v;
    }
  }
  return undefined;
}

/** A typed call as one text prompt, for a model that takes only text: the system, the schema, then the turns. */
export function textPrompt(ask: ModelAsk): string {
  const turns = ask.messages.map((m) => `${m.role === "user" ? "User" : "You answered"}:\n${m.content}`).join("\n\n");
  return `${ask.system}\n\nReply with only one JSON value, no other words, that matches this JSON Schema:\n${JSON.stringify(ask.schema)}\n\n${turns}`;
}

type Fetch = typeof globalThis.fetch;

async function post(fetcher: Fetch, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetcher(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} answered ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export interface AnthropicOptions {
  model: string;
  key: string;
  url?: string;
  maxTokens?: number;
  fetch?: Fetch;
}

/** The Messages API: the schema is a tool the model must call, its input the reply. */
export function anthropic(o: AnthropicOptions): Model {
  const url = o.url ?? "https://api.anthropic.com/v1/messages";
  return {
    id: `anthropic:${o.model}`,
    async ask(ask) {
      const tool = ask.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "reply";
      const r = await post(o.fetch ?? fetch, url, { "x-api-key": o.key, "anthropic-version": "2023-06-01" }, {
        model: o.model,
        max_tokens: o.maxTokens ?? 4096,
        system: ask.system,
        messages: ask.messages,
        tools: [{ name: tool, description: `Give the reply: ${String(ask.schema.description ?? ask.name)}`, input_schema: ask.schema }],
        tool_choice: { type: "tool", name: tool },
      });
      const blocks = (r.content ?? []) as { type: string; input?: unknown; text?: string }[];
      const use = blocks.find((b) => b.type === "tool_use");
      const words = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      const usage = r.usage ? { input: r.usage.input_tokens ?? 0, output: r.usage.output_tokens ?? 0, model: r.model ?? o.model } : undefined;
      if (use) return { json: use.input, text: JSON.stringify(use.input), ...(usage ? { usage } : {}) };
      return { json: jsonIn(words), text: words, ...(usage ? { usage } : {}) };
    },
  };
}

export interface OpenAIOptions {
  model: string;
  key?: string;
  /** The endpoint's base, `…/v1`. Default OpenAI's. */
  url?: string;
  /** `strict`: json_schema with strict (the schema made strict-shaped); `schema`: json_schema, not strict; `json`: JSON mode, the schema said in the system. Default `schema`. */
  mode?: "strict" | "schema" | "json";
  fetch?: Fetch;
}

/** Any OpenAI-compatible chat completions endpoint. */
export function openai(o: OpenAIOptions): Model {
  const base = (o.url ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const mode = o.mode ?? "schema";
  return {
    id: `openai:${o.model}`,
    async ask(ask) {
      const name = ask.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "reply";
      const format =
        mode === "json"
          ? { type: "json_object" }
          : { type: "json_schema", json_schema: { name, schema: mode === "strict" ? strictSubset(ask.schema) : ask.schema, strict: mode === "strict" } };
      const system = mode === "json" ? `${ask.system}\n\nReply with one JSON object matching this JSON Schema:\n${JSON.stringify(ask.schema)}` : ask.system;
      const r = await post(o.fetch ?? fetch, `${base}/chat/completions`, o.key ? { authorization: `Bearer ${o.key}` } : {}, {
        model: o.model,
        messages: [{ role: "system", content: system }, ...ask.messages],
        response_format: format,
      });
      const text = String(r.choices?.[0]?.message?.content ?? "");
      const usage = r.usage ? { input: r.usage.prompt_tokens ?? 0, output: r.usage.completion_tokens ?? 0, model: r.model ?? o.model } : undefined;
      return { json: jsonIn(text), text, ...(usage ? { usage } : {}) };
    },
  };
}

export interface CommandOptions {
  /** The program and its arguments. The prompt goes in on stdin. */
  command: string[];
  /** How to read what it writes: `text` (JSON in the words), or `claude-json` (`claude -p --output-format json`: its `result`, and its usage). Default `text`. */
  reply?: "text" | "claude-json";
  /** Where it runs. Default the system's temp folder, so no project's settings reach it. */
  cwd?: string;
  /** Milliseconds before it is stopped. Default 180000. */
  timeout?: number;
}

/** A command-line model: a prompt in on stdin, words out. */
export function command(o: CommandOptions): Model {
  const [prog, ...args] = o.command;
  if (!prog) throw new Error("A command model needs a program to run.");
  return {
    id: `command:${prog.split(/[\\/]/).pop()}`,
    async ask(ask) {
      const { spawn } = await import("node:child_process");
      const { tmpdir } = await import("node:os");
      const win = process.platform === "win32";
      // On Windows a program like `claude` is a .cmd shim, run through the shell: its arguments are quoted here.
      const q = (a: string) => (win ? `"${a.replace(/"/g, '\\"')}"` : a);
      const child = spawn(win ? q(prog) : prog, win ? args.map(q) : args, { cwd: o.cwd ?? tmpdir(), shell: win, stdio: ["pipe", "pipe", "pipe"], timeout: o.timeout ?? 180_000 });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      const done = new Promise<number>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? 1));
      });
      child.stdin.end(textPrompt(ask));
      const code = await done;
      if ((o.reply ?? "text") === "claude-json") {
        const r = jsonIn(out) as { result?: string; is_error?: boolean; usage?: Record<string, number>; modelUsage?: Record<string, unknown> } | undefined;
        if (!r || r.is_error) throw new Error(`${prog} failed: ${(r?.result ?? err ?? out).slice(0, 300)}`);
        const u = r.usage ?? {};
        const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        const model = Object.keys(r.modelUsage ?? {})[0];
        const text = String(r.result ?? "");
        return { json: jsonIn(text), text, usage: { input, output: u.output_tokens ?? 0, ...(model ? { model } : {}) } };
      }
      if (code !== 0) throw new Error(`${prog} exited ${code}: ${(err || out).slice(0, 300)}`);
      return { json: jsonIn(out), text: out };
    },
  };
}

/**
 * A stand-in model: each ask takes the next answer, a value (its JSON) or
 * a function of the ask. Past the last, it repeats the last.
 */
export function scripted(answers: (unknown | ((ask: ModelAsk, n: number) => unknown))[], id = "scripted"): Model & { asked: ModelAsk[] } {
  const asked: ModelAsk[] = [];
  return {
    id,
    asked,
    async ask(ask) {
      asked.push(structuredClone(ask));
      const n = asked.length - 1;
      const a = answers[Math.min(n, answers.length - 1)];
      const v = typeof a === "function" ? (a as (ask: ModelAsk, n: number) => unknown)(ask, n) : a;
      const text = typeof v === "string" ? v : JSON.stringify(v);
      return { json: typeof v === "string" ? jsonIn(v) : v, text, usage: { input: Math.ceil(textPrompt(ask).length / 4), output: Math.ceil(text.length / 4), model: id } };
    },
  };
}

/**
 * A model from config: an adapter's options with its `provider`. A key is
 * named by the environment variable holding it (`key_env`), never written
 * in config. Default variables: ANTHROPIC_API_KEY, OPENAI_API_KEY.
 */
export type ModelConfig =
  | { provider: "anthropic"; model: string; key_env?: string; url?: string; max_tokens?: number }
  | { provider: "openai"; model: string; key_env?: string; url?: string; mode?: "strict" | "schema" | "json" }
  | { provider: "command"; command: string[]; reply?: "text" | "claude-json"; cwd?: string; timeout?: number };

/** What `claude -p` takes to answer as a plain model: no tools, no project or user settings, no saved session. */
export const CLAUDE_CLI = ["claude", "-p", "--setting-sources", "local", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json", "--tools", ""];

/**
 * A model from config, or from a short spec: `anthropic:<model>`,
 * `openai:<model>` (OPENAI_BASE_URL for another endpoint), `claude` or
 * `claude:<model>` (the Claude Code CLI as a model). Undefined: none.
 */
export function modelOf(c: ModelConfig | string | undefined, env: Record<string, string | undefined> = process.env): Model | undefined {
  if (!c) return undefined;
  if (typeof c === "string") {
    const [provider, ...rest] = c.split(":");
    const model = rest.join(":");
    if (provider === "anthropic") return modelOf({ provider, model }, env);
    if (provider === "openai") return modelOf({ provider, model, ...(env.OPENAI_BASE_URL ? { url: env.OPENAI_BASE_URL } : {}) }, env);
    if (provider === "claude") return modelOf({ provider: "command", command: [...CLAUDE_CLI, ...(model ? ["--model", model] : [])], reply: "claude-json" }, env);
    throw new Error(`No model ${c}: anthropic:<model>, openai:<model> or claude[:<model>].`);
  }
  if (c.provider === "anthropic") {
    const key = env[c.key_env ?? "ANTHROPIC_API_KEY"];
    if (!key) throw new Error(`No key for ${c.model}: set ${c.key_env ?? "ANTHROPIC_API_KEY"}.`);
    return anthropic({ model: c.model, key, ...(c.url ? { url: c.url } : {}), ...(c.max_tokens ? { maxTokens: c.max_tokens } : {}) });
  }
  if (c.provider === "openai") {
    const key = env[c.key_env ?? "OPENAI_API_KEY"];
    return openai({ model: c.model, ...(key ? { key } : {}), ...(c.url ? { url: c.url } : {}), ...(c.mode ? { mode: c.mode } : {}) });
  }
  return command({ command: c.command, ...(c.reply ? { reply: c.reply } : {}), ...(c.cwd ? { cwd: c.cwd } : {}), ...(c.timeout ? { timeout: c.timeout } : {}) });
}
