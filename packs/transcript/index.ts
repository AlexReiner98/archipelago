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
 * Two read-only actions, which write nothing:
 * - `transcript.given` ({ run, after?, limit? }): a page of the nodes, by name.
 * - `transcript.text` ({ run, name }): one node's text.
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
import { GivenIndex, partOf, readLine, readPage, shown, type Given } from "./read.ts";

export const GIVEN = "transcript.given";
export const TEXT = "transcript.text";
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

    const reg = ctx.get<ActionRegister>("action.register");
    reg.register({
      name: GIVEN,
      title: "What Claude Code gave an agent, as read-only nodes",
      doc: "A page of the run's transcript nodes by name: name, title, by (who said it), at (its place), count, size. `reading` while the transcript is still being read. Writes nothing.",
      input: {
        type: "object",
        properties: {
          run: { type: "string" },
          after: { type: "string", description: "The last name of the page before" },
          limit: { type: "number" },
        },
        required: ["run"],
      },
      async run(input: { run: string; after?: string; limit?: number }) {
        if (typeof input.run !== "string" || !input.run) throw refuse("transcript.run", "Say which run.");
        const s = await sync(input.run);
        const all = s.index.list(ours(s));
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
        const node: Given | undefined = s.index.list(ours(s)).find((g) => g.name === input.name);
        if (!node || !s.path) throw refuse("transcript.name", `No ${JSON.stringify(input.name)} in that run's transcript.`);
        const parts: string[] = [];
        for (const spot of s.index.spots(node.name)) {
          const line = await readLine(s.path, spot);
          const part = line === undefined ? undefined : partOf(line, spot.pick);
          if (part?.trim()) parts.push(part.trim());
        }
        const { text, cut } = shown(parts.join("\n\n---\n\n"));
        return { name: node.name, title: node.title, by: node.by, at: node.at, text, ...(cut ? { cut: true } : {}) };
      },
    });
    ctx.effect(() => () => runs.clear());
  },
};

export default transcript;
