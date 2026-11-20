/**
 * The verdict pack: whether each node worked, per run, from the exchange.
 * Injects exchange.read, exchange.watch and agent.tree; provides its own
 * `verdict.read`, the live read the harness view calls. Judging is in
 * judge.ts, apart from the runtime.
 *
 * It reads the whole record back when it loads, follows each new event and
 * each change to the tree, and judges a run again only when that run (or
 * the tree) changed.
 */
import type { AgentTree, RunId } from "../../spec/agent.ts";
import type { Dispose, Page, PageRequest } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
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

function pageOf<T>(list: T[], page?: PageRequest): Page<T> {
  const start = page?.after ? Number(page.after) : 0;
  const end = start + Math.max(1, Math.min(page?.limit ?? 100, LIMIT_MAX));
  const items = list.slice(start, end);
  return end < list.length ? { items, next: String(end) } : { items };
}

const verdict: Pack = {
  id: "verdict",
  inject: ["exchange.read", "exchange.watch", "agent.tree"],
  async apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const live = ctx.get<ExchangeWatch>("exchange.watch");
    const tree = ctx.get<AgentTree>("agent.tree");

    /** Events per run by seq, so an event seen twice (read back and watched) counts once. */
    const events = new Map<RunId, Map<number, ExchangeEvent>>();
    /** Runs in the order this pack first saw them. */
    const order: RunId[] = [];
    const judged = new Map<RunId, RunVerdict[]>();
    const watchers = new Set<(c: VerdictChange) => void>();
    let listening: Listening = listeningOf(tree.nodes());

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
    tree.watch(() => {
      listening = listeningOf(tree.nodes());
      judged.clear();
      notify({});
    });
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
