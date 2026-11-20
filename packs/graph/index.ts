/**
 * The graph pack, minimal: items and links in memory, kept on disk, and
 * the write chain. Provides graph.read, graph.watch, graph.stage and
 * graph.commit (spec/graph.md).
 *
 * The graph is the truth: when `config.file` names a file, the items are
 * written there after each commit and read back on load. Committed change
 * sets are kept in memory, the last `config.keep` of them, for `since` and
 * for watchers resuming from a cursor; journalling them is history's.
 */
import type { Committed, Fact, Proposed } from "../../spec/changeset.ts";
import type { Caller, Cursor, Dispose, Id, Json, Page, PageRequest } from "../../spec/common.ts";
import { Refused, byPosition } from "../../spec/common.ts";
import type { GraphCommit, GraphRead, GraphStage, GraphWatch, Item, Link, Stage, WatchFilter } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export interface GraphConfig {
  /** A JSON file the items are kept in. Node only. */
  file?: string;
  /** How many committed change sets to keep in memory. Default 1000. */
  keep?: number;
}

type Fields = Record<string, Json>;

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b);

function limitOf(page?: PageRequest): number {
  return Math.max(1, Math.min(page?.limit ?? 100, LIMIT_MAX));
}

function pageOf<T>(list: T[], page?: PageRequest): Page<T> {
  const start = page?.after ? Number(page.after) : 0;
  const end = start + limitOf(page);
  const items = list.slice(start, end);
  return end < list.length ? { items, next: String(end) } : { items };
}

function itemOf(id: Id, fields: Fields): Item | Link {
  const { type, ...rest } = fields;
  const item: Item = { id, type: String(type), fields: rest };
  if (typeof rest.from === "string" && typeof rest.to === "string") return { ...item, from: rest.from, to: rest.to };
  return item;
}

/**
 * Applies facts to a copy of what they touch, all or nothing. A `+` on a
 * field holding another value, or a `-` of a value the field doesn't hold,
 * fails the whole set with `graph.conflict`.
 */
export function applyFacts(items: Map<Id, Fields>, facts: readonly Fact[]): Map<Id, Fields | null> {
  const touched = new Map<Id, Fields | null>();
  const fieldsOf = (id: Id) => {
    if (!touched.has(id)) touched.set(id, items.has(id) ? { ...items.get(id)! } : null);
    return touched.get(id);
  };
  const conflicts: Json[] = [];
  for (const fact of facts) {
    const [op, id, field, value] = fact;
    const f = fieldsOf(id) ?? {};
    if (op === "+") {
      if (field in f && !same(f[field], value)) conflicts.push(fact);
      else f[field] = value;
    } else {
      if (!same(f[field], value)) conflicts.push(fact);
      else delete f[field];
    }
    touched.set(id, Object.keys(f).length ? f : null);
  }
  if (conflicts.length) {
    throw new Refused({
      code: "graph.conflict",
      message: `${conflicts.length} fact(s) don't hold against the graph now: a field set to another value, or a retraction of a value it doesn't hold.`,
      by: { pack: "graph" },
      detail: conflicts,
    });
  }
  return touched;
}

function touches(filter: WatchFilter, change: Committed, typeOf: (id: Id) => string | undefined): boolean {
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

const graph: Pack<GraphConfig> = {
  id: "graph",
  async apply(ctx: Context, config: GraphConfig = {}) {
    const items = new Map<Id, Fields>();
    /** The type each id had, kept after it is removed, so a watcher by type hears of its removal. */
    const typeOf = new Map<Id, string>();
    if (config.file) {
      const { readFile } = await import("node:fs/promises");
      try {
        const saved = JSON.parse(await readFile(config.file, "utf8")) as { seq: number; items: Record<Id, Fields> };
        for (const [id, f] of Object.entries(saved.items)) {
          items.set(id, f);
          typeOf.set(id, String(f.type));
        }
      } catch {
        // No file yet: an empty graph.
      }
    }
    const keep = config.keep ?? 1000;
    const log: Committed[] = [];
    let seq = 0;
    const save = config.file ? await writer(config.file) : undefined;
    const stages: { run: Stage; caller: Caller; n: number }[] = [];
    let stageN = 0;
    const watchers = new Set<{ filter: WatchFilter; on: (c: Committed, cursor: Cursor) => void }>();

    const store = async (change: Proposed): Promise<Committed> => {
      const touched = applyFacts(items, change.facts);
      for (const [id, f] of touched) {
        if (f) {
          items.set(id, f);
          if (f.type !== undefined) typeOf.set(id, String(f.type));
        } else items.delete(id);
      }
      const committed: Committed = { ...change, id: `c${++seq}`, seq, committed: new Date().toISOString() };
      log.push(committed);
      if (log.length > keep) log.splice(0, log.length - keep);
      await save?.({ seq, items: Object.fromEntries(items) });
      for (const w of [...watchers]) {
        if (!touches(w.filter, committed, (id) => typeOf.get(id))) continue;
        try {
          w.on(committed, String(committed.seq));
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
      return committed;
    };

    /** One commit at a time, so stages and the store see the graph as each set left it. */
    let queue: Promise<unknown> = Promise.resolve();
    const chain = (change: Proposed): Promise<Committed> => {
      const ordered = [...stages].sort((a, b) => byPosition(a.caller, b.caller) || a.n - b.n);
      const at = (i: number) => (c: Proposed): Promise<Committed> => (i < ordered.length ? ordered[i]!.run(c, at(i + 1)) : store(c));
      const next = queue.then(() => at(0)(change));
      queue = next.catch(() => {});
      return next;
    };

    ctx.provide<GraphRead>("graph.read", () => ({
      async get(ids) {
        return ids.slice(0, LIMIT_MAX).map((id) => (items.has(id) ? itemOf(id, items.get(id)!) : null));
      },
      async of(type, page) {
        const list: Item[] = [];
        for (const [id, f] of items) if (f.type === type) list.push(itemOf(id, f));
        return pageOf(list, page);
      },
      async links(id, opts, page) {
        const list: Link[] = [];
        for (const [lid, f] of items) {
          if (opts.type && f.type !== opts.type) continue;
          const out = f.from === id && opts.dir !== "in";
          const inn = f.to === id && opts.dir !== "out";
          if ((out || inn) && typeof f.from === "string" && typeof f.to === "string") list.push(itemOf(lid, f) as Link);
        }
        return pageOf(list, page);
      },
      async since(page) {
        const after = page?.after ? Number(page.after) : 0;
        const list = log.filter((c) => c.seq > after).slice(0, limitOf(page));
        const last = list.at(-1);
        return last && log.some((c) => c.seq > last.seq) ? { items: list, next: String(last.seq) } : { items: list };
      },
      async now() {
        return String(seq);
      },
    }));

    ctx.provide<GraphWatch>("graph.watch", (_caller, from) => ({
      watch(filter, on): Dispose {
        return from.effect(() => {
          const w = { filter, on };
          if (filter.after !== undefined) {
            const after = Number(filter.after);
            for (const c of log) if (c.seq > after && touches(filter, c, (id) => typeOf.get(id))) on(c, String(c.seq));
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

async function writer(file: string): Promise<(state: unknown) => Promise<void>> {
  const { writeFile, rename, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true });
  let queue = Promise.resolve();
  return (state) =>
    (queue = queue.then(async () => {
      await writeFile(`${file}.tmp`, JSON.stringify(state));
      await rename(`${file}.tmp`, file);
    }));
}

export default graph;
