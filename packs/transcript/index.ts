/**
 * The transcript pack: what Claude Code's transcript shows the agent was
 * given, beside what the map said. The system prompt, each tool's
 * definition, each MCP server's instructions, the skill, agent and deferred
 * tool listings, the model, and other hooks' context, each a read-only node
 * at a place, marked by who said it (read.ts).
 *
 * - Where: a run's `transcript` fact (the Claude Code adapter adds it from
 *   the hook's `transcript_path`), read from the run's `begin` events.
 * - Reading: a page at a time from a byte cursor, kept per run, so each
 *   call reads only what was added; a call reads at most PAGES pages.
 * - Nothing private is kept in the graph, or anywhere but memory: the index
 *   holds names, places and where each text is in the file; the text is
 *   read from the file when asked for, with email addresses taken out.
 * - The map's own words are left out: a hook context the adapter printed,
 *   or that holds what the map said in the run (its `say` events), is
 *   already in the tree as the map's nodes.
 *
 * The conversation after the start is nodes too (talk.ts): prompts,
 * replies, thinking, each tool's calls and results, notes, a compaction's
 * summary, `talk:*` by name, each with its tokens and how many of them are
 * in the window (after the last compaction).
 *
 * Three read-only actions, which write nothing:
 * - `transcript.given` ({ run, until?, after?, limit? }): a page of the
 *   nodes, by name, as of `until` (a time) when given.
 * - `transcript.text` ({ run, name }): one node's text.
 * - `transcript.pieces` ({ run, name, after?, limit? }): a page of one
 *   node's pieces in order (each time it was given or said: its time and
 *   tokens), and how it stays in the window.
 * - `transcript.tokens` ({ run, kind?, until?, after?, limit? }): a page of
 *   token use (each message's `usage`) and compactions, in order.
 *
 * Injects exchange.read and exchange.watch for the runs' facts and what the
 * map said, action.register for the two actions.
 */
import type { ActionRegister } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { GivenIndex, partOf, readLine, readPage, shown, tokensPage, type Given } from "./read.ts";
import { talkOf, type Talk } from "./talk.ts";

export const GIVEN = "transcript.given";
export const TEXT = "transcript.text";
export const TOKENS = "transcript.tokens";
export const PIECES = "transcript.pieces";
/** How a node stays in the window: given at the start (each request carries it), only named in a listing, or said at a moment (a compaction sums it up). */
export type Stays = "start" | "listed" | "said";
const LISTINGS = ["skills", "agents", "deferred"];
export const staysOf = (name: string): Stays => (name.startsWith("talk:") || name.startsWith("hook:") ? "said" : LISTINGS.includes(name) ? "listed" : "start");
/** The run fact naming its transcript (packs/claude-code). */
export const FACT = "transcript";
/** The most pages one call reads; the next call goes on from there. */
export const PAGES = 64;

const refuse = (code: string, message: string) => new Refused({ code, message, by: { pack: "transcript" } });

/** What the map said, by its start: enough to know its words inside a hook's context. */
const fingerprint = (text: string | undefined) => {
  const t = text?.trim();
  return t && t.length >= 20 ? t.slice(0, 80) : undefined;
};

interface RunState {
  path?: string;
  offset: number;
  index: GivenIndex;
  /** Whether the file was read to its end, at the last call. */
  done: boolean;
  /** What the map said in the run. */
  said: Set<string>;
  /** How far the run's events were read for what the map said. */
  events?: { after?: string; done: boolean };
  busy: Promise<unknown>;
}

/** A transcript path as a run's facts give it: a `.jsonl` file, absolute. */
export function transcriptOf(facts: Json | undefined): string | undefined {
  const v = facts && typeof facts === "object" && !Array.isArray(facts) ? (facts as Record<string, Json>)[FACT] : undefined;
  const p = Array.isArray(v) ? v[0] : v;
  return typeof p === "string" && /\.jsonl$/i.test(p) && (/^[a-z]:[\\/]/i.test(p) || p.startsWith("/")) ? p : undefined;
}

const transcript: Pack = {
  id: "transcript",
  about: "What Claude Code's transcript shows an agent was given (system prompt, tools, MCP instructions, listings, other hooks' context), as read-only nodes.",
  inject: ["exchange.read", "exchange.watch", "action.register"],
  apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const runs = new Map<string, RunState>();
    const stateOf = (run: string) => runs.get(run) ?? (runs.set(run, { offset: 0, index: new GivenIndex(), done: false, said: new Set(), busy: Promise.resolve() }), runs.get(run)!);

    const take = (s: RunState, e: ExchangeEvent) => {
      if (e.kind === "begin") {
        const p = transcriptOf((e.detail as { facts?: Json } | undefined)?.facts);
        if (p && p !== s.path) Object.assign(s, { path: p, offset: 0, index: new GivenIndex(), done: false });
      } else if (e.kind === "say") {
        const f = fingerprint(e.text);
        if (f) s.said.add(f);
      }
    };
    // Live: a run's begin names its transcript, and what the map says joins what it said.
    ctx.get<ExchangeWatch>("exchange.watch").watch({ kinds: ["begin", "say"] }, (e) => {
      const s = runs.get(e.run);
      if (s?.events) take(s, e);
    });

    /** Reads the run's events once, a page at a time: its transcript, and what the map said. */
    const learn = async (run: string, s: RunState) => {
      s.events ??= { done: false };
      for (let pages = 0; !s.events.done && pages < PAGES; pages++) {
        const page = await read.events(run, { limit: LIMIT_MAX, ...(s.events.after ? { after: s.events.after } : {}) });
        for (const e of page.items) take(s, e);
        if (page.next) s.events.after = page.next;
        else s.events.done = true;
      }
    };

    /** Reads what was added to the transcript since the last call, at most PAGES pages. */
    const sync = (run: string): Promise<RunState> => {
      const s = stateOf(run);
      const next = s.busy.then(async () => {
        await learn(run, s);
        if (!s.path) return s;
        s.done = false;
        for (let pages = 0; pages < PAGES; pages++) {
          const page = await readPage(s.path, s.offset);
          if (!page) break;
          for (const line of page.lines) s.index.add(line);
          const moved = page.next !== s.offset;
          s.offset = page.next;
          if (page.next >= page.size || !moved) {
            s.done = true;
            break;
          }
        }
        return s;
      });
      s.busy = next.catch(() => undefined);
      return next;
    };
    const ours = (s: RunState) => (text: string) => [...s.said].some((f) => text.includes(f));
    /**
     * What the start is scaled by: the model's first real input, less the given words and conversation that
     * reached it, over the start's estimate (system prompt, tools, MCP instructions, model), within 0.5 to 3.
     */
    const startScale = (s: RunState, list: Given[]) => {
      const first = s.index.talk.first;
      if (!first) return 1;
      const t0 = first.time ? Date.parse(first.time) : NaN;
      const est = list.filter((g) => staysOf(g.name) === "start" && (Number.isNaN(t0) || !g.first || Date.parse(g.first) <= t0)).reduce((n, g) => n + Math.ceil(g.size / 4), 0);
      const real = first.input - first.given - first.talk;
      return est > 0 && real > 0 ? Math.min(3, Math.max(0.5, real / est)) : 1;
    };
    /** Every node as of `until` (a time; absent, now): what was given, then the conversation. */
    const nodesOf = (s: RunState, until?: string): (Given | Talk)[] => {
      const t = until ? Date.parse(until) : NaN;
      let cut = -Infinity;
      for (const r of s.index.tokens.rows()) {
        const rt = r.time ? Date.parse(r.time) : NaN;
        if (r.kind === "compact" && !Number.isNaN(rt) && (Number.isNaN(t) || rt <= t)) cut = Math.max(cut, rt);
      }
      const list = s.index.list(ours(s));
      const f = startScale(s, list);
      const fit = !!s.index.talk.first;
      const given = list.map((g) => (staysOf(g.name) === "start" ? { ...g, tokens: Math.round(Math.ceil(g.size / 4) * f), ...(fit ? { fitted: Math.round(Math.ceil(g.size / 4) * f) } : {}) } : g));
      return [...given, ...s.index.talk.rows(t, cut)].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    };

    const reg = ctx.get<ActionRegister>("action.register");
    reg.register({
      name: GIVEN,
      title: "What Claude Code gave an agent, as read-only nodes",
      doc: "A page of the run's transcript nodes by name: name, title, by (who said it), at (its place), count, size, first, last. The conversation's nodes (`talk:*`) also have tokens and window (those after the last compaction), and of each how many are fitted to the model's real counts (fitted, fittedWindow); what is there from the start has tokens and fitted too. `until`: as of that time. `reading` while the transcript is still being read. Writes nothing.",
      input: {
        type: "object",
        properties: {
          run: { type: "string" },
          until: { type: "string", description: "A time: the nodes as they were then" },
          after: { type: "string", description: "The last name of the page before" },
          limit: { type: "number" },
        },
        required: ["run"],
      },
      async run(input: { run: string; until?: string; after?: string; limit?: number }) {
        if (typeof input.run !== "string" || !input.run) throw refuse("transcript.run", "Say which run.");
        const s = await sync(input.run);
        const all = nodesOf(s, typeof input.until === "string" ? input.until : undefined);
        const limit = Math.max(1, Math.min(LIMIT_MAX, Number(input.limit) || LIMIT_MAX));
        const from = input.after ? all.filter((g) => g.name > input.after!) : all;
        const nodes = from.slice(0, limit);
        return {
          nodes: nodes as unknown as Json,
          ...(from.length > limit ? { next: nodes[nodes.length - 1]!.name } : {}),
          ...(!s.path ? { none: true } : {}),
          ...(s.path && !s.done ? { reading: true } : {}),
        };
      },
    });
    reg.register({
      name: TEXT,
      title: "The text of one node Claude Code gave an agent",
      doc: "Read again from the transcript where the index says: never kept. Email addresses are taken out. Writes nothing.",
      input: { type: "object", properties: { run: { type: "string" }, name: { type: "string" } }, required: ["run", "name"] },
      async run(input: { run: string; name: string }) {
        const s = await sync(String(input.run ?? ""));
        const node = nodesOf(s).find((g) => g.name === input.name);
        if (!node || !s.path) throw refuse("transcript.name", `No ${JSON.stringify(input.name)} in that run's transcript.`);
        if ("private" in node && node.private) throw refuse("transcript.private", "The session's own context is counted, never shown.");
        const parts: string[] = [];
        const talk = node.name.startsWith("talk:");
        for (const spot of talk ? s.index.talk.spots(node.name) : s.index.spots(node.name)) {
          const line = await readLine(s.path, spot);
          let part: string | undefined;
          if (line !== undefined && talk) {
            try {
              part = talkOf(JSON.parse(line), spot.pick as never);
            } catch {}
          } else if (line !== undefined) part = partOf(line, spot.pick as never);
          if (part?.trim()) parts.push(part.trim());
        }
        const { text, cut } = shown(parts.join("\n\n---\n\n"));
        return { name: node.name, title: node.title, by: node.by, at: node.at, text, ...(cut ? { cut: true } : {}) };
      },
    });
    reg.register({
      name: PIECES,
      title: "Each time one node was given or said, in an agent's transcript",
      doc: "A page of the node's pieces in order: n, time, tokens (characters / 4; an image by its pixels), fit (fitted to the model's real counts). `stays`: start (each request carries it), listed (only named), said (until a compaction sums it up). `after`: the last n of the page before. Numbers only. Writes nothing.",
      input: {
        type: "object",
        properties: { run: { type: "string" }, name: { type: "string" }, after: { type: "number" }, limit: { type: "number" } },
        required: ["run", "name"],
      },
      async run(input: { run: string; name: string; after?: number; limit?: number }) {
        if (typeof input.run !== "string" || !input.run) throw refuse("transcript.run", "Say which run.");
        const s = await sync(input.run);
        const node = nodesOf(s).find((g) => g.name === input.name);
        if (!node) throw refuse("transcript.name", `No ${JSON.stringify(input.name)} in that run's transcript.`);
        const f = staysOf(node.name) === "start" ? startScale(s, s.index.list(ours(s))) : 1;
        const fit = staysOf(node.name) === "start" && !!s.index.talk.first;
        const all = node.name.startsWith("talk:")
          ? s.index.talk.piecesOf(node.name).map((p) => ({ ...(p.time ? { time: p.time } : {}), tokens: p.tokens, ...(p.fit ? { fit: true } : {}) }))
          : s.index.piecesOf(node.name).map((p) => ({ ...(p.time ? { time: p.time } : {}), tokens: Math.round(Math.ceil(p.chars / 4) * f), ...(fit ? { fit: true } : {}) }));
        const limit = Math.max(1, Math.min(LIMIT_MAX, Number(input.limit) || LIMIT_MAX));
        const from = Math.max(0, Math.floor(Number(input.after) || 0));
        const page = all.slice(from, from + limit).map((p, i) => ({ n: from + i + 1, ...p }));
        return { name: node.name, stays: staysOf(node.name), count: all.length, pieces: page as unknown as Json, ...(from + limit < all.length ? { next: from + limit } : {}), ...(s.path && !s.done ? { reading: true } : {}) };
      },
    });
    reg.register({
      name: TOKENS,
      title: "Token use and compactions in an agent's transcript",
      doc: "A page of rows in the order they were written: `usage` (each of the model's messages: input, cacheRead, cacheWrite, output tokens, its model) and `compact` (trigger, tokens before and after, dropped so far). Up to `until` (a time), after the place `after` (a row's `n`). `last`: the latest usage up to `until`; `compactions`: how many by then. Real tokens, numbers only. Writes nothing.",
      input: {
        type: "object",
        properties: {
          run: { type: "string" },
          kind: { type: "string", enum: ["usage", "compact"] },
          until: { type: "string", description: "A time: only what was written by then" },
          after: { type: "number", description: "The last row's n of the page before" },
          limit: { type: "number" },
        },
        required: ["run"],
      },
      async run(input: { run: string; kind?: "usage" | "compact"; until?: string; after?: number; limit?: number }) {
        if (typeof input.run !== "string" || !input.run) throw refuse("transcript.run", "Say which run.");
        if (input.kind !== undefined && input.kind !== "usage" && input.kind !== "compact") throw refuse("transcript.kind", "A kind is usage or compact.");
        const s = await sync(input.run);
        const limit = Math.max(1, Math.min(LIMIT_MAX, Number(input.limit) || LIMIT_MAX));
        const page = tokensPage(s.index.tokens.rows(), {
          limit,
          ...(input.kind ? { kind: input.kind } : {}),
          ...(typeof input.until === "string" ? { until: input.until } : {}),
          ...(typeof input.after === "number" ? { after: input.after } : {}),
        });
        return { ...(page as unknown as Record<string, Json>), ...(!s.path ? { none: true } : {}), ...(s.path && !s.done ? { reading: true } : {}) };
      },
    });
    ctx.effect(() => () => runs.clear());
  },
};

export default transcript;
