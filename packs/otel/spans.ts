/**
 * The otel pack's rules, apart from the runtime: exchange events in, OTLP
 * spans out (OTLP/HTTP JSON, `opentelemetry/proto/trace/v1`). Nothing here
 * sends anything.
 *
 * - A run is one span, `invoke_agent <agent>`, its trace id the run id when
 *   that is a UUID (a Claude Code session id is), else a hash of it.
 * - Each act is a child span: `execute_tool <tool>` for a tool call, else
 *   the act's kind. It starts when the map was last reached at its place
 *   (the says before a tool call), else when it was recorded.
 * - Says, refusals, gates and misses are events on the run span.
 * - The gen_ai.* semantic conventions name what they cover; the rest is
 *   `archipelago.*`.
 * - Without `content`, nothing the map or the agent wrote is sent: no said
 *   words, no tool input or output, no title, no folder, and a place only
 *   by its kind (`file`, not `file:<path>`), except a tool's name.
 */
import type { RunInfo } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";

/** The longest a sent text is, in letters; the rest is cut. */
export const TEXT_MAX = 4096;
/** The most events on one run span; the rest are counted as dropped. */
export const EVENTS_MAX = 128;

/** OTLP JSON's attribute value. Integers are strings, as proto3 JSON wants int64. */
export type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { boolValue: boolean }
  | { doubleValue: number }
  | { arrayValue: { values: AnyValue[] } };
export interface KeyValue {
  key: string;
  value: AnyValue;
}

export interface SpanEvent {
  timeUnixNano: string;
  name: string;
  attributes: KeyValue[];
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** 1: internal. */
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: KeyValue[];
  events?: SpanEvent[];
  droppedEventsCount?: number;
  links?: { traceId: string; spanId: string; attributes: KeyValue[] }[];
  /** code 1: ok, 2: error. */
  status?: { code: number; message?: string };
}

/** What a run's token use came to, from the transcript. */
export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  model?: string;
}

const value = (v: unknown): AnyValue | undefined => {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value).filter((x): x is AnyValue => !!x) } };
  return undefined;
};

/** Attributes from an object; undefined values are left out. */
export function attrs(o: Record<string, unknown>): KeyValue[] {
  const out: KeyValue[] = [];
  for (const [key, v] of Object.entries(o)) {
    const val = value(v);
    if (val) out.push({ key, value: val });
  }
  return out;
}

/** A time as OTLP wants it: nanoseconds since the epoch, as text. */
export const nanos = (time: string): string => {
  const ms = Date.parse(time);
  return Number.isFinite(ms) ? (BigInt(ms) * 1_000_000n).toString() : "0";
};

/** FNV-1a, 64 bits, as 16 hex: stable ids with no crypto, in Node or a page. */
function fnv(text: string, seed = 0xcbf29ce484222325n): string {
  let h = seed;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** A run's trace id: the run id itself when it is a UUID, else a hash. Never all zeros. */
export function traceOf(run: string): string {
  const hex = run.replace(/-/g, "").toLowerCase();
  if (/^[0-9a-f]{32}$/.test(hex) && !/^0+$/.test(hex)) return hex;
  return fnv(run) + fnv(run, 0x84222325cbf29ce4n);
}
/** The run span's id. */
export const runSpanOf = (run: string): string => fnv(`run:${run}`);
/** An act's span id: by its run and seq, so sending it again is the same span. */
export const actSpanOf = (run: string, seq: number): string => fnv(`act:${run}:${seq}`);

/** Text cut to TEXT_MAX; JSON for anything not text. */
export function textOf(v: Json | undefined): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) + "…" : s;
}

/** A place as it may be sent: whole with content, else its kind, but a tool's name stays. */
export function placeOf(place: string | undefined, content: boolean): string | undefined {
  if (!place) return undefined;
  if (content) return place;
  const i = place.indexOf(":");
  if (i < 0) return place;
  const kind = place.slice(0, i);
  return kind === "tool" || kind === "tool_result" ? place : kind;
}

/** The tool an act at `tool:<name>` called. */
export const toolOf = (place: string | undefined): string | undefined => (place?.startsWith("tool:") ? place.slice(5) : undefined);

/** What the agent is called: a subagent's type, else the harness. */
export const agentName = (info: RunInfo | undefined): string => {
  const t = info?.facts?.agent_type;
  return (Array.isArray(t) ? t[0] : t) ?? info?.harness ?? "agent";
};

/**
 * An act as a child span of its run's. `from` is when the map was last
 * reached at the act's place before it, if it was.
 */
export function actSpan(e: ExchangeEvent, content: boolean, from?: string): Span {
  const act = e.act!;
  const tool = act.kind === "tool" ? toolOf(e.place) : undefined;
  const failed = act.ok === false;
  return {
    traceId: traceOf(e.run),
    spanId: actSpanOf(e.run, e.seq),
    parentSpanId: runSpanOf(e.run),
    name: tool ? `execute_tool ${tool}` : act.kind,
    kind: 1,
    startTimeUnixNano: nanos(from && from <= e.time ? from : e.time),
    endTimeUnixNano: nanos(e.time),
    attributes: attrs({
      "gen_ai.operation.name": tool ? "execute_tool" : undefined,
      "gen_ai.tool.name": tool,
      "gen_ai.tool.type": tool ? (tool.startsWith("mcp__") ? "extension" : "function") : undefined,
      "gen_ai.conversation.id": e.run,
      "archipelago.act.kind": act.kind,
      "archipelago.act.by": act.by,
      "archipelago.act.ok": act.ok,
      "archipelago.place": placeOf(e.place, content),
      "archipelago.seq": e.seq,
      "error.type": failed ? (act.kind === "decision" ? "denied" : "tool_error") : undefined,
      ...(content
        ? {
            [tool ? "gen_ai.tool.call.arguments" : "archipelago.act.input"]: textOf(act.input),
            [tool ? "gen_ai.tool.call.result" : "archipelago.act.output"]: textOf(act.output),
          }
        : {}),
    }),
    ...(failed ? { status: { code: 2 } } : {}),
  };
}

/** A say, refusal, gate or miss, as an event on the run span. */
export function runEvent(e: ExchangeEvent, content: boolean): SpanEvent {
  return {
    timeUnixNano: nanos(e.time),
    name: `archipelago.${e.kind}`,
    attributes: attrs({
      "archipelago.node": e.node,
      "archipelago.pack": e.pack,
      "archipelago.place": placeOf(e.place, content),
      "archipelago.seq": e.seq,
      "archipelago.text": content ? textOf(e.text) : undefined,
    }),
  };
}

/** What the otel pack keeps of a run while it goes. */
export interface RunState {
  run: string;
  info?: RunInfo;
  start: string;
  last: string;
  events: SpanEvent[];
  dropped: number;
  count: Record<string, number>;
}

/** The run as its span, once it ended. */
export function runSpan(s: RunState, end: string, content: boolean, tokens?: Tokens): Span {
  const info = s.info;
  const parent = info?.facts?.parent ?? info?.parent;
  const parentRun = Array.isArray(parent) ? parent[0] : parent;
  const task = info?.facts?.task ?? info?.task;
  const name = agentName(info);
  return {
    traceId: traceOf(s.run),
    spanId: runSpanOf(s.run),
    name: `invoke_agent ${name}`,
    kind: 1,
    startTimeUnixNano: nanos(info?.started ?? s.start),
    endTimeUnixNano: nanos(end),
    attributes: attrs({
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": name,
      "gen_ai.agent.id": s.run,
      "gen_ai.conversation.id": s.run,
      ...(tokens
        ? {
            "gen_ai.response.model": tokens.model,
            // Input counts what was read from the cache and written to it too, as the conventions say.
            "gen_ai.usage.input_tokens": tokens.input + tokens.cacheRead + tokens.cacheWrite,
            "gen_ai.usage.output_tokens": tokens.output,
            "gen_ai.usage.cache_read.input_tokens": tokens.cacheRead,
            "gen_ai.usage.cache_creation.input_tokens": tokens.cacheWrite,
          }
        : {}),
      "archipelago.run": s.run,
      "archipelago.harness": info?.harness,
      "archipelago.parent": parentRun,
      "archipelago.task": Array.isArray(task) ? task[0] : task,
      "archipelago.acts": s.count.act ?? 0,
      "archipelago.says": s.count.say ?? 0,
      "archipelago.refusals": s.count.refuse ?? 0,
      ...(content ? { "archipelago.title": info?.title, "archipelago.cwd": info?.cwd } : {}),
    }),
    events: s.events,
    ...(s.dropped ? { droppedEventsCount: s.dropped } : {}),
    ...(parentRun ? { links: [{ traceId: traceOf(parentRun), spanId: runSpanOf(parentRun), attributes: attrs({ "archipelago.link": "parent" }) }] } : {}),
  };
}

/** Spans as one OTLP/HTTP JSON export request. */
export function request(spans: Span[], service: string): Json {
  return {
    resourceSpans: [
      {
        resource: { attributes: attrs({ "service.name": service, "telemetry.sdk.name": "archipelago", "telemetry.sdk.language": "nodejs" }) },
        scopeSpans: [{ scope: { name: "archipelago.otel", version: "1" }, spans }],
      },
    ],
  } as unknown as Json;
}

/** Where traces go: the endpoint as given when it names `/v1/traces`, else that path under it. */
export function tracesUrl(endpoint: string): string {
  const u = new URL(endpoint);
  if (!u.pathname.endsWith("/v1/traces")) u.pathname = u.pathname.replace(/\/$/, "") + "/v1/traces";
  return u.href;
}

/** The endpoint as people may see it: no credentials, no query. */
export function shownUrl(endpoint: string): string {
  const u = new URL(tracesUrl(endpoint));
  return `${u.protocol}//${u.host}${u.pathname}`;
}
