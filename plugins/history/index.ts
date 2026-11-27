/**
 * The history plugin: the journal. A record stage on the write chain
 * (spec/graph.md): it calls `next` and writes each committed change set in
 * full, with its inverse (journal.ts). Old entries fold into snapshots.
 *
 * Provides the reserved action `history.undo` (spec/action.md): given a
 * change set id, it writes that set's inverse as one new change set, which
 * the action plugin marks `undoes`. The graph refuses it with
 * `graph.conflict` if a field has moved since; nothing is merged silently.
 * Reads are actions too (`history.list`, `history.since`, `history.get`,
 * `history.snapshots`), so the context interface and agents reach them the same
 * way. The log is the truth (decided 27 Nov 2026): the graph's tables are
 * its projection, and `history.verify` rebuilds them from it and compares.
 * Nothing folds unless `keep` is set. Node only.
 */
import type { ActionContext, ActionRegister, UndoInput } from "../../spec/action.ts";
import { UNDO } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphAll, GraphRead, GraphStage } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { Journal } from "./journal.ts";

export { Journal, netFacts } from "./journal.ts";

export interface HistoryConfig {
  /** The SQLite database the journal is kept in. None: in memory. */
  db?: string;
  /** How many entries are kept in full before the oldest fold. Unset (the default): every entry is kept, nothing folds. */
  keep?: number;
  /** How many of the oldest fold into one snapshot, once there are `keep + fold`. Default 1000; only with `keep`. */
  fold?: number;
}

const by = { plugin: "history" };

const history: Plugin<HistoryConfig> = {
  id: "history",
  about: "Keeps every change to the map, and undoes any of them.",
  inject: ["graph.stage", "graph.read", "graph.all", "action.register"],
  async apply(ctx: Context, config: HistoryConfig = {}) {
    if (config.db) {
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(config.db), { recursive: true });
    }
    const journal = new Journal(config.db);
    const keep = config.keep === undefined ? undefined : Math.max(1, config.keep);
    const fold = Math.max(1, config.fold ?? 1000);
    const graph = ctx.get<GraphRead>("graph.read");
    const all = ctx.get<GraphAll>("graph.all");

    /**
     * The whole map at one seq, read a page at a time (graph.all). A change
     * committed while it reads moves the seq, so it reads again, up to five
     * times; then it says so.
     */
    const checkpoint = async () => {
      for (let tries = 0; tries < 5; tries++) {
        const seq = Number(await graph.now());
        const items: [string, Record<string, Json>][] = [];
        let after: string | undefined;
        do {
          const page = await all.all({ limit: LIMIT_MAX, ...(after ? { after } : {}) });
          for (const it of page.items) items.push([it.id, { type: it.type, ...it.fields }]);
          after = page.next;
        } while (after);
        if (Number(await graph.now()) === seq) return journal.keepCheckpoint(seq, items);
      }
      throw new Refused({ code: "history.busy", message: "The map kept changing while it was read whole: try the checkpoint again.", by });
    };
    ctx.effect(() => () => journal.close());

    ctx.get<GraphStage>("graph.stage").stage(async (change, next) => {
      const committed = await next(change);
      // Applied already: a journal that fails to write is reported, never undoes the commit.
      try {
        journal.record(committed);
        if (keep !== undefined) journal.compact(keep, fold);
      } catch (err) {
        ctx.runtime.report(ctx.fiber, err);
      }
      return committed;
    });

    // Sets committed before the stage was on the chain (other plugins' first writes, as the map starts, or
    // while the plugin was off) are taken from the graph's recent sets, so the log misses none it still has.
    {
      let after = String(journal.last());
      let hole = false;
      for (;;) {
        const page = await graph.since({ after, limit: LIMIT_MAX });
        // The graph no longer holds what came after the journal's last set: the log has a hole.
        if (after !== "0" && page.items[0] && page.items[0].seq > Number(after) + 1 && Number(after) === journal.last()) hole = true;
        for (const c of page.items) journal.record(c);
        if (!page.next || !page.items.length) break;
        after = page.next;
      }
      // A log that doesn't reach back to the first change, or has a hole, starts again from the whole map now.
      if (hole || !journal.reachesBack()) {
        try {
          await checkpoint();
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    }

    const register = ctx.get<ActionRegister>("action.register");

    register.register({
      name: UNDO,
      title: "Undo a change set: apply its inverse as a new one",
      doc: "Writes the inverse of a committed change set, marked as undoing it. Refused if it is no longer in the journal, already undone, or a field it touched has changed since (graph.conflict): undo the later change first. Undoing an undo redoes.",
      input: {
        type: "object",
        properties: { change: { type: "string", description: "The id of the committed change set, c<seq>" } },
        required: ["change"],
      },
      async run(input: UndoInput, call: ActionContext) {
        const entry = journal.get(input.change);
        if (!entry) {
          const seq = Number(/^c(\d+)$/.exec(input.change)?.[1]);
          const n = Number.isFinite(seq) ? journal.foldedInto(seq) : undefined;
          throw new Refused(
            n === undefined
              ? { code: "history.unknown", message: `${input.change} is not in the journal.`, by }
              : { code: "history.compacted", message: `${input.change} was folded into snapshot ${n}; only its net change is kept, so it can't be undone alone.`, by, detail: { snapshot: n } },
          );
        }
        if (entry.undoneBy) {
          throw new Refused({ code: "history.undone", message: `${input.change} is already undone by ${entry.undoneBy}; undo that to redo it.`, by, detail: { by: entry.undoneBy } });
        }
        call.write(entry.inverse);
        return { undoes: entry.id, facts: entry.inverse.length };
      },
    });

    const pageInput = {
      limit: { type: "number", description: "At most this many (capped at 500)" },
      after: { type: "string", description: "The `next` cursor of the page before" },
    };

    register.register({
      name: "history.list",
      title: "The journal, newest first",
      doc: "Committed change sets in full (header, facts, inverse, undone by), newest first. `item` narrows to the sets touching one item (its fields, or a link to or from it); else `run` to one run's. Writes nothing.",
      input: { type: "object", properties: { run: { type: "string" }, item: { type: "string", description: "An item's id: the sets that touch it" }, ...pageInput } },
      async run(input: { run?: string; item?: string; limit?: number; after?: string }) {
        const only = input.item ? { item: input.item } : input.run ? { run: input.run } : {};
        return journal.entries(only, { limit: input.limit, after: input.after }) as unknown as Json;
      },
    });

    register.register({
      name: "history.since",
      title: "The journal, oldest first, after a seq",
      doc: "Committed change sets in full, in the order they were committed, after `after` (a seq; absent, from the start). `begins` is the first seq the journal holds: above 1, the start is in a snapshot or was never kept. Writes nothing.",
      input: { type: "object", properties: pageInput },
      async run(input: { limit?: number; after?: string }) {
        const page = journal.since({ limit: input.limit, after: input.after });
        const begins = journal.begins();
        const cp = journal.checkpoint();
        return { ...page, ...(begins !== undefined ? { begins } : {}), ...(cp ? { checkpoint: { seq: cp.seq, items: cp.items, at: cp.at } } : {}) } as unknown as Json;
      },
    });

    register.register({
      name: "history.checkpoint",
      title: "Keep the whole map at this seq",
      doc: "Reads every item (graph.all, a page at a time) and keeps them as the log's checkpoint at the seq they were read at: from then on the log is the checkpoint and every entry after it. Made on load when the log doesn't reach back to the first change. Writes nothing to the map.",
      input: { type: "object", properties: {} },
      async run() {
        return (await checkpoint()) as unknown as Json;
      },
    });

    register.register({
      name: "history.state",
      title: "The latest checkpoint's items",
      doc: "The whole map at the latest checkpoint's seq, a page of items at a time (`{ id, fields }`, by id), with that `seq`. Nothing when there is none. Writes nothing.",
      input: { type: "object", properties: pageInput },
      async run(input: { limit?: number; after?: string }) {
        const cp = journal.checkpoint();
        if (!cp) return { items: [] };
        return { seq: cp.seq, ...journal.checkpointItems(cp.n, { limit: input.limit, after: input.after }) } as unknown as Json;
      },
    });

    register.register({
      name: "history.verify",
      title: "Rebuild the map from the log and compare",
      doc: "Replays the journal (snapshots, then entries) into items and compares each with the graph's tables, read by id, LIMIT_MAX at a time. `complete`: the log begins at the first change and holds every one the graph committed. `differ`: how many items the tables hold otherwise than the log makes them, with up to 20. Writes nothing.",
      input: { type: "object", properties: {} },
      async run() {
        const { items, sets, from } = journal.replay();
        const begins = journal.begins();
        const last = journal.since({ after: String(Number(await graph.now()) - 1), limit: 1 }).items[0]?.seq;
        const now = Number(await graph.now());
        const ids = [...items.keys()];
        const differ: { id: string; field: string; log?: Json; table?: Json }[] = [];
        let count = 0;
        for (let i = 0; i < ids.length; i += LIMIT_MAX) {
          const batch = ids.slice(i, i + LIMIT_MAX);
          const got = await graph.get(batch);
          batch.forEach((id, k) => {
            const log = items.get(id)!;
            const it = got[k];
            const table: Record<string, Json> = it ? { type: it.type, ...it.fields } : {};
            const fields = new Set([...Object.keys(log), ...Object.keys(table)]);
            let off = false;
            for (const f of fields) {
              if (JSON.stringify(log[f]) === JSON.stringify(table[f])) continue;
              off = true;
              if (differ.length < 20) differ.push({ id, field: f, ...(log[f] !== undefined ? { log: log[f] } : {}), ...(table[f] !== undefined ? { table: table[f] } : {}) });
            }
            if (off) count++;
          });
        }
        return { complete: journal.reachesBack() && last === now, ...(begins !== undefined ? { begins } : {}), ...(from !== undefined ? { from } : {}), now, sets, items: items.size, differ: count, examples: differ } as unknown as Json;
      },
    });

    register.register({
      name: "history.get",
      title: "One change set from the journal",
      input: { type: "object", properties: { change: { type: "string" } }, required: ["change"] },
      async run(input: { change: string }) {
        const entry = journal.get(input.change);
        if (!entry) throw new Refused({ code: "history.unknown", message: `${input.change} is not in the journal.`, by });
        return entry as unknown as Json;
      },
    });

    register.register({
      name: "history.snapshots",
      title: "What older change sets were folded into",
      doc: "Each snapshot: the seqs it covers, who and what made them, and their net facts. Newest first. Writes nothing.",
      input: { type: "object", properties: pageInput },
      async run(input: { limit?: number; after?: string }) {
        return journal.snapshots({ limit: input.limit, after: input.after }) as unknown as Json;
      },
    });
  },
};

export default history;
