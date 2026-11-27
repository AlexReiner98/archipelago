/**
 * The journal's store: every committed change set in full, with its
 * inverse, in one SQLite database (Node's built-in `node:sqlite`).
 *
 * - `entries` holds the newest sets whole: header, facts, inverse, and
 *   which later set undid it, if one has.
 * - `checkpoints` hold the whole map at one seq, each item's fields, for a
 *   map whose entries don't reach back to its first change (a journal
 *   begun late): the log is then the latest checkpoint and every entry
 *   after it.
 * - `snapshots` holds what older entries were folded into, when a map
 *   folds at all (off unless `keep` is set): the range they covered, who
 *   made them, and their net facts (each field touched, from the value it
 *   had before the range to the value it had after). The log is the truth:
 *   snapshots then entries, in order, rebuild every item (`replay`).
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ChangeSetId, Committed, Fact, Header } from "../../spec/changeset.ts";
import { inverse } from "../../spec/changeset.ts";
import type { Json, Page, PageRequest } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import { headerNow } from "../graph/renamed.ts";

const BY = { plugin: "history" };

/** One item from one point in the log to another. */
export interface Difference {
  id: string;
  /** Made: it had no fields before. Gone: none after. Else changed. */
  change: "made" | "gone" | "changed";
  type?: string;
  title?: string;
  /** Each field whose value differs, with what it held at each point (absent: empty). */
  fields: { field: string; before?: Json; after?: Json }[];
  /** The sets that touched it in between, oldest first, at most 10. */
  changes: string[];
}

/** An item's fields at two points, compared; null when they are the same. Pure. */
export function difference(id: string, before: Record<string, Json> | undefined, after: Record<string, Json> | undefined): Omit<Difference, "changes"> | null {
  const b = before ?? {};
  const a = after ?? {};
  const fields: Difference["fields"] = [];
  for (const field of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (same(b[field], a[field])) continue;
    fields.push({ field, ...(b[field] !== undefined ? { before: b[field] } : {}), ...(a[field] !== undefined ? { after: a[field] } : {}) });
  }
  if (!fields.length) return null;
  const empty = (x: Record<string, Json>) => Object.keys(x).length === 0;
  const type = (a.type ?? b.type) as string | undefined;
  const title = (a.title ?? b.title) as string | undefined;
  return {
    id,
    change: empty(b) ? "made" : empty(a) ? "gone" : "changed",
    ...(typeof type === "string" ? { type } : {}),
    ...(typeof title === "string" ? { title } : {}),
    fields,
  };
}

export interface Entry {
  id: ChangeSetId;
  seq: number;
  committed: string;
  header: Header;
  facts: Fact[];
  inverse: Fact[];
  /** The set that undid this one, while that undo stands. */
  undoneBy?: ChangeSetId;
}

/** The whole map at one seq. */
export interface Checkpoint {
  n: number;
  seq: number;
  at: string;
  items: number;
}

export interface Snapshot {
  n: number;
  /** The first and last seq folded into it. */
  first: number;
  last: number;
  from: string;
  to: string;
  /** How many sets it folds. */
  count: number;
  actors: string[];
  plugins: string[];
  actions: string[];
  /** The net change across the range: retract what was before, assert what was after. */
  facts: Fact[];
}

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The net facts of a run of change sets, in order: for each field touched,
 * a retraction of what it held before the first and an assertion of what it
 * held after the last, where they differ. Applied to the graph as it was
 * before the run, it leaves the graph as it was after.
 */
export function netFacts(sets: readonly (readonly Fact[])[]): Fact[] {
  const at = new Map<string, { id: string; field: string; before?: Json; after?: Json }>();
  for (const facts of sets) {
    for (const [op, id, field, value] of facts) {
      const key = JSON.stringify([id, field]);
      let f = at.get(key);
      if (!f) {
        // The first fact on a field says what it held: a retraction names it, an assertion means it was empty.
        f = { id, field, ...(op === "-" ? { before: value, after: value } : {}) };
        at.set(key, f);
      }
      if (op === "+") f.after = value;
      else delete f.after;
    }
  }
  const out: Fact[] = [];
  for (const f of at.values()) {
    if (same(f.before, f.after)) continue;
    if (f.before !== undefined) out.push(["-", f.id, f.field, f.before]);
  }
  for (const f of at.values()) {
    if (same(f.before, f.after)) continue;
    if (f.after !== undefined) out.push(["+", f.id, f.field, f.after]);
  }
  return out;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entries (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  run TEXT,
  committed TEXT NOT NULL,
  header TEXT NOT NULL,
  facts TEXT NOT NULL,
  inverse TEXT NOT NULL,
  undone_by TEXT
);
CREATE INDEX IF NOT EXISTS entries_run ON entries (run, seq);
CREATE TABLE IF NOT EXISTS touches (id TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (id, seq)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS touches_seq ON touches (seq);
CREATE TABLE IF NOT EXISTS checkpoints (n INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL, at TEXT NOT NULL, items INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoint_items (n INTEGER NOT NULL, id TEXT NOT NULL, fields TEXT NOT NULL, PRIMARY KEY (n, id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS snapshots (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  first INTEGER NOT NULL,
  last INTEGER NOT NULL,
  body TEXT NOT NULL
);
`;

const LAYOUT = "1";

/**
 * The items a set's facts touch: each fact's id, and the items a link's
 * `from` and `to` name, so a link made or cut shows on both its ends.
 */
export function touched(facts: readonly Fact[]): string[] {
  const out = new Set<string>();
  for (const [, id, field, value] of facts) {
    out.add(id);
    if ((field === "from" || field === "to") && typeof value === "string") out.add(value);
  }
  return [...out];
}

type Row = { seq: number; id: string; committed: string; header: string; facts: string; inverse: string; undone_by: string | null };

function entryOf(r: Row): Entry {
  const e: Entry = {
    id: r.id,
    seq: r.seq,
    committed: r.committed,
    header: headerNow(JSON.parse(r.header) as Header),
    facts: JSON.parse(r.facts) as Fact[],
    inverse: JSON.parse(r.inverse) as Fact[],
  };
  if (r.undone_by) e.undoneBy = r.undone_by;
  return e;
}

export class Journal {
  readonly db: DatabaseSync;
  private readonly q: Record<string, StatementSync>;

  constructor(file: string = ":memory:") {
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    const layout = this.db.prepare("SELECT value FROM meta WHERE key = 'layout'").get() as { value: string } | undefined;
    if (!layout) this.db.prepare("INSERT INTO meta (key, value) VALUES ('layout', ?)").run(LAYOUT);
    else if (layout.value !== LAYOUT) throw new Error(`history journal ${file} has layout ${layout.value}; this plugin reads ${LAYOUT}`);
    const p = (sql: string) => this.db.prepare(sql);
    this.q = {
      add: p("INSERT OR IGNORE INTO entries (seq, id, run, committed, header, facts, inverse) VALUES (?, ?, ?, ?, ?, ?, ?)"),
      one: p("SELECT * FROM entries WHERE id = ?"),
      undone: p("UPDATE entries SET undone_by = ? WHERE id = ?"),
      newest: p("SELECT * FROM entries WHERE seq < ? ORDER BY seq DESC LIMIT ?"),
      newestRun: p("SELECT * FROM entries WHERE run = ? AND seq < ? ORDER BY seq DESC LIMIT ?"),
      newestItem: p("SELECT e.* FROM touches t JOIN entries e ON e.seq = t.seq WHERE t.id = ? AND t.seq < ? ORDER BY t.seq DESC LIMIT ?"),
      touch: p("INSERT OR IGNORE INTO touches (id, seq) VALUES (?, ?)"),
      untouch: p("DELETE FROM touches WHERE seq <= ?"),
      count: p("SELECT count(*) AS n FROM entries"),
      oldest: p("SELECT * FROM entries ORDER BY seq LIMIT ?"),
      drop: p("DELETE FROM entries WHERE seq <= ?"),
      snap: p("INSERT INTO snapshots (first, last, body) VALUES (?, ?, ?)"),
      snaps: p("SELECT n, body FROM snapshots WHERE n < ? ORDER BY n DESC LIMIT ?"),
      covering: p("SELECT n FROM snapshots WHERE first <= ? AND last >= ? LIMIT 1"),
      forward: p("SELECT * FROM entries WHERE seq > ? ORDER BY seq LIMIT ?"),
      first: p("SELECT min(seq) AS seq FROM entries"),
      snapFirst: p("SELECT min(first) AS first FROM snapshots"),
      snapsUp: p("SELECT body FROM snapshots ORDER BY first"),
    };
    // A journal written before `touches` was kept is indexed once, on open.
    if (!this.db.prepare("SELECT value FROM meta WHERE key = 'touches'").get()) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const r of this.db.prepare("SELECT seq, facts FROM entries").iterate() as Iterable<{ seq: number; facts: string }>) {
          for (const id of touched(JSON.parse(r.facts) as Fact[])) this.q.touch!.run(id, r.seq);
        }
        this.db.prepare("INSERT INTO meta (key, value) VALUES ('touches', '1')").run();
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  /**
   * Writes a committed set whole. When it undoes another, marks that one
   * undone by it; when the one it undoes was itself an undo, the set that
   * one undid stands again, so its mark is cleared.
   */
  record(c: Committed): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.q.add!.run(c.seq, c.id, c.header.run ?? null, c.committed, JSON.stringify(c.header), JSON.stringify(c.facts), JSON.stringify(inverse(c.facts)));
      for (const id of touched(c.facts)) this.q.touch!.run(id, c.seq);
      if (c.header.undoes) {
        const undone = this.get(c.header.undoes);
        this.q.undone!.run(c.id, c.header.undoes);
        if (undone?.header.undoes) this.q.undone!.run(null, undone.header.undoes);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  get(id: ChangeSetId): Entry | undefined {
    const r = this.q.one!.get(id) as Row | undefined;
    return r ? entryOf(r) : undefined;
  }

  /** The snapshot a seq was folded into, if any. */
  foldedInto(seq: number): number | undefined {
    return (this.q.covering!.get(seq, seq) as { n: number } | undefined)?.n;
  }

  /** Entries newest first, a page at a time; `item` narrows to those touching one item, else `run` to one run's. */
  entries(opts: { run?: string; item?: string } = {}, page?: PageRequest): Page<Entry> {
    const limit = Math.max(1, Math.min(page?.limit ?? 50, LIMIT_MAX));
    const before = page?.after ? Number(page.after) : Number.MAX_SAFE_INTEGER;
    const rows = (
      opts.item
        ? this.q.newestItem!.all(opts.item, before, limit + 1)
        : opts.run
          ? this.q.newestRun!.all(opts.run, before, limit + 1)
          : this.q.newest!.all(before, limit + 1)
    ) as Row[];
    const items = rows.slice(0, limit).map(entryOf);
    return rows.length > limit ? { items, next: String(items.at(-1)!.seq) } : { items };
  }

  snapshots(page?: PageRequest): Page<Snapshot> {
    const limit = Math.max(1, Math.min(page?.limit ?? 50, LIMIT_MAX));
    const before = page?.after ? Number(page.after) : Number.MAX_SAFE_INTEGER;
    const rows = this.q.snaps!.all(before, limit + 1) as { n: number; body: string }[];
    const items = rows.slice(0, limit).map((r) => ({ n: r.n, ...(JSON.parse(r.body) as Omit<Snapshot, "n">) }));
    return rows.length > limit ? { items, next: String(items.at(-1)!.n) } : { items };
  }

  /** Entries oldest first, after `page.after` (a seq), a page at a time. */
  since(page?: PageRequest): Page<Entry> {
    const limit = Math.max(1, Math.min(page?.limit ?? 50, LIMIT_MAX));
    const rows = this.q.forward!.all(page?.after ? Number(page.after) : 0, limit + 1) as Row[];
    const items = rows.slice(0, limit).map(entryOf);
    return rows.length > limit ? { items, next: String(items.at(-1)!.seq) } : { items };
  }

  /** The last seq the log holds, in an entry or a snapshot; 0 while it is empty. */
  last(): number {
    const e = (this.db.prepare("SELECT max(seq) AS seq FROM entries").get() as { seq: number | null }).seq ?? 0;
    const s = (this.db.prepare("SELECT max(last) AS last FROM snapshots").get() as { last: number | null }).last ?? 0;
    return Math.max(e, s);
  }

  /** The latest checkpoint, if one was made. */
  checkpoint(): Checkpoint | undefined {
    return this.db.prepare("SELECT n, seq, at, items FROM checkpoints ORDER BY n DESC LIMIT 1").get() as Checkpoint | undefined;
  }

  /** Keeps the whole map at `seq`: each item's fields, `type` among them. */
  keepCheckpoint(seq: number, items: Iterable<[string, Record<string, Json>]>): Checkpoint {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const at = new Date().toISOString();
      const { lastInsertRowid } = this.db.prepare("INSERT INTO checkpoints (seq, at, items) VALUES (?, ?, 0)").run(seq, at);
      const n = Number(lastInsertRowid);
      const add = this.db.prepare("INSERT INTO checkpoint_items (n, id, fields) VALUES (?, ?, ?)");
      let count = 0;
      for (const [id, fields] of items) {
        add.run(n, id, JSON.stringify(fields));
        count++;
      }
      this.db.prepare("UPDATE checkpoints SET items = ? WHERE n = ?").run(count, n);
      this.db.exec("COMMIT");
      return { n, seq, at, items: count };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** A checkpoint's items, a page at a time, by id. */
  checkpointItems(n: number, page?: PageRequest): Page<{ id: string; fields: Record<string, Json> }> {
    const limit = Math.max(1, Math.min(page?.limit ?? 50, LIMIT_MAX));
    const rows = this.db.prepare("SELECT id, fields FROM checkpoint_items WHERE n = ? AND id > ? ORDER BY id LIMIT ?").all(n, page?.after ?? "", limit + 1) as { id: string; fields: string }[];
    const items = rows.slice(0, limit).map((r) => ({ id: r.id, fields: JSON.parse(r.fields) as Record<string, Json> }));
    return rows.length > limit ? { items, next: items.at(-1)!.id } : { items };
  }

  /**
   * Whether the log reaches back: its entries begin at the first change, or
   * a checkpoint holds everything before the entries after it.
   */
  reachesBack(): boolean {
    const begins = this.begins();
    if (begins === undefined || begins === 1) return true;
    const cp = this.checkpoint();
    return !!cp && cp.seq + 1 >= begins;
  }

  /** Where the log begins: the first seq it holds, in a snapshot or an entry; undefined while it is empty. */
  begins(): number | undefined {
    const s = (this.q.snapFirst!.get() as { first: number | null }).first;
    const e = (this.q.first!.get() as { seq: number | null }).seq;
    return s ?? e ?? undefined;
  }

  /**
   * Every item as the log makes it: each snapshot's net facts, then each
   * entry's facts, in order, applied to nothing. A field holds the last
   * value asserted; a retraction empties it; an item with no fields left is
   * gone. Reads the journal's own store, a row at a time.
   */
  replay(): { items: Map<string, Record<string, Json>>; sets: number; from?: number } {
    return this.walk(Number.MAX_SAFE_INTEGER);
  }

  /**
   * Every item as the log makes it up to `upTo` (a seq): the map as that
   * set left it. `each` is called with each set (a snapshot as one, at its
   * first seq) before it is applied. Refused where the log can't say:
   * before it begins or its checkpoint (`history.before`), or inside a
   * fold (`history.compacted`, only the fold's net change is kept).
   */
  walk(
    upTo: number,
    each?: (set: { seq: number; id?: ChangeSetId; facts: readonly Fact[] }, items: ReadonlyMap<string, Record<string, Json>>) => void,
  ): { items: Map<string, Record<string, Json>>; sets: number; from?: number } {
    const items = new Map<string, Record<string, Json>>();
    const apply = (facts: readonly Fact[]) => {
      for (const [op, id, field, value] of facts) {
        const it = items.get(id) ?? {};
        if (op === "+") it[field] = value;
        else if (same(it[field], value)) delete it[field];
        if (Object.keys(it).length) items.set(id, it);
        else items.delete(id);
      }
    };
    let sets = 0;
    const full = upTo === Number.MAX_SAFE_INTEGER;
    // From the start where the entries (and snapshots) reach it; else from the latest checkpoint.
    const cp = this.begins() === 1 ? undefined : this.checkpoint();
    if (!full && !this.reachesBack()) {
      throw new Refused({ code: "history.before", message: "The log doesn't reach back to the map's first change, and no checkpoint covers the start: history.checkpoint keeps one.", by: BY });
    }
    if (cp) {
      if (upTo < cp.seq) {
        throw new Refused({ code: "history.before", message: `The log begins at its checkpoint, c${cp.seq} (${cp.at}): it can't say what the map was before.`, by: BY, detail: { checkpoint: cp.seq } });
      }
      for (const r of this.db.prepare("SELECT id, fields FROM checkpoint_items WHERE n = ?").iterate(cp.n) as Iterable<{ id: string; fields: string }>) {
        items.set(r.id, JSON.parse(r.fields) as Record<string, Json>);
      }
    } else {
      for (const r of this.q.snapsUp!.iterate() as Iterable<{ body: string }>) {
        const snap = JSON.parse(r.body) as Omit<Snapshot, "n">;
        if (snap.first > upTo) break;
        if (snap.last > upTo) {
          throw new Refused({ code: "history.compacted", message: `c${upTo} is inside a fold (c${snap.first}–c${snap.last}): only its net change is kept.`, by: BY, detail: { first: snap.first, last: snap.last } });
        }
        each?.({ seq: snap.first, facts: snap.facts }, items);
        apply(snap.facts);
        sets += snap.count;
      }
    }
    for (const r of this.db.prepare("SELECT seq, id, facts FROM entries WHERE seq > ? AND seq <= ? ORDER BY seq").iterate(cp?.seq ?? 0, upTo) as Iterable<{ seq: number; id: string; facts: string }>) {
      const facts = JSON.parse(r.facts) as Fact[];
      each?.({ seq: r.seq, id: r.id, facts }, items);
      apply(facts);
      sets++;
    }
    return { items, sets, ...(cp ? { from: cp.seq } : {}) };
  }

  /**
   * The last seq committed at or before `time` (an ISO instant): the map as
   * it was then. 0 when nothing was yet. Refused (`history.compacted`) when
   * the time falls inside a fold, whose sets are no longer told apart.
   */
  seqAt(time: string): number {
    const e = (this.db.prepare("SELECT max(seq) AS seq FROM entries WHERE committed <= ?").get(time) as { seq: number | null }).seq ?? 0;
    let s = 0;
    for (const r of this.q.snapsUp!.iterate() as Iterable<{ body: string }>) {
      const snap = JSON.parse(r.body) as Omit<Snapshot, "n">;
      if (snap.from <= time && time < snap.to) {
        throw new Refused({ code: "history.compacted", message: `${time} is inside a fold (${snap.from} to ${snap.to}): only its net change is kept.`, by: BY, detail: { first: snap.first, last: snap.last } });
      }
      if (snap.to <= time) s = Math.max(s, snap.last);
    }
    return Math.max(e, s);
  }

  /** When the set at or last before `seq` was committed; undefined before the first. */
  timeOf(seq: number): string | undefined {
    const e = this.db.prepare("SELECT committed FROM entries WHERE seq <= ? ORDER BY seq DESC LIMIT 1").get(seq) as { committed: string } | undefined;
    if (e) return e.committed;
    let t: string | undefined;
    for (const r of this.q.snapsUp!.iterate() as Iterable<{ body: string }>) {
      const snap = JSON.parse(r.body) as Omit<Snapshot, "n">;
      if (snap.last <= seq) t = snap.to;
    }
    return t;
  }

  /**
   * What changed from the map at `from` to the map at `to` (seqs, from ≤
   * to), item by item: each item a set in between touched whose fields
   * differ at the two points, by id. `changes` are the sets that touched
   * it in between (at most 10; a fold counts by its first seq).
   */
  diff(from: number, to: number): { sets: number; items: Difference[] } {
    const before = new Map<string, Record<string, Json> | undefined>();
    const by = new Map<string, string[]>();
    let sets = 0;
    // Reaching `from` first refuses where the log can't say what it was.
    if (from < to) this.walk(from);
    const { items } = this.walk(to, (set, now) => {
      if (set.seq <= from) return;
      sets++;
      for (const id of touched(set.facts)) {
        if (!before.has(id)) before.set(id, now.has(id) ? { ...now.get(id)! } : undefined);
        const list = by.get(id) ?? [];
        if (list.length < 10) list.push(set.id ?? `c${set.seq}`);
        by.set(id, list);
      }
    });
    const out: Difference[] = [];
    for (const id of [...before.keys()].sort()) {
      const d = difference(id, before.get(id), items.get(id));
      if (d) out.push({ ...d, changes: by.get(id) ?? [] });
    }
    return { sets, items: out };
  }

  size(): number {
    return (this.q.count!.get() as { n: number }).n;
  }

  /**
   * Once more than `keep + fold` entries are kept, folds the oldest `fold`
   * into one snapshot and drops them. Returns the snapshot, if it made one.
   */
  compact(keep: number, fold: number): Snapshot | undefined {
    if (this.size() <= keep + fold) return undefined;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = (this.q.oldest!.all(fold) as Row[]).map(entryOf);
      const uniq = (xs: string[]) => [...new Set(xs)].sort();
      const body: Omit<Snapshot, "n"> = {
        first: old[0]!.seq,
        last: old.at(-1)!.seq,
        from: old[0]!.committed,
        to: old.at(-1)!.committed,
        count: old.length,
        actors: uniq(old.map((e) => e.header.actor.id)),
        plugins: uniq(old.map((e) => e.header.plugin.id)),
        actions: uniq(old.map((e) => e.header.action)),
        facts: netFacts(old.map((e) => e.facts)),
      };
      const { lastInsertRowid } = this.q.snap!.run(body.first, body.last, JSON.stringify(body));
      this.q.drop!.run(body.last);
      this.q.untouch!.run(body.last);
      this.db.exec("COMMIT");
      return { n: Number(lastInsertRowid), ...body };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
