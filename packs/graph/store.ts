/**
 * The graph's store: items, links and the last committed change sets in
 * one SQLite database (Node's built-in `node:sqlite`, no dependency).
 *
 * - `items` holds each item's fields as one JSON object. `n` is the order
 *   it was first made in, which is the stable order of every page; `type`,
 *   `src` and `dst` are copies of its `type`, `from` and `to` fields, so
 *   reads by type and by link end are indexed.
 * - `changes` keeps the last `keep` committed sets, for `since` and for
 *   watchers resuming from a cursor. Journalling them is history's.
 * - `seen` keeps the type each id last had, after it is gone too, so a
 *   watcher by type hears of a removal.
 *
 * Every read is bounded. `apply` is all or nothing, in one transaction.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Committed, Fact, Proposed } from "../../spec/changeset.ts";
import type { Cursor, Id, Json, Page, PageRequest } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { Direction, Item, Link } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";

export type Fields = Record<string, Json>;

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b);

export function limitOf(page?: PageRequest): number {
  return Math.max(1, Math.min(page?.limit ?? 100, LIMIT_MAX));
}

export function itemOf(id: Id, fields: Fields): Item | Link {
  const { type, ...rest } = fields;
  const item: Item = { id, type: String(type), fields: rest };
  if (typeof rest.from === "string" && typeof rest.to === "string") return { ...item, from: rest.from, to: rest.to };
  return item;
}

/**
 * Applies facts to a copy of what they touch, all or nothing. A `+` on a
 * field holding another value, or a `-` of a value the field doesn't hold,
 * fails the whole set with `graph.conflict`. `items` need only hold the
 * ids the facts touch.
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

/** The facts that make an item as it is now: its type first, then its other fields. */
export function factsOf(id: Id, fields: Fields): Fact[] {
  const facts: Fact[] = [];
  if ("type" in fields) facts.push(["+", id, "type", fields.type!]);
  for (const [field, value] of Object.entries(fields)) if (field !== "type") facts.push(["+", id, field, value]);
  return facts;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT,
  src TEXT,
  dst TEXT,
  fields TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_type ON items (type, n);
CREATE INDEX IF NOT EXISTS items_src ON items (src, type, n);
CREATE INDEX IF NOT EXISTS items_dst ON items (dst, type, n);
CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, type TEXT NOT NULL);
`;

/** The store's own layout, so a later one can tell what it opens. */
const LAYOUT = "1";

type Row = { n: number; id: string; fields: string };

export class Store {
  readonly db: DatabaseSync;
  readonly readOnly: boolean;
  private seq: number;
  private readonly q: Record<string, StatementSync>;

  private readonly keep: number;

  /**
   * `file` is the database; none, or `:memory:`, keeps it in memory.
   * `readOnly` opens an existing one that nothing may write: an archive.
   */
  constructor(file: string = ":memory:", keep = 1000, opts: { readOnly?: boolean } = {}) {
    this.keep = keep;
    this.readOnly = !!opts.readOnly;
    this.db = new DatabaseSync(file, { readOnly: !!opts.readOnly });
    this.db.exec("PRAGMA busy_timeout = 5000;");
    if (!opts.readOnly) {
      if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
      this.db.exec(SCHEMA);
    }
    const layout = this.db.prepare("SELECT value FROM meta WHERE key = 'layout'").get() as { value: string } | undefined;
    if (!layout && !opts.readOnly) this.db.prepare("INSERT INTO meta (key, value) VALUES ('layout', ?)").run(LAYOUT);
    else if (layout?.value !== LAYOUT) throw new Error(`graph store ${file} has layout ${layout?.value ?? "none"}; this pack reads ${LAYOUT}`);
    const s = this.db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as { value: string } | undefined;
    this.seq = s ? Number(s.value) : 0;
    const p = (sql: string) => this.db.prepare(sql);
    // A read-only database refuses to prepare writes: those are left out, and apply refuses.
    const w = (sql: string) => (opts.readOnly ? (undefined as unknown as StatementSync) : p(sql));
    this.q = {
      one: p("SELECT n, id, fields FROM items WHERE id = ?"),
      many: p("SELECT id, fields FROM items WHERE id IN (SELECT value FROM json_each(?))"),
      of: p("SELECT n, id, fields FROM items WHERE type = ? AND n > ? ORDER BY n LIMIT ?"),
      out: p("SELECT n, id, fields FROM items WHERE src = ? AND (? IS NULL OR type = ?) AND n > ? ORDER BY n LIMIT ?"),
      in: p("SELECT n, id, fields FROM items WHERE dst = ? AND (? IS NULL OR type = ?) AND n > ? ORDER BY n LIMIT ?"),
      both: p("SELECT n, id, fields FROM items WHERE (src = ? OR dst = ?) AND (? IS NULL OR type = ?) AND n > ? ORDER BY n LIMIT ?"),
      all: p("SELECT n, id, fields FROM items WHERE n > ? ORDER BY n LIMIT ?"),
      insert: w("INSERT INTO items (id, type, src, dst, fields) VALUES (?, ?, ?, ?, ?)"),
      update: w("UPDATE items SET type = ?, src = ?, dst = ?, fields = ? WHERE id = ?"),
      remove: w("DELETE FROM items WHERE id = ?"),
      seen: w("INSERT INTO seen (id, type) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET type = excluded.type"),
      typeOf: p("SELECT type FROM seen WHERE id = ?"),
      log: w("INSERT INTO changes (seq, body) VALUES (?, ?)"),
      prune: w("DELETE FROM changes WHERE seq <= ?"),
      since: p("SELECT seq, body FROM changes WHERE seq > ? ORDER BY seq LIMIT ?"),
      setSeq: w("INSERT INTO meta (key, value) VALUES ('seq', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
      count: p("SELECT count(*) AS n FROM items"),
      types: p("SELECT type, count(*) AS n FROM items GROUP BY type ORDER BY type"),
    };
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  /** Applies a change set whole, or throws `Refused` and changes nothing. */
  apply(change: Proposed): Committed {
    if (this.readOnly) throw new Refused({ code: "graph.read_only", message: "This store is read-only: nothing writes to it.", by: { pack: "graph" } });
    const ids = [...new Set(change.facts.map((f) => f[1]))];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = new Map<Id, Fields>();
      const rows = new Set<Id>();
      for (const id of ids) {
        const row = this.q.one!.get(id) as Row | undefined;
        if (row) {
          now.set(id, JSON.parse(row.fields) as Fields);
          rows.add(id);
        }
      }
      const touched = applyFacts(now, change.facts);
      for (const [id, f] of touched) {
        if (!f) {
          if (rows.has(id)) this.q.remove!.run(id);
          continue;
        }
        const type = f.type === undefined ? null : String(f.type);
        const link = typeof f.from === "string" && typeof f.to === "string";
        const cols = [type, link ? (f.from as string) : null, link ? (f.to as string) : null, JSON.stringify(f)] as const;
        if (rows.has(id)) this.q.update!.run(...cols, id);
        else this.q.insert!.run(id, ...cols);
        if (type !== null) this.q.seen!.run(id, type);
      }
      const seq = this.seq + 1;
      const committed: Committed = { ...change, id: `c${seq}`, seq, committed: new Date().toISOString() };
      this.q.log!.run(seq, JSON.stringify(committed));
      if (seq > this.keep) this.q.prune!.run(seq - this.keep);
      this.q.setSeq!.run(String(seq));
      this.db.exec("COMMIT");
      this.seq = seq;
      return committed;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  get(ids: Id[]): (Item | null)[] {
    const want = ids.slice(0, LIMIT_MAX);
    const found = new Map<Id, Item>();
    for (const r of this.q.many!.all(JSON.stringify(want)) as Row[]) found.set(r.id, itemOf(r.id, JSON.parse(r.fields)));
    return want.map((id) => found.get(id) ?? null);
  }

  of(type: string, page?: PageRequest): Page<Item> {
    const limit = limitOf(page);
    return this.paged(this.q.of!.all(type, after(page), limit + 1) as Row[], limit);
  }

  links(id: Id, opts: { type?: string; dir: Direction }, page?: PageRequest): Page<Link> {
    const limit = limitOf(page);
    const t = opts.type ?? null;
    const rows =
      opts.dir === "both"
        ? this.q.both!.all(id, id, t, t, after(page), limit + 1)
        : this.q[opts.dir]!.all(id, t, t, after(page), limit + 1);
    return this.paged(rows as Row[], limit) as Page<Link>;
  }

  /** Every item, a page at a time, in the order they were made: for export, not for packs. */
  all(page?: PageRequest): Page<Item> {
    const limit = limitOf(page);
    return this.paged(this.q.all!.all(after(page), limit + 1) as Row[], limit);
  }

  since(page?: PageRequest): Page<Committed> {
    const limit = limitOf(page);
    const rows = this.q.since!.all(page?.after ? Number(page.after) : 0, limit + 1) as { seq: number; body: string }[];
    const items = rows.slice(0, limit).map((r) => JSON.parse(r.body) as Committed);
    return rows.length > limit ? { items, next: String(items.at(-1)!.seq) } : { items };
  }

  now(): Cursor {
    return String(this.seq);
  }

  /** The type an id has or last had. */
  typeOf(id: Id): string | undefined {
    return (this.q.typeOf!.get(id) as { type: string } | undefined)?.type;
  }

  /** How many items there are, all told and by type. */
  counts(): { items: number; types: Record<string, number> } {
    const types: Record<string, number> = {};
    for (const r of this.q.types!.all() as { type: string | null; n: number }[]) types[String(r.type)] = r.n;
    return { items: (this.q.count!.get() as { n: number }).n, types };
  }

  private paged(rows: Row[], limit: number): Page<Item> {
    const items = rows.slice(0, limit).map((r) => itemOf(r.id, JSON.parse(r.fields)));
    return rows.length > limit ? { items, next: String(rows[limit - 1]!.n) } : { items };
  }
}

function after(page?: PageRequest): number {
  return page?.after ? Number(page.after) || 0 : 0;
}
