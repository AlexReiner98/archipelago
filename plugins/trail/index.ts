/**
 * Trail: one run, opened into a graph of its own for the Landscape to draw
 * beside the map. Its turns in order, each turn's tool calls and what the map
 * said in it, and for each call the ids it names, so the Landscape links it to
 * the items it touched. A projection of the exchange: it reads the run's events
 * (`exchange.read`, a page at a time, then `exchange.watch`), keeps the answer
 * in the page key `trail.graph`, and writes nothing to the map. No text of
 * what was said or done is kept: only tool names, node names and ids.
 */
import { runName, type RunInfo } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import { KEYS, type HereDeclare, type HereRead, type HereSet } from "../../spec/here.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

export const TRAIL = "trail.graph";

/** The latest events of a run drawn, at most: the turns before them are folded into one count. */
export const TRAIL_LIMIT = 400;
/** Pages read to find a run's latest events, at most (a run longer than this many pages is drawn from what they hold). */
export const TRAIL_PAGES = 40;
/** Ids kept per tool call, at most, and how much of its input and output is looked through for them. */
export const IDS_MOST = 20;
export const SCAN_CHARS = 50_000;

/** A tool call (or a person's decision on one) in a turn. */
export interface TrailAct {
  /** The event's seq: the call's place in the run. */
  seq: number;
  /** The tool's name, short (`act items.set`, `Bash`), or the decision's. */
  title: string;
  /** `tool`, `decision` (a person allowed or denied a call: an approval, not a decision about the work) or `notice`. */
  kind: string;
  ok: boolean;
  /** Ids its input and output name: the Landscape links the ones on the map. */
  ids: string[];
}

/** A node the map said, refused with, or held back, in a turn: once per node and kind. */
export interface TrailSay {
  node: string;
  kind: "say" | "refuse" | "gated";
  count: number;
}

export interface TrailTurn {
  /** Its first event's seq. */
  seq: number;
  /** `start` (before the first prompt), else `turn <n>`. */
  title: string;
  acts: TrailAct[];
  says: TrailSay[];
}

/** One run as the Landscape draws it. */
export interface Trail {
  run: string;
  title: string;
  /** Events before the ones drawn, folded. */
  earlier: number;
  turns: TrailTurn[];
}

const ID = /\b[a-z]{1,3}_[a-z0-9]{8,16}\b/g;

/** The ids a value names (input, output), up to `most`, in the order met: map item ids are a letter or three, `_`, then base 36. */
export function idsIn(value: unknown, most = IDS_MOST): string[] {
  if (value === undefined || value === null) return [];
  const text = (typeof value === "string" ? value : JSON.stringify(value)).slice(0, SCAN_CHARS);
  const out = new Set<string>();
  for (const m of text.matchAll(ID)) {
    out.add(m[0]);
    if (out.size >= most) break;
  }
  return [...out];
}

/** A tool's name as drawn: the map's own MCP tools by their short name, `act` with its action. */
export function toolTitle(place: string | undefined, input: unknown): string {
  const tool = (place ?? "").replace(/^tool:/, "") || "tool";
  // The map's own MCP tools by their name; another server's as `<server> <tool>`.
  const short = tool.replace(/^mcp__archipelago__/, "").replace(/^mcp__(.+?)__(.+)$/, "$1 $2");
  if (short === "act" && input && typeof input === "object" && typeof (input as { action?: unknown }).action === "string") return `act ${(input as { action: string }).action}`;
  return short;
}

/** The trail of a run from its events in seq order: a turn starts at each prompt; `earlier` events came before these. */
export function trailOf(run: RunInfo, events: ExchangeEvent[], earlier = 0): Trail {
  const turns: TrailTurn[] = [];
  let turn: TrailTurn | undefined;
  let n = 0;
  const open = (seq: number, title: string) => {
    turn = { seq, title, acts: [], says: [] };
    turns.push(turn);
  };
  for (const e of events) {
    if (e.kind === "act" && e.act?.kind === "prompt") {
      open(e.seq, `turn ${++n}`);
      continue;
    }
    if (!turn) open(e.seq, earlier ? "earlier" : "start");
    const t = turn!;
    if (e.kind === "act" && e.act) {
      const k = e.act.kind;
      if (k === "reply") continue;
      const title = k === "tool" ? toolTitle(e.place, e.act.input) : k === "decision" ? `${e.act.ok === false ? "denied" : "allowed"} ${toolTitle(e.place, undefined)}` : "asked";
      t.acts.push({ seq: e.seq, title, kind: k, ok: e.act.ok !== false, ids: k === "tool" ? idsIn([e.act.input, e.act.output]) : [] });
    } else if ((e.kind === "say" || e.kind === "refuse" || e.kind === "gated") && e.node) {
      const s = t.says.find((x) => x.node === e.node && x.kind === e.kind);
      if (s) s.count++;
      else t.says.push({ node: e.node, kind: e.kind, count: 1 });
    }
  }
  return { run: run.run, title: runName(run), earlier, turns };
}

/** The run's latest events, at most `limit`, read a page at a time, and how many came before them. */
export async function latest(read: ExchangeRead, run: string, limit = TRAIL_LIMIT, pages = TRAIL_PAGES): Promise<{ events: ExchangeEvent[]; earlier: number; after?: string }> {
  let kept: ExchangeEvent[] = [];
  let earlier = 0;
  let after: string | undefined;
  for (let p = 0; p < pages; p++) {
    const page = await read.events(run, { limit: LIMIT_MAX, ...(after ? { after } : {}) });
    kept.push(...page.items);
    if (kept.length > limit) {
      earlier += kept.length - limit;
      kept = kept.slice(-limit);
    }
    if (!page.next) break;
    after = page.next;
  }
  return { events: kept, earlier, ...(after ? { after } : {}) };
}

/** The particle id a session's run is drawn as (as plugins/field/sessions.ts names it). */
const SESSION = "session:";
/** The particle ids a trail's marks are drawn as start with this, then the run. */
export const TRAIL_ID = "trail:";

const trail: Plugin = {
  id: "trail",
  about: "One run opened into a graph for the Landscape to draw: its turns, tool calls and what the map said, linked to the items they touched (page key trail.graph). Writes nothing.",
  inject: ["exchange.read", "exchange.watch", "graph.read", "here.read", "here.set", "here.declare"],
  apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const watch = ctx.get<ExchangeWatch>("exchange.watch");
    const graph = ctx.get<GraphRead>("graph.read");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    ctx.effect(() => ctx.get<HereDeclare>("here.declare").declare({ key: TRAIL, scope: "page", doc: "The run in focus opened into a graph (plugins/trail): its turns, tool calls and the nodes said, for the Landscape to draw. Not on the map." }));
    // Turning the plugin off takes its drawing away.
    ctx.effect(() => () => set.set(TRAIL, undefined));

    let asked = 0;
    let stop: (() => void) | undefined;
    const show = async (run: string | undefined) => {
      const n = ++asked;
      stop?.();
      stop = undefined;
      if (!run) return set.set(TRAIL, undefined);
      const info = (await findRun(read, run)) ?? ({ run } as RunInfo);
      let { events, earlier } = await latest(read, run);
      if (n !== asked) return;
      const put = () => set.set(TRAIL, trailOf(info, events, earlier) as unknown as Json);
      put();
      // Live: each event as it comes, kept within the limit; drawn again at most every half second.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const seen = events.at(-1)?.seq ?? 0;
      const off = watch.watch({ run }, (e) => {
        if (e.seq <= seen || n !== asked) return;
        events.push(e);
        if (events.length > TRAIL_LIMIT) (earlier += events.length - TRAIL_LIMIT), (events = events.slice(-TRAIL_LIMIT));
        timer ??= setTimeout(() => ((timer = undefined), put()), 500);
      });
      stop = () => (off(), timer && clearTimeout(timer));
    };
    ctx.effect(() => () => stop?.());
    ctx.effect(() => here.watch(KEYS.run, (c) => void show(typeof c.value === "string" ? c.value : undefined)));

    // A click on a session opens its trail; a click on one of its tool calls goes to the first item it touched.
    ctx.effect(() =>
      here.watch(KEYS.item, (c) => {
        const id = typeof c.value === "string" ? c.value : "";
        if (id.startsWith(SESSION)) return set.set(KEYS.run, id.slice(SESSION.length));
        if (!id.startsWith(TRAIL_ID)) return;
        const t = here.get<Json>(TRAIL) as unknown as Trail | undefined;
        const seq = Number(id.split(":").at(-1));
        const act = t?.turns.flatMap((x) => x.acts).find((a) => a.seq === seq);
        if (!act?.ids.length) return;
        void graph.get(act.ids).then((items) => {
          const first = items.find((it) => it);
          if (first && here.get(KEYS.item) === id) set.set(KEYS.item, first.id);
        });
      }),
    );
  },
};

/** The run's facts, from the latest runs (its title), or none if it is not among them. */
async function findRun(read: ExchangeRead, run: string): Promise<RunInfo | undefined> {
  return (await read.runs({ limit: 50 })).items.find((r) => r.run === run);
}

export default trail;
