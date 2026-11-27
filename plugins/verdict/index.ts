/**
 * The verdict plugin: whether each node worked, per run, from the exchange.
 * Injects exchange.read, exchange.watch, agent.tree, and graph.read and
 * graph.watch for each node's `misses` (on the map item it came from, the
 * words of the miss it should prevent: see judge.ts); provides its own
 * `verdict.read`, the live read the context interface calls. Judging is in
 * judge.ts, apart from the runtime.
 *
 * It reads the whole record back when it loads, follows each new event and
 * each change to the tree, and keeps per run only a digest of it (judge.ts,
 * RunDigest), never its events. A run is judged again from its digest when
 * it changed or a node said in it did; a changed node's near misses are
 * looked for again by reading back, from the exchange, only the runs it
 * was said in where an act worked at its places (README, "What it holds").
 */
import type { AgentTree, NodeInfo, RunId } from "../../spec/agent.ts";
import type { Dispose, Page, PageRequest } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { judgeDigest, listeningOf, mayBeNear, missPhrases, newDigest, take, tally, type Listener, type Listening, type NodeRecord, type RunDigest, type RunVerdict } from "./judge.ts";

export type { NodeRecord, RunVerdict, Verdict } from "./judge.ts";

/** What changed: a run's verdicts, or (no run) every run's, when the tree changed. */
export interface VerdictChange {
  run?: RunId;
}

/** `verdict.read`: this plugin's own key. */
export interface VerdictRead {
  /** A run's verdicts, one per node said in it, in the order each was first said. */
  run(run: RunId): Promise<RunVerdict[]>;
  /** Every node's record from live runs, the one said most recently first. */
  records(page?: PageRequest): Promise<Page<NodeRecord>>;
  /** One node's record from live runs; undefined if it was never said in one. */
  record(node: string): Promise<NodeRecord | undefined>;
  /** One node's record from replays (runs with `replay_of`), apart from the live one; undefined if none said it. */
  replayed(node: string): Promise<NodeRecord | undefined>;
  /** One node's verdicts across runs, live and replayed (a replay's has `replay_of`), newest run first: the node page's list. */
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

const verdict: Plugin = {
  id: "verdict",
  about: "Judges, for each agent session, whether each node the map said helped.",
  inject: ["exchange.read", "exchange.watch", "agent.tree", "graph.read", "graph.watch"],
  async apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const live = ctx.get<ExchangeWatch>("exchange.watch");
    const tree = ctx.get<AgentTree>("agent.tree");
    const graph = ctx.get<GraphRead>("graph.read");

    /** Per run, what judging reads of it (judge.ts, RunDigest): never its events. */
    const digests = new Map<RunId, RunDigest>();
    /** Runs in the order this plugin first saw them. */
    const order: RunId[] = [];
    const judged = new Map<RunId, RunVerdict[]>();
    const watchers = new Set<(c: VerdictChange) => void>();
    /** Places, nodes and paths, each kept once. */
    const strings = new Map<string, string>();
    const intern = (s: string) => {
      const had = strings.get(s);
      if (had !== undefined) return had;
      strings.set(s, s);
      return s;
    };
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
    /** Work that changes verdicts (listening again, reading runs again); a read waits for it. */
    let work = Promise.resolve();
    const queue = (job: () => Promise<void>) => {
      work = work.then(job).catch((err) => ctx.runtime.report(ctx.fiber, err));
    };
    const digestFor = (run: RunId) => {
      let d = digests.get(run);
      if (!d) {
        digests.set(run, (d = newDigest(run)));
        order.push(run);
      }
      return d;
    };
    /** Reads a run back from the exchange, a page at a time, into a digest of its own. */
    const readRun = async (run: RunId, begin?: { cwd?: string; replay_of?: RunId }) => {
      const d = newDigest(run, begin);
      for (let ev = await read.events(run, { limit: LIMIT_MAX }); ; ) {
        for (const e of ev.items) take(d, e, listening, intern);
        if (!ev.next) break;
        ev = await read.events(run, { limit: LIMIT_MAX, after: ev.next });
      }
      return d;
    };
    /**
     * Looks for a run's near misses again, reading it back from the
     * exchange with today's places and phrases: the only part of judging
     * that needs more of an act than its digest keeps. Near misses taken
     * live while it read stay.
     */
    const nearAgain = async (run: RunId) => {
      const d = digests.get(run);
      if (!d) return;
      const again = await readRun(run, d.begun ? { cwd: d.cwd, replay_of: d.replay_of } : undefined);
      for (const node of new Set([...d.near.keys(), ...again.near.keys()])) {
        const seqs = [...(again.near.get(node) ?? []), ...(d.near.get(node) ?? []).filter((s) => s > again.last)];
        if (seqs.length) d.near.set(node, seqs);
        else d.near.delete(node);
      }
      judged.delete(run);
    };
    /** Takes an event into its run's digest: false when it was seen already. */
    const add = (e: ExchangeEvent) => {
      const d = digestFor(e.run);
      if (!take(d, e, listening, intern)) return false;
      judged.delete(e.run);
      if (d.lateBegin) {
        d.lateBegin = false;
        queue(async () => {
          await nearAgain(e.run);
          notify({ run: e.run });
        });
      }
      return true;
    };
    const verdictsOf = (run: RunId): RunVerdict[] => {
      const d = digests.get(run);
      if (!d) return [];
      let v = judged.get(run);
      if (!v) judged.set(run, (v = judgeDigest(d, listening)));
      return v;
    };
    /** Live runs' records, or replays' (a run with `replay_of`): kept apart, so a replay never stands for a live run. */
    const allRecords = (replays = false) =>
      tally(
        order
          .map((run) => digests.get(run)!)
          .filter((d) => !!d.replay_of === replays)
          .map((d) => ({ verdicts: verdictsOf(d.run), said: d.said })),
      ).sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));

    // Watch first, then read back, so nothing appended in between is lost.
    // What comes live while reading back waits, so each run is taken in seq order.
    let held: ExchangeEvent[] | undefined = [];
    live.watch({}, (e) => {
      if (held) held.push(e);
      else if (add(e)) notify({ run: e.run });
    });
    /**
     * Reads where the nodes listen and what they prevent again. Only the
     * runs a changed node was said in are judged again; its near misses are
     * looked for again only where an act worked at its places, by reading
     * those runs back. Nothing else is read.
     */
    const listen = () =>
      queue(async () => {
        const was = listening;
        listening = listeningOf(await withMisses(graph, tree.nodes()));
        const changed = new Set<string>();
        const nearChanged = new Set<string>();
        for (const node of new Set([...was.keys(), ...listening.keys()])) {
          const a = was.get(node);
          const b = listening.get(node);
          if (JSON.stringify(a) === JSON.stringify(b)) continue;
          changed.add(node);
          const sig = (l?: Listener) => JSON.stringify(l ? [l.at, missPhrases(l.misses)] : null);
          if (sig(a) !== sig(b)) nearChanged.add(node);
        }
        const again: RunId[] = [];
        for (const d of digests.values()) {
          let touched = false;
          let reread = false;
          for (const node of changed) {
            if (!d.said.has(node)) continue;
            touched = true;
            if (!nearChanged.has(node)) continue;
            const l = listening.get(node);
            if (l && mayBeNear(d, l)) reread = true;
            else d.near.delete(node);
          }
          if (touched) judged.delete(d.run);
          if (reread) again.push(d.run);
        }
        for (const run of again) await nearAgain(run);
        notify({});
      });
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
    for (const run of past.reverse()) {
      if (digests.has(run)) continue;
      const d = await readRun(run);
      digests.set(run, d);
      order.push(run);
    }
    const waiting = held;
    held = undefined;
    for (const e of waiting) add(e);
    for (const d of digests.values()) {
      if (!d.lateBegin) continue;
      d.lateBegin = false;
      queue(() => nearAgain(d.run));
    }
    await work;

    ctx.provide<VerdictRead>("verdict.read", (_caller, from) => ({
      async run(run) {
        await work;
        return verdictsOf(run);
      },
      async records(page) {
        await work;
        return pageOf(allRecords(), page);
      },
      async record(node) {
        await work;
        return allRecords().find((r) => r.node === node);
      },
      async replayed(node) {
        await work;
        return allRecords(true).find((r) => r.node === node);
      },
      async verdicts(node, page) {
        await work;
        const list = [...order]
          .reverse()
          .flatMap((run) => (digests.get(run)?.said.has(node) ? verdictsOf(run).filter((v) => v.node === node) : []));
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
