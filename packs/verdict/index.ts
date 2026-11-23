/**
 * The verdict pack: whether each node worked, per run, from the exchange.
 * Injects exchange.read, exchange.watch, agent.tree, and graph.read and
 * graph.watch for each node's `misses` (on the map item it came from, the
 * words of the miss it should prevent: see judge.ts); provides its own
 * `verdict.read`, the live read the context interface calls. Judging is in
 * judge.ts, apart from the runtime.
 *
 * It reads the whole record back when it loads, follows each new event and
 * each change to the tree, and judges a run again only when that run (or
 * the tree) changed.
 */
import type { AgentTree, NodeInfo, RunId } from "../../spec/agent.ts";
import type { Dispose, Page, PageRequest } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { judgeRun, listeningOf, records, type Listening, type NodeRecord, type RunVerdict } from "./judge.ts";

export type { NodeRecord, RunVerdict, Verdict } from "./judge.ts";

/** What changed: a run's verdicts, or (no run) every run's, when the tree changed. */
export interface VerdictChange {
  run?: RunId;
}

/** `verdict.read`: this pack's own key. */
export interface VerdictRead {
  /** A run's verdicts, one per node said in it, in the order each was first said. */
  run(run: RunId): Promise<RunVerdict[]>;
  /** Every node's record, the one said most recently first. */
  records(page?: PageRequest): Promise<Page<NodeRecord>>;
  /** One node's record; undefined if it was never said. */
  record(node: string): Promise<NodeRecord | undefined>;
  /** One node's verdicts across runs, newest run first: the node page's list. */
  verdicts(node: string, page?: PageRequest): Promise<Page<RunVerdict>>;
  /** Called after verdicts may have changed. */
  watch(on: (change: VerdictChange) => void): Dispose;
}

/**
 * Each node with the words of the miss it should prevent: the `misses`
 * field of the map item it was made from (its `source`), when it has one.
 */
async function withMisses(graph: GraphRead, nodes: NodeInfo[]): Promise<(NodeInfo & { misses?: string; when?: string })[]> {
  const sources = [...new Set(nodes.flatMap((n) => (n.source ? [n.source] : [])))];
  const found = new Map<string, { misses?: string; when?: string }>();
  for (let i = 0; i < sources.length; i += LIMIT_MAX) {
    for (const item of await graph.get(sources.slice(i, i + LIMIT_MAX))) {
      if (!item) continue;
      const f: { misses?: string; when?: string } = {};
      if (typeof item.fields.misses === "string" && item.fields.misses.trim()) f.misses = item.fields.misses;
      if (typeof item.fields.when === "string" && item.fields.when) f.when = item.fields.when;
      if (f.misses || f.when) found.set(item.id, f);
    }
  }
  return nodes.map((n) => (n.source && found.has(n.source) ? { ...n, ...found.get(n.source)! } : n));
}

function pageOf<T>(list: T[], page?: PageRequest): Page<T> {
  const start = page?.after ? Number(page.after) : 0;
  const end = start + Math.max(1, Math.min(page?.limit ?? 100, LIMIT_MAX));
  const items = list.slice(start, end);
  return end < list.length ? { items, next: String(end) } : { items };
}

const verdict: Pack = {
  id: "verdict",
  about: "Judges, for each agent session, whether each node the map said helped.",
  inject: ["exchange.read", "exchange.watch", "agent.tree", "graph.read", "graph.watch"],
  async apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const live = ctx.get<ExchangeWatch>("exchange.watch");
    const tree = ctx.get<AgentTree>("agent.tree");
    const graph = ctx.get<GraphRead>("graph.read");

    /** Events per run by seq, so an event seen twice (read back and watched) counts once. */
    const events = new Map<RunId, Map<number, ExchangeEvent>>();
    /** Runs in the order this pack first saw them. */
    const order: RunId[] = [];
    const judged = new Map<RunId, RunVerdict[]>();
    const watchers = new Set<(c: VerdictChange) => void>();
    let listening: Listening = listeningOf(await withMisses(graph, tree.nodes()));

    const notify = (change: VerdictChange) => {
      for (const on of [...watchers]) {
        try {
          on(change);
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    };
    const add = (e: ExchangeEvent) => {
      let run = events.get(e.run);
      if (!run) {
        events.set(e.run, (run = new Map()));
        order.push(e.run);
      }
      if (run.has(e.seq)) return false;
      run.set(e.seq, e);
      judged.delete(e.run);
      return true;
    };
    const eventsOf = (run: RunId) => [...(events.get(run)?.values() ?? [])];
    const verdictsOf = (run: RunId): RunVerdict[] => {
      let v = judged.get(run);
      if (!v) judged.set(run, (v = judgeRun(run, eventsOf(run), listening)));
      return v;
    };
    const allRecords = () =>
      records(order.map((run) => ({ verdicts: verdictsOf(run), events: eventsOf(run) }))).sort((a, b) =>
        (b.last ?? "").localeCompare(a.last ?? ""),
      );

    // Watch first, then read back, so nothing appended in between is lost.
    live.watch({}, (e) => {
      if (add(e)) notify({ run: e.run });
    });
    /** Reads where the nodes listen and what they prevent again, then judges every run again. */
    let relisten = Promise.resolve();
    const listen = () => {
      relisten = relisten
        .then(async () => {
          listening = listeningOf(await withMisses(graph, tree.nodes()));
          judged.clear();
          notify({});
        })
        .catch((err) => ctx.runtime.report(ctx.fiber, err));
    };
    tree.watch(listen);
    // A node's misses can change without the tree changing.
    ctx.get<GraphWatch>("graph.watch").watch({ fields: ["misses"] }, listen);
    const past: RunId[] = [];
    for (let page = await read.runs({ limit: LIMIT_MAX }); ; ) {
      past.push(...page.items.map((i) => i.run));
      if (!page.next) break;
      page = await read.runs({ limit: LIMIT_MAX, after: page.next });
    }
    // Oldest first, ahead of any run first seen live while reading back.
    const seenLive = order.splice(0);
    for (const run of past.reverse()) {
      if (!events.has(run)) events.set(run, new Map());
      order.push(run);
      for (let ev = await read.events(run, { limit: LIMIT_MAX }); ; ) {
        for (const e of ev.items) add(e);
        if (!ev.next) break;
        ev = await read.events(run, { limit: LIMIT_MAX, after: ev.next });
      }
    }
    for (const run of seenLive) if (!order.includes(run)) order.push(run);

    ctx.provide<VerdictRead>("verdict.read", (_caller, from) => ({
      async run(run) {
        return verdictsOf(run);
      },
      async records(page) {
        return pageOf(allRecords(), page);
      },
      async record(node) {
        return allRecords().find((r) => r.node === node);
      },
      async verdicts(node, page) {
        const list = [...order]
          .reverse()
          .flatMap((run) => verdictsOf(run).filter((v) => v.node === node));
        return pageOf(list, page);
      },
      watch(on): Dispose {
        return from.effect(() => {
          watchers.add(on);
          return () => watchers.delete(on);
        });
      },
    }));
  },
};

export default verdict;
