/**
 * The context pack: what is in a run's window at a moment (window.ts), from
 * the run's events and what the transcript pack reads of Claude Code's
 * transcript (`transcript.given`, `transcript.tokens`). One read-only
 * action, `context.window` ({ run, at?, after?, limit? }): the window's
 * total against its limit, its shares by source and channel, and a page of
 * its parts, biggest first. And `context.node` ({ run, id, at?, after?,
 * limit? }): one tree node's share of the window over the run (trend.ts),
 * and a page of its pieces, latest first, each in the window or dropped.
 *
 * Nothing is stored in the graph. In memory, per run: each event's kind,
 * node, place, time and size, never its text, read a page at a time from a
 * cursor so each call reads only what was added.
 *
 * Injects exchange.read for the events, agent.tree for the map's nodes,
 * action.list and action.invoke for the transcript pack's actions (without
 * them, sizes are estimates and compactions are the run's own `compact`
 * events), action.register for its own.
 */
import type { ActionInvoke, ActionList, ActionRegister } from "../../spec/action.ts";
import type { AgentTree } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { trendOf, type Piece, type Stays } from "./trend.ts";
import { tokensOf, windowAt, type CompactRow, type Ev, type GivenRow, type UsageRow } from "./window.ts";

export const WINDOW = "context.window";
export const NODE = "context.node";
/** The most event pages one call reads; the next goes on from there. */
export const PAGES = 64;
/** The most pages of the transcript pack's answers one call reads. */
const ASK_PAGES = 20;

const refuse = (code: string, message: string) => new Refused({ code, message, by: { pack: "context" } });

/** What an event put in the window, in characters. */
export function sizeOf(e: ExchangeEvent): number {
  if (e.kind === "say" || e.kind === "refuse") return e.text?.length ?? 0;
  if (e.kind === "act" && e.act) return (e.act.input === undefined ? 0 : JSON.stringify(e.act.input).length) + (e.act.output === undefined ? 0 : JSON.stringify(e.act.output).length);
  return 0;
}

const keep = (e: ExchangeEvent): Ev => ({ seq: e.seq, id: e.id, time: e.time, kind: e.kind, ...(e.node ? { node: e.node } : {}), ...(e.place ? { place: e.place } : {}), size: sizeOf(e) });

interface RunState {
  events: Ev[];
  after?: string;
  busy: Promise<unknown>;
}

const context: Pack = {
  id: "context",
  about: "What is in a run's window at a moment: its parts by source and channel, each with a size and a state, and the total against the window's limit.",
  inject: ["exchange.read", "agent.tree", "action.list", "action.invoke", "action.register"],
  apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const tree = ctx.get<AgentTree>("agent.tree");
    const actions = ctx.get<ActionList>("action.list");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const runs = new Map<string, RunState>();

    /** Reads the run's events added since the last call, at most PAGES pages. */
    const sync = (run: string): Promise<RunState> => {
      const s = runs.get(run) ?? (runs.set(run, { events: [], busy: Promise.resolve() }), runs.get(run)!);
      const next = s.busy.then(async () => {
        // The cursor stays at the start of the last page, which is read again next time: what joined it is new.
        for (let pages = 0; pages < PAGES; pages++) {
          const page = await read.events(run, { limit: LIMIT_MAX, ...(s.after ? { after: s.after } : {}) });
          const seq = s.events[s.events.length - 1]?.seq ?? 0;
          for (const e of page.items) if (e.seq > seq) s.events.push(keep(e));
          if (!page.next) break;
          s.after = page.next;
        }
        return s;
      });
      s.busy = next.catch(() => undefined);
      return next;
    };

    const has = (name: string) => actions.list().some((a) => a.name === name);
    const ask = async (action: string, input: Record<string, Json>) => {
      const out = await invoke.invoke({ action, input, authority: { of: "agent", basis: "the context pack reads the window" }, reason: "Read what is in the run's window" });
      return out.ok ? (out.output as Record<string, unknown>) : undefined;
    };
    const given = async (run: string, until: string | undefined): Promise<GivenRow[]> => {
      if (!has("transcript.given")) return [];
      const rows: GivenRow[] = [];
      let after: string | undefined;
      for (let i = 0; i < ASK_PAGES; i++) {
        const o = await ask("transcript.given", { run, limit: LIMIT_MAX, ...(until ? { until } : {}), ...(after ? { after } : {}) });
        rows.push(...((o?.nodes as GivenRow[] | undefined) ?? []));
        if (typeof o?.next !== "string") break;
        after = o.next;
      }
      return rows;
    };
    const tokens = async (run: string, until: string | undefined) => {
      if (!has("transcript.tokens")) return undefined;
      const compactions: CompactRow[] = [];
      let usage: UsageRow | undefined;
      let none = false;
      let after: number | undefined;
      for (let i = 0; i < ASK_PAGES; i++) {
        const o = await ask("transcript.tokens", { run, kind: "compact", limit: LIMIT_MAX, ...(until ? { until } : {}), ...(after !== undefined ? { after } : {}) });
        if (!o) return undefined;
        none = !!o.none;
        usage = (o.last as UsageRow | undefined) ?? usage;
        compactions.push(...((o.rows as CompactRow[] | undefined) ?? []));
        if (typeof o.next !== "number") break;
        after = o.next;
      }
      // A run with no transcript: its own compact events stand in.
      return none ? undefined : { usage, compactions };
    };

    /** One node's pieces: the map's from the run's events, Claude Code's and the conversation's from the transcript pack. */
    const piecesOf = async (run: string, s: RunState, id: string): Promise<{ stays: Stays; pieces: Piece[] } | undefined> => {
      const prefix = `transcript/${run}#`;
      const name = id.startsWith(prefix) ? id.slice(prefix.length) : undefined;
      if (!name) {
        const mine = s.events.filter((e) => (e.kind === "say" || e.kind === "refuse") && e.node === id);
        return { stays: "said", pieces: mine.map((e) => ({ time: e.time, tokens: tokensOf(e.size) })) };
      }
      if (!has("transcript.pieces")) return undefined;
      const pieces: Piece[] = [];
      let stays: Stays = "said";
      let after: number | undefined;
      for (let i = 0; i < ASK_PAGES; i++) {
        const o = await ask("transcript.pieces", { run, name, limit: LIMIT_MAX, ...(after !== undefined ? { after } : {}) });
        if (!o) return undefined;
        stays = (o.stays as Stays) ?? stays;
        pieces.push(...((o.pieces as Piece[] | undefined) ?? []));
        if (typeof o.next !== "number") break;
        after = o.next;
      }
      return { stays, pieces };
    };

    const reg = ctx.get<ActionRegister>("action.register");
    reg.register({
      name: NODE,
      title: "One node's share of a run's window over time",
      doc: "For a tree node (a map node's id, or `transcript/<run>#<name>`): how it stays (start, listed, said), its tokens in the window `now` (at the event `at`) and of them `nowFitted` (fitted to the model's real counts; the rest estimated), `peak`, `total` put in, `dropped` by compactions, `count` pieces and how many are `inWindow`, `points` over time (each the value at the end of a stretch and its peak), the `compactions`' times, and a page of its `pieces`, latest first: n, time, tokens, fit, in (in the window). `after`: how many pieces the pages before held. Writes nothing.",
      input: {
        type: "object",
        properties: { run: { type: "string" }, id: { type: "string" }, at: { type: "string" }, after: { type: "number" }, limit: { type: "number" } },
        required: ["run", "id"],
      },
      async run(input: { run: string; id: string; at?: string; after?: number; limit?: number }) {
        if (typeof input.run !== "string" || !input.run) throw refuse("context.run", "Say which run.");
        if (typeof input.id !== "string" || !input.id) throw refuse("context.id", "Say which node.");
        const s = await sync(input.run);
        const at = typeof input.at === "string" && input.at ? s.events.find((e) => e.id === input.at) : undefined;
        if (input.at && !at) throw refuse("context.at", `No event ${JSON.stringify(input.at)} in that run.`);
        const [got, t] = await Promise.all([piecesOf(input.run, s, input.id), tokens(input.run, undefined)]);
        if (!got) throw refuse("context.node", "Without the transcript pack, a node Claude Code gave has no history.");
        const compactions = (t ? t.compactions.map((c) => c.time) : s.events.filter((e) => e.kind === "compact").map((e) => e.time)).filter((x): x is string => !!x);
        const until = at?.time;
        const trend = trendOf({ pieces: got.pieces, compactions, stays: got.stays, ...(until ? { until } : {}) });
        // Each piece by then, latest first: in the window or not.
        const upTo = got.pieces.map((p, i) => ({ n: i + 1, ...p })).filter((p) => !until || !p.time || Date.parse(p.time) <= Date.parse(until));
        const cut = Math.max(-Infinity, ...compactions.filter((c) => !until || Date.parse(c) <= Date.parse(until)).map((c) => Date.parse(c)));
        const latest = upTo[upTo.length - 1];
        const isIn = (p: (typeof upTo)[number]) => (got.stays === "said" ? !p.time || Date.parse(p.time) >= cut : got.stays === "listed" ? true : p === latest);
        const rows = [...upTo].reverse().map((p) => ({ ...p, in: isIn(p) }));
        const limit = Math.max(1, Math.min(LIMIT_MAX, Number(input.limit) || 30));
        const from = Math.max(0, Math.floor(Number(input.after) || 0));
        const page = rows.slice(from, from + limit);
        return { id: input.id, ...(until ? { time: until } : {}), ...(trend as unknown as Record<string, Json>), compactions: compactions as unknown as Json, pieces: page as unknown as Json, ...(from + limit < rows.length ? { next: from + limit } : {}) };
      },
    });
    reg.register({
      name: WINDOW,
      title: "What is in a run's window at a moment",
      doc: "The run's window at the event `at` (absent: its end): `total` tokens (from the model's usage, else characters / 4) against `limit`, its shares by `sources` (map, harness, agent) and `channels` (hook, rule, file, context, talk: the conversation, act), `fitted` (of those shares, how many tokens are fitted to the model's real counts), `unseen` (usage the parts don't account for), and a page of `parts`, biggest first: id (the tree's), title, source, channel, state (start, said, listed, dropped), tokens, count, fitted. `after`: how many parts the pages before held. Writes nothing.",
      input: {
        type: "object",
        properties: {
          run: { type: "string" },
          at: { type: "string", description: "An event's id: the window then" },
          after: { type: "number", description: "How many parts the pages before held" },
          limit: { type: "number" },
        },
        required: ["run"],
      },
      async run(input: { run: string; at?: string; after?: number; limit?: number }) {
        if (typeof input.run !== "string" || !input.run) throw refuse("context.run", "Say which run.");
        const s = await sync(input.run);
        const at = typeof input.at === "string" && input.at ? s.events.find((e) => e.id === input.at) : s.events[s.events.length - 1];
        if (input.at && !at) throw refuse("context.at", `No event ${JSON.stringify(input.at)} in that run.`);
        const [rows, t] = await Promise.all([given(input.run, input.at ? at?.time : undefined), tokens(input.run, at?.time)]);
        const w = windowAt({
          run: input.run,
          events: s.events,
          ...(input.at ? { at: input.at } : {}),
          given: rows,
          ...(t?.usage ? { usage: t.usage } : {}),
          ...(t ? { compactions: t.compactions } : {}),
          nodes: tree.nodes(),
        });
        const limit = Math.max(1, Math.min(LIMIT_MAX, Number(input.limit) || LIMIT_MAX));
        const from = Math.max(0, Math.floor(Number(input.after) || 0));
        const parts = w.parts.slice(from, from + limit);
        return { ...(w as unknown as Record<string, Json>), parts: parts as unknown as Json, ...(from + limit < w.parts.length ? { next: from + limit } : {}) };
      },
    });
    ctx.effect(() => () => runs.clear());
  },
};

export default context;
