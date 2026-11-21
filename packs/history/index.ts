/**
 * The history pack: the journal. A record stage on the write chain
 * (spec/graph.md): it calls `next` and writes each committed change set in
 * full, with its inverse (journal.ts). Old entries fold into snapshots.
 *
 * Provides the reserved action `history.undo` (spec/action.md): given a
 * change set id, it writes that set's inverse as one new change set, which
 * the action pack marks `undoes`. The graph refuses it with
 * `graph.conflict` if a field has moved since; nothing is merged silently.
 * Reads are actions too (`history.list`, `history.get`,
 * `history.snapshots`), so the harness view and agents reach them the same
 * way. The graph is the truth: nothing is rebuilt from the journal.
 * Node only.
 */
import type { ActionContext, ActionRegister, UndoInput } from "../../spec/action.ts";
import { UNDO } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphStage } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { Journal } from "./journal.ts";

export { Journal, netFacts } from "./journal.ts";

export interface HistoryConfig {
  /** The SQLite database the journal is kept in. None: in memory. */
  db?: string;
  /** How many entries are kept in full. Default 5000. */
  keep?: number;
  /** How many of the oldest fold into one snapshot, once there are `keep + fold`. Default 1000. */
  fold?: number;
}

const by = { pack: "history" };

const history: Pack<HistoryConfig> = {
  id: "history",
  about: "Keeps every change to the map, and undoes any of them.",
  inject: ["graph.stage", "action.register"],
  async apply(ctx: Context, config: HistoryConfig = {}) {
    if (config.db) {
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(config.db), { recursive: true });
    }
    const journal = new Journal(config.db);
    const keep = Math.max(1, config.keep ?? 5000);
    const fold = Math.max(1, config.fold ?? 1000);
    ctx.effect(() => () => journal.close());

    ctx.get<GraphStage>("graph.stage").stage(async (change, next) => {
      const committed = await next(change);
      // Applied already: a journal that fails to write is reported, never undoes the commit.
      try {
        journal.record(committed);
        journal.compact(keep, fold);
      } catch (err) {
        ctx.runtime.report(ctx.fiber, err);
      }
      return committed;
    });

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
