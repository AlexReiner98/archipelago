/**
 * The conversation, as pure parts: everything in the window after what the
 * agent was given at the start (read.ts). A person's prompts, Claude's
 * replies and thinking, each tool's calls and results, a compaction's
 * summary, and the notes Claude Code adds along the way (project
 * instructions, the date, reminders, files it attaches), each a node at a
 * place, like the starting context.
 *
 * | Node | At | By |
 * |---|---|---|
 * | `talk:prompt` | prompt | you |
 * | `talk:reply`, `talk:thinking` | reply_end | Claude |
 * | `talk:call:<tool>` | tool:<tool> | Claude |
 * | `talk:result:<tool>` | tool_result:<tool> | the tool's own: Claude Code or its MCP server |
 * | `talk:summary` | compact | Claude Code |
 * | `talk:note:<type>` | prompt | Claude Code |
 *
 * Each piece keeps its time and size, never its text: so the nodes can be
 * counted as of a moment, and what came before the last compaction told
 * apart from what is in the window now. The text is read again from the
 * file when asked for (the latest SPOTS_MAX pieces).
 *
 * Sizes are estimates: characters / 4, and an image by its pixels (the
 * model's rule, width × height / 750, once scaled to fit). Thinking is the
 * exception: the transcript keeps only its signature, not its text, so a
 * message's thinking is its real `output_tokens` less what its reply and
 * tool calls are estimated at. And what reaches the model between two of
 * its messages (tool results, prompts, notes, hooks' words) is scaled to
 * the window's real growth between them: the next request's input less the
 * last one's input and output. So the conversation sums to the model's own
 * count, but for the estimate of its replies and calls.
 */
import type { Place } from "../../spec/agent.ts";
import type { Slim, SlimBlock } from "../claude-code/slim.ts";

// An image is counted where it is, by the hook (its pixels): these stay for who read them here.
export { IMAGE_TOKENS, imageTokens } from "../claude-code/slim.ts";

/** The session's own context: counted by its size, never read. */
const PRIVATE_NOTES = ["session_context", "environment", "credential_org"];
/** Attachments read.ts indexes as given: not counted again here. */
const GIVEN_NOTES = ["skill_listing", "agent_listing_delta", "deferred_tools_delta", "model", "mcp_instructions_delta", "hook_additional_context"];
/** How many pieces' places one node keeps, for its text; the latest win. */
const SPOTS_MAX = 20;

/** Which part of a record a piece of the conversation is. */
export type TalkPick = { part: "block"; index: number } | { part: "content" } | { part: "rendered" };

export interface TalkSpot {
  offset: number;
  length: number;
  pick: TalkPick;
}

/** A node of the conversation, as of a moment. */
export interface Talk {
  name: string;
  title: string;
  by: string;
  at: Place;
  /** How many pieces by then. */
  count: number;
  /** Characters by then. */
  size: number;
  /** Tokens by then, an estimate. */
  tokens: number;
  /** Of those, in the window: after the last compaction. */
  window: number;
  /** Of `tokens` and of `window`, how many are fitted to the model's real counts; the rest are estimates. */
  fitted: number;
  fittedWindow: number;
  first?: string;
  last?: string;
  /** Read by its size alone: its text is never shown. */
  private?: true;
}

interface Piece {
  t: number;
  time?: string;
  chars: number;
  tokens: number;
  /** Fitted to the model's real counts (a message's output, the window's growth), not only characters / 4. */
  fit?: true;
}

interface Entry {
  name: string;
  title: string;
  by: string;
  at: Place;
  pieces: Piece[];
  spots: TalkSpot[];
  private?: true;
}

export const textTokens = (chars: number) => Math.ceil(Math.max(0, chars) / 4);

/** Characters, and their tokens. */
const chars = (n: number) => ({ chars: n, tokens: textTokens(n) });
/** Blocks' characters and tokens, an image by its own. */
function blocks(list: SlimBlock[]): { chars: number; tokens: number } {
  let c = 0;
  let t = 0;
  for (const b of list) {
    const n = "n" in b ? b.n : 0;
    c += n;
    t += textTokens(n) + ("img" in b ? b.img : 0);
  }
  return { chars: c, tokens: t };
}

const toolBy = (name: string) => /^mcp__(.+?)__/.exec(name)?.[1] ?? "Claude Code";
const toolShort = (name: string) => /^mcp__.+?__(.+)$/.exec(name)?.[1] ?? name;
const ms = (t: string | undefined) => (t ? Date.parse(t) : NaN);

/** How many tool calls' names are kept, to name their results. */
const CALLS_MAX = 5000;

/**
 * The conversation, built record by record. `take` takes each parsed
 * record; `rows` answers its nodes as of a moment.
 */
export class TalkIndex {
  private entries = new Map<string, Entry>();
  /** A tool call's id to its tool's name, to name what it returned. */
  private calls = new Map<string, string>();
  /** Each of the model's messages, by id: its real output, what its other blocks are estimated at, its thinking pieces. */
  private messages = new Map<string, { output: number; other: number; thinking: Piece[]; input?: number }>();
  /** What reached the model since its last message: pieces to scale to the real growth, and given words (hooks, listings) counted in it. */
  private pending: Piece[] = [];
  private pendingGiven = 0;
  private lastMessage: string | undefined;
  /** The model's first message: its real input, and what of it was given words and the conversation (estimates), to scale the start by. */
  first?: { time?: string; input: number; given: number; talk: number };

  private time: string | undefined;

  /** A record as numbers (slim, packs/claude-code/slim.ts), at its place in the file. */
  take(e: Slim, line: { offset: number; length: number }): void {
    const time = e.timestamp;
    this.time = time;
    const spot = (pick: TalkPick): TalkSpot => ({ offset: line.offset, length: line.length, pick });
    const add = (name: string, make: () => Omit<Entry, "pieces" | "spots">, m: { chars: number; tokens: number }, s: TalkSpot | undefined, always = false): Piece | undefined => {
      if (!always && m.chars <= 0 && m.tokens <= 0) return undefined;
      const entry = this.entries.get(name) ?? { ...make(), pieces: [], spots: [] };
      const piece: Piece = { t: ms(time), ...(time ? { time } : {}), ...m };
      entry.pieces.push(piece);
      // What reached the model, not what it said: scaled to the window's real growth at its next message.
      if (e.type !== "assistant") this.pending.push(piece);
      if (s) {
        entry.spots.push(s);
        if (entry.spots.length > SPOTS_MAX) entry.spots.shift();
      }
      this.entries.set(name, entry);
      return piece;
    };

    if (e.type === "system" && e.subtype === "compact_boundary") {
      // A new window: the next request's input is a new base.
      this.lastMessage = undefined;
      this.pending = [];
      this.pendingGiven = 0;
      return;
    }

    if (e.type === "assistant" && e.message?.content) {
      const m = e.message;
      const id = m.id;
      if (id && !this.messages.has(id)) this.calibrate(m.usage, id);
      const msg = id ? (this.messages.get(id) ?? (this.messages.set(id, { output: 0, other: 0, thinking: [] }), this.messages.get(id)!)) : undefined;
      if (this.messages.size > CALLS_MAX) this.messages.delete(this.messages.keys().next().value!);
      const other = (x: { chars: number; tokens: number }) => (msg && (msg.other += x.tokens), x);
      m.content!.forEach((b, index) => {
        if (b.type === "text") add("talk:reply", () => ({ name: "talk:reply", title: "Claude's replies", by: "Claude", at: "reply_end" }), other(chars(b.n)), spot({ part: "block", index }));
        else if (b.type === "thinking" || b.type === "redacted_thinking") {
          const piece = add("talk:thinking", () => ({ name: "talk:thinking", title: "Claude's thinking", by: "Claude", at: "reply_end" }), chars(b.type === "thinking" ? b.n : 0), spot({ part: "block", index }), true);
          if (piece && msg) msg.thinking.push(piece);
        } else if (b.type === "tool_use") {
          if (b.id) {
            this.calls.set(b.id, b.name);
            if (this.calls.size > CALLS_MAX) this.calls.delete(this.calls.keys().next().value!);
          }
          const name = `talk:call:${b.name}`;
          add(name, () => ({ name, title: `${toolShort(b.name)} calls`, by: "Claude", at: `tool:${b.name}` }), other(chars(b.n)), spot({ part: "block", index }));
        }
      });
      // The message's real output, less its other blocks: its thinking, shared among its thinking blocks.
      const out = m.usage?.output_tokens;
      if (msg && typeof out === "number" && out >= 0) msg.output = out;
      if (msg?.thinking.length) {
        const share = Math.max(0, msg.output - msg.other) / msg.thinking.length;
        if (msg.output > 0) for (const p of msg.thinking) Object.assign(p, { tokens: Math.max(textTokens(p.chars), Math.round(share)), fit: true });
      }
      return;
    }

    if (e.type === "user" && e.message) {
      const m = e.message;
      if (e.isCompactSummary) {
        add("talk:summary", () => ({ name: "talk:summary", title: "Compaction summary", by: "Claude Code", at: "compact" }), m.str !== undefined ? chars(m.str) : blocks(m.content ?? []), spot(m.str !== undefined ? { part: "content" } : { part: "block", index: 0 }));
        return;
      }
      const prompt = () => (e.isMeta ? { name: "talk:note:meta", title: "Claude Code's notes", by: "Claude Code", at: "prompt" } : { name: "talk:prompt", title: "Your prompts", by: "you", at: "prompt" });
      if (m.str !== undefined) {
        const p = prompt();
        add(p.name, () => p, chars(m.str), spot({ part: "content" }));
        return;
      }
      (m.content ?? []).forEach((b, index) => {
        if (b.type === "tool_result") {
          const tool = (b.tool_use_id && this.calls.get(b.tool_use_id)) || "unknown";
          const name = `talk:result:${tool}`;
          add(name, () => ({ name, title: `${toolShort(tool)} results`, by: toolBy(tool), at: `tool_result:${tool}` }), { chars: b.n, tokens: textTokens(b.n) + b.img }, spot({ part: "block", index }));
        } else {
          const p = prompt();
          add(p.name, () => p, b.type === "image" ? { chars: 0, tokens: b.img } : chars("n" in b ? b.n : 0), spot({ part: "block", index }));
        }
      });
      return;
    }

    // A note Claude Code attached, as the model was sent it (`rendered`).
    if (e.type === "attachment" && e.attachment && e.rendered !== undefined) {
      const type = e.attachment.type;
      const n = e.rendered;
      if (GIVEN_NOTES.includes(type)) {
        this.pendingGiven += textTokens(n);
        return;
      }
      if (PRIVATE_NOTES.includes(type)) {
        add("talk:note:private", () => ({ name: "talk:note:private", title: "Session context (private)", by: "Claude Code", at: "session_start", private: true }), chars(n), undefined);
        return;
      }
      if (type === "queued_command") {
        add("talk:prompt", () => ({ name: "talk:prompt", title: "Your prompts", by: "you", at: "prompt" }), chars(n), spot({ part: "rendered" }));
        return;
      }
      const name = `talk:note:${type}`;
      add(name, () => ({ name, title: `${type.replaceAll("_", " ")} notes`, by: "Claude Code", at: type === "instructions" ? "session_start" : "prompt" }), chars(n), spot({ part: "rendered" }));
    }
  }

  /**
   * A new message of the model's, with its usage: the window grew from the
   * last message's input and output to this one's input. What reached it
   * in between is scaled to that growth, given words included in the sum
   * (they stay estimates), within a factor of four either way.
   */
  private calibrate(usage: any, id: string) {
    const input = usage && typeof usage === "object" ? ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].reduce((n, k) => n + (typeof usage[k] === "number" ? usage[k] : 0), 0) : undefined;
    const last = this.lastMessage ? this.messages.get(this.lastMessage) : undefined;
    if (input !== undefined && !this.first) this.first = { ...(this.time ? { time: this.time } : {}), input, given: this.pendingGiven, talk: this.pending.reduce((n, p) => n + p.tokens, 0) };
    if (input !== undefined && last?.input !== undefined) {
      const grew = input - (last.input + last.output);
      const est = this.pending.reduce((n, p) => n + p.tokens, 0);
      if (grew > 0 && est > 0) {
        const f = Math.min(4, Math.max(0.25, (grew - this.pendingGiven) / est));
        for (const p of this.pending) Object.assign(p, { tokens: Math.round(p.tokens * f), fit: true });
      }
    }
    this.pending = [];
    this.pendingGiven = 0;
    this.messages.set(id, { output: 0, other: 0, thinking: [], ...(input !== undefined ? { input } : {}) });
    if (input !== undefined) this.lastMessage = id;
  }

  /** The nodes as of `until` (ms; NaN: the end), with what came after `cut` (the last compaction by then) in the window. */
  rows(until = NaN, cut = -Infinity): Talk[] {
    const out: Talk[] = [];
    for (const e of this.entries.values()) {
      let count = 0;
      let size = 0;
      let tokens = 0;
      let window = 0;
      let fitted = 0;
      let fittedWindow = 0;
      let first: string | undefined;
      let last: string | undefined;
      for (const p of e.pieces) {
        if (!Number.isNaN(until) && !Number.isNaN(p.t) && p.t > until) continue;
        count++;
        size += p.chars;
        tokens += p.tokens;
        if (p.fit) fitted += p.tokens;
        if (Number.isNaN(p.t) || p.t >= cut) {
          window += p.tokens;
          if (p.fit) fittedWindow += p.tokens;
        }
        first ??= p.time;
        last = p.time ?? last;
      }
      if (!count) continue;
      out.push({ name: e.name, title: e.title, by: e.by, at: e.at, count, size, tokens, window, fitted, fittedWindow, ...(first ? { first } : {}), ...(last ? { last } : {}), ...(e.private ? { private: true as const } : {}) });
    }
    return out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  }

  /** Each piece of a node, in order: its time and tokens, numbers only. */
  piecesOf(name: string): readonly { time?: string; chars: number; tokens: number; fit?: true }[] {
    return this.entries.get(name)?.pieces ?? [];
  }

  spots(name: string): TalkSpot[] {
    return this.entries.get(name)?.spots ?? [];
  }
}

/** A piece's text, from its record: what a spot points at. Images and private notes are named, not shown. */
export function talkOf(e: any, pick: TalkPick): string | undefined {
  if (pick.part === "rendered") return Array.isArray(e?.rendered) ? e.rendered.map((r: any) => (typeof r?.content === "string" ? r.content : "")).join("") : undefined;
  const c = e?.message?.content;
  if (pick.part === "content") return typeof c === "string" ? c : undefined;
  const b = Array.isArray(c) ? c[pick.index] : undefined;
  if (!b) return undefined;
  if (b.type === "text") return b.text;
  if (b.type === "thinking") return b.thinking || "(thinking, not kept in the transcript)";
  if (b.type === "redacted_thinking") return "(thinking, redacted)";
  if (b.type === "image") return "[image]";
  if (b.type === "tool_use") return `${b.name}\n${JSON.stringify(b.input ?? {}, null, 2)}`;
  if (b.type === "tool_result") {
    const r = b.content;
    const text = typeof r === "string" ? r : Array.isArray(r) ? r.map((x: any) => (x?.type === "image" ? "[image]" : typeof x?.text === "string" ? x.text : "")).join("\n") : "";
    return b.is_error ? `(error) ${text}` : text;
  }
  return undefined;
}
