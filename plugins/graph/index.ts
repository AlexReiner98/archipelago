/**
 * The graph plugin: items and links in a SQLite store (store.ts), and the
 * write chain. Provides graph.read, graph.watch, graph.stage and
 * graph.commit (spec/graph.md).
 *
 * The tables are the log's projection (the log is the truth, history's
 * journal): `config.db` names the database, kept across restarts; without
 * one it is in memory. The last `config.keep` committed sets are kept with
 * it, for `since` and for watchers resuming from a cursor; the whole log is
 * history's. Node only.
 */
import type { Committed, Proposed } from "../../spec/changeset.ts";
import type { Caller, Cursor, Dispose } from "../../spec/common.ts";
import { byPosition } from "../../spec/common.ts";
import type { GraphCommit, GraphRead, GraphStage, GraphWatch, Stage, WatchFilter } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { Store } from "./store.ts";

export { applyFacts } from "./store.ts";

export interface GraphConfig {
  /** The SQLite database the graph is kept in. None: in memory. */
  db?: string;
  /** How many committed change sets to keep. Default 1000. */
  keep?: number;
}

function touches(filter: WatchFilter, change: Committed, typeOf: (id: string) => string | undefined): boolean {
  return change.facts.some(([, id, field, value]) => {
    if (filter.ids && !filter.ids.includes(id)) return false;
    if (filter.fields && !filter.fields.includes(field)) return false;
    if (filter.types) {
      const t = field === "type" ? String(value) : typeOf(id);
      if (!t || !filter.types.includes(t)) return false;
    }
    return true;
  });
}

const graph: Plugin<GraphConfig> = {
  id: "graph",
  about: "Stores the map: its items and the links between them.",
  async apply(ctx: Context, config: GraphConfig = {}) {
    // The JSON graph's key: a tree still naming it must fail, not run on an empty graph in memory.
    if ("file" in config) throw new Error("graph: config.file was the JSON graph, now config.db (SQLite); move it with node scripts/graph.ts from-json, then import");
    if (config.db) {
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(config.db), { recursive: true });
    }
    const store = new Store(config.db, config.keep ?? 1000);
    const stages: { run: Stage; caller: Caller; n: number }[] = [];
    let stageN = 0;
    const watchers = new Set<{ filter: WatchFilter; on: (c: Committed, cursor: Cursor) => void }>();
    const typeOf = (id: string) => store.typeOf(id);

    /** One commit at a time, so stages and the store see the graph as each set left it. */
    let queue: Promise<unknown> = Promise.resolve();
    ctx.effect(() => () => {
      void queue.finally(() => store.close());
    });

    const toStore = async (change: Proposed): Promise<Committed> => {
      const committed = store.apply(change);
      for (const w of [...watchers]) {
        if (!touches(w.filter, committed, typeOf)) continue;
        try {
          w.on(committed, String(committed.seq));
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
      return committed;
    };

    const chain = (change: Proposed): Promise<Committed> => {
      const ordered = [...stages].sort((a, b) => byPosition(a.caller, b.caller) || a.n - b.n);
      const at = (i: number) => (c: Proposed): Promise<Committed> => (i < ordered.length ? ordered[i]!.run(c, at(i + 1)) : toStore(c));
      const next = queue.then(() => at(0)(change));
      queue = next.catch(() => {});
      return next;
    };

    ctx.provide<GraphRead>("graph.read", () => ({
      async get(ids) {
        return store.get(ids);
      },
      async of(type, page) {
        return store.of(type, page);
      },
      async links(id, opts, page) {
        return store.links(id, opts, page);
      },
      async since(page) {
        return store.since(page);
      },
      async now() {
        return store.now();
      },
    }));

    ctx.provide<GraphWatch>("graph.watch", (_caller, from) => ({
      watch(filter, on): Dispose {
        return from.effect(() => {
          const w = { filter, on };
          if (filter.after !== undefined) {
            let after: string | undefined = filter.after;
            do {
              const page = store.since({ after, limit: 500 });
              for (const c of page.items) if (touches(filter, c, typeOf)) on(c, String(c.seq));
              after = page.next;
            } while (after);
          }
          watchers.add(w);
          return () => watchers.delete(w);
        });
      },
    }));

    ctx.provide<GraphStage>("graph.stage", (caller, from) => ({
      stage(run): Dispose {
        return from.effect(() => {
          const s = { run, caller, n: stageN++ };
          stages.push(s);
          return () => {
            const i = stages.indexOf(s);
            if (i >= 0) stages.splice(i, 1);
          };
        });
      },
    }));

    ctx.provide<GraphCommit>("graph.commit", () => ({ commit: chain }));
  },
};

export default graph;
