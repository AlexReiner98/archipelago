/**
 * What is in a run's window at a moment, as pure parts: from the run's
 * events (what the map said, what the agent did), what Claude Code gave it
 * (the transcript pack's nodes), and its token use and compactions.
 *
 * Each part has a source (the map, Claude Code, the agent), a channel (how
 * it reaches the agent, as the context interface shapes its dots, or `act`
 * for what the agent did), a size in tokens and a state:
 *
 * | State | Means |
 * |---|---|
 * | `start` | given at the start, and with every request since: the system prompt, tool definitions, MCP instructions, the model |
 * | `said` | said (or done) since the last compaction: in the window now |
 * | `listed` | only named in a listing: the skill or tool itself loads when it is used |
 * | `dropped` | said before the last compaction, and not said again since: gone from the window |
 *
 * The conversation after the start (the transcript pack's `talk:*` nodes:
 * prompts, replies, thinking, tool calls and results, notes) is the agent's
 * source and the `talk` channel; its in-window share is what came after
 * the last compaction. With it, the run's own acts aren't counted again.
 *
 * How sure each number is: the total is measured (the model's usage) or
 * estimated; each part's `fitted` tokens are shared out from the model's
 * real counts (the transcript pack's calibration), the rest of it is
 * estimated at characters / 4; so are the shares (`fitted` by source and
 * channel). What isn't counted apart is measured less the rest.
 *
 * Sizes are characters / 4, an estimate (`from: "estimate"`); the total is
 * the latest message's real token use (`from: "usage"`) when the transcript
 * has it, else the sum of what is in the window.
 */
import type { NodeInfo } from "../../spec/agent.ts";
import { channelOf, type Channel } from "../harness/channels.ts";

/** `subject`: a call's own context, from the pack that made the call (its type and size, never its text). */
export type Source = "map" | "harness" | "agent" | "subject";
export type PartChannel = Channel | "act";
export type State = "start" | "said" | "listed" | "dropped";

/** What the pack keeps of an event: no text, only its size. */
export interface Ev {
  seq: number;
  id: string;
  time: string;
  kind: string;
  node?: string;
  place?: string;
  /** Characters it put in the window: a say's or refusal's words, an act's input and output. */
  size: number;
  /** A call's subject: the domain's own context, by its type and tokens. */
  subject?: { type: string; tokens: number };
  /** The model's own count, from a call's answer. */
  usage?: { input: number; output: number; model?: string };
}

/** A row of `transcript.given`. */
export interface GivenRow {
  name: string;
  title: string;
  by: string;
  at: string;
  count: number;
  size: number;
  first?: string;
  last?: string;
  /** Tokens, when the transcript pack knows better than characters / 4: the start scaled to the first real input; the conversation's by then, and of those, after the last compaction. */
  tokens?: number;
  window?: number;
  /** Of `tokens` and of `window`, fitted to the model's real counts. */
  fitted?: number;
  fittedWindow?: number;
}

/** A row of `transcript.tokens` of kind usage. */
export interface UsageRow {
  n: number;
  time?: string;
  model?: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface CompactRow {
  n: number;
  time?: string;
  trigger?: string;
  pre?: number;
  post?: number;
  dropped?: number;
}

export interface Part {
  /** The tree's id for it: the map's node id, `transcript/<run>#<name>` for Claude Code's, `act:<place>` for the agent's acts. */
  id: string;
  title: string;
  source: Source;
  channel: PartChannel;
  state: State;
  /** Tokens, characters / 4. For `dropped`, what went. */
  tokens: number;
  /** How many times it was said, given or done. */
  count: number;
  /** Of its tokens, how many are fitted to the model's real counts; the rest are estimated. */
  fitted: number;
}

export interface Window {
  run: string;
  /** The event the window is at, or none: the run's end. */
  at?: string;
  time?: string;
  /** Tokens in the window, and where the number is from: the model's own usage, or the parts summed. */
  total: { tokens: number; from: "usage" | "estimate" };
  /** The window's size, and how it is known: from the model's name, from more seen in it than the usual size, or the usual size. */
  limit: { tokens: number; from: "model" | "seen" | "default" };
  /** The model the latest usage names. */
  model?: string;
  /** Compactions by then, and the last one's numbers. */
  compactions: number;
  compacted?: { time?: string; trigger?: string; pre?: number; post?: number };
  /** In the window (not dropped), by source and by channel, in tokens. */
  sources: Record<Source, number>;
  channels: Record<PartChannel, number>;
  /** Of those, fitted to the model's real counts. */
  fitted: { sources: Record<Source, number>; channels: Record<PartChannel, number> };
  /** Usage over what the parts account for: prompts, replies and results not counted apart. Only with real usage. */
  unseen: number;
  parts: Part[];
}

/** The window most models have. */
export const DEFAULT_LIMIT = 200_000;
/** The long window. */
export const LONG_LIMIT = 1_000_000;

/** Characters to tokens: the usual rough rule. */
export const tokensOf = (chars: number) => Math.ceil(Math.max(0, chars) / 4);

/** The window's size, from the model's name and what was seen in it. */
export function limitOf(model: string | undefined, seen: number): Window["limit"] {
  if (model && (/\[1m\]/i.test(model) || /^claude-(opus|sonnet|fable)-5/.test(model))) return { tokens: LONG_LIMIT, from: "model" };
  if (seen > DEFAULT_LIMIT) return { tokens: LONG_LIMIT, from: "seen" };
  return { tokens: DEFAULT_LIMIT, from: "default" };
}

const LISTINGS = new Set(["skills", "agents", "deferred"]);
const ms = (t: string | undefined) => (t ? Date.parse(t) : NaN);

export interface WindowInput {
  run: string;
  /** The run's events, in order; only those up to `at` count. */
  events: Ev[];
  /** The event the window is at; absent, the last. */
  at?: string;
  given: GivenRow[];
  /** The latest usage by then, and the most seen in the run by then. */
  usage?: UsageRow;
  seen?: number;
  /** Compactions by then, in order. Without a transcript, the run's own `compact` events stand in. */
  compactions?: CompactRow[];
  /** The map's nodes now, for titles and channels. */
  nodes: NodeInfo[];
}

/** What is in the window at `at`. */
export function windowAt(p: WindowInput): Window {
  const end = p.at ? p.events.findIndex((e) => e.id === p.at) : p.events.length - 1;
  const upTo = end < 0 ? p.events : p.events.slice(0, end + 1);
  const at = upTo[upTo.length - 1];
  const now = at ? ms(at.time) : NaN;
  const by = (t: string | undefined) => Number.isNaN(now) || Number.isNaN(ms(t)) || ms(t) <= now;
  const compactions: CompactRow[] = (p.compactions ?? upTo.filter((e) => e.kind === "compact").map((e, i): CompactRow => ({ n: i + 1, time: e.time }))).filter((c) => by(c.time));
  const last = compactions[compactions.length - 1];
  const cut = last ? ms(last.time) : -Infinity;
  const after = (t: string | undefined) => !last || Number.isNaN(ms(t)) || ms(t) > cut;
  const info = new Map(p.nodes.map((n) => [n.id, n]));
  const parts: Part[] = [];

  // The map's nodes said (or refused with): in the window since the last compaction, else dropped.
  const said = new Map<string, { in: number; out: number; nIn: number; nOut: number; place?: string }>();
  for (const e of upTo) {
    if ((e.kind !== "say" && e.kind !== "refuse") || !e.node) continue;
    const s = said.get(e.node) ?? { in: 0, out: 0, nIn: 0, nOut: 0, ...(e.place ? { place: e.place } : {}) };
    // Tokens a say at a time, as the node's history counts them (trend.ts).
    if (after(e.time)) (s.in += tokensOf(e.size)), s.nIn++;
    else (s.out += tokensOf(e.size)), s.nOut++;
    said.set(e.node, s);
  }
  for (const [id, s] of said) {
    const n = info.get(id);
    const channel = n ? channelOf(n) : e2channel(s.place);
    const title = n?.title ?? id;
    parts.push(s.nIn ? { id, title, source: "map", channel, state: "said", tokens: s.in, count: s.nIn, fitted: 0 } : { id, title, source: "map", channel, state: "dropped", tokens: s.out, count: s.nOut, fitted: 0 });
  }
  // A skill of the map's never loaded: only its name, in Claude Code's skill listing.
  if (p.given.some((g) => g.name === "skills" && by(g.first)))
    for (const n of p.nodes)
      if (!said.has(n.id) && n.kind === "skill") parts.push({ id: n.id, title: n.title ?? n.id, source: "map", channel: "file", state: "listed", tokens: tokensOf((n.title ?? n.name).length + 4), count: 1, fitted: 0 });

  // What Claude Code gave: from the start, a listing, or a hook's words, said or dropped.
  for (const g of p.given) {
    if (!by(g.first) || g.name.startsWith("talk:")) continue;
    const id = `transcript/${p.run}#${g.name}`;
    const hook = g.name.startsWith("hook:");
    const state: State = hook ? (after(g.last) ? "said" : "dropped") : LISTINGS.has(g.name) ? "listed" : "start";
    parts.push({ id, title: g.title, source: "harness", channel: hook ? "hook" : "context", state, tokens: g.tokens ?? tokensOf(g.size), count: g.count, fitted: g.fitted ?? 0 });
  }

  // The conversation: what is after the last compaction is in the window; what came before, dropped.
  const talk = p.given.filter((g) => g.name.startsWith("talk:") && by(g.first));
  for (const g of talk) {
    const id = `transcript/${p.run}#${g.name}`;
    const all = g.tokens ?? tokensOf(g.size);
    const inside = g.window ?? all;
    const base = { title: g.title, source: "agent" as const, channel: "talk" as const, count: g.count };
    const fitIn = g.fittedWindow ?? 0;
    if (inside > 0) parts.push({ id, ...base, state: "said", tokens: inside, fitted: fitIn });
    if (all - inside > 0) parts.push({ id: inside > 0 ? `${id}#dropped` : id, ...base, state: "dropped", tokens: all - inside, fitted: Math.max(0, (g.fitted ?? 0) - fitIn) });
  }

  // What the agent did, by place, as the run's events have it: only without the conversation, which holds it.
  const acts = new Map<string, { in: number; out: number; nIn: number; nOut: number }>();
  for (const e of upTo) {
    if (e.kind !== "act" || talk.length) continue;
    const place = e.place ?? "run";
    const a = acts.get(place) ?? { in: 0, out: 0, nIn: 0, nOut: 0 };
    if (after(e.time)) (a.in += e.size), a.nIn++;
    else (a.out += e.size), a.nOut++;
    acts.set(place, a);
  }
  for (const [place, a] of acts) {
    const id = `act:${place}`;
    if (a.nIn) parts.push({ id, title: place, source: "agent", channel: "act", state: "said", tokens: tokensOf(a.in), count: a.nIn, fitted: 0 });
    if (a.nOut) parts.push({ id: `${id}#dropped`, title: place, source: "agent", channel: "act", state: "dropped", tokens: tokensOf(a.out), count: a.nOut, fitted: 0 });
  }

  // A call's subject: the domain's own context in the request, by its type, in the window from then on.
  const subjects = new Map<string, { tokens: number; count: number }>();
  for (const e of upTo) {
    if (!e.subject) continue;
    const s = subjects.get(e.subject.type) ?? { tokens: 0, count: 0 };
    s.tokens += e.subject.tokens;
    s.count++;
    subjects.set(e.subject.type, s);
  }
  for (const [type, s] of subjects) parts.push({ id: `subject:${type}`, title: type, source: "subject", channel: "context", state: "said", tokens: s.tokens, count: s.count, fitted: 0 });

  parts.sort((x, y) => y.tokens - x.tokens || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const sources: Record<Source, number> = { map: 0, harness: 0, agent: 0, subject: 0 };
  const channels: Record<PartChannel, number> = { hook: 0, rule: 0, file: 0, context: 0, talk: 0, act: 0 };
  const fitted = { sources: { map: 0, harness: 0, agent: 0, subject: 0 } as Record<Source, number>, channels: { hook: 0, rule: 0, file: 0, context: 0, talk: 0, act: 0 } as Record<PartChannel, number> };
  let counted = 0;
  for (const x of parts) {
    if (x.state === "dropped") continue;
    sources[x.source] += x.tokens;
    channels[x.channel] += x.tokens;
    fitted.sources[x.source] += x.fitted;
    fitted.channels[x.channel] += x.fitted;
    counted += x.tokens;
  }
  // The total: the model's own count when there is one since the last compaction, else what a compaction left, else the parts.
  // Without a transcript, a call's answer may carry the model's own count.
  const callUsage = [...upTo].reverse().find((e) => e.usage)?.usage;
  const given = p.usage ?? (callUsage ? { n: 0, input: callUsage.input, cacheRead: 0, cacheWrite: 0, output: callUsage.output, ...(callUsage.model ? { model: callUsage.model } : {}), ...(at ? { time: at.time } : {}) } : undefined);
  const usage = given && (!last || Number.isNaN(ms(given.time)) || ms(given.time) >= cut) ? given : undefined;
  const real = usage ? usage.input + usage.cacheRead + usage.cacheWrite + usage.output : last?.post;
  const total = real !== undefined ? { tokens: real, from: "usage" as const } : { tokens: counted, from: "estimate" as const };
  const model = given?.model;
  return {
    run: p.run,
    ...(at && p.at ? { at: at.id } : {}),
    ...(at ? { time: at.time } : {}),
    total,
    limit: limitOf(model, Math.max(p.seen ?? 0, total.tokens, ...compactions.map((c) => c.pre ?? 0))),
    ...(model ? { model } : {}),
    compactions: compactions.length,
    ...(last ? { compacted: { ...(last.time ? { time: last.time } : {}), ...(last.trigger ? { trigger: last.trigger } : {}), ...(last.pre !== undefined ? { pre: last.pre } : {}), ...(last.post !== undefined ? { post: last.post } : {}) } } : {}),
    sources,
    channels,
    fitted,
    unseen: total.from === "usage" ? Math.max(0, total.tokens - counted) : 0,
    parts,
  };
}

/** A node no longer loaded: its channel by its place alone. */
function e2channel(place: string | undefined): Channel {
  return place?.startsWith("skill:") || place?.startsWith("memory:") ? "file" : "hook";
}
