/**
 * The journal's store: every committed change set in full, with its
 * inverse, in one SQLite database (Node's built-in `node:sqlite`).
 *
 * - `entries` holds the newest sets whole: header, facts, inverse, and
 *   which later set undid it, if one has.
 * - `snapshots` holds what older entries were folded into: the range they
 *   covered, who made them, and their net facts (each field touched, from
 *   the value it had before the range to the value it had after). The
 *   graph is the truth, so this is a record, not something to rebuild from.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ChangeSetId, Committed, Fact, Header } from "../../spec/changeset.ts";
import { inverse } from "../../spec/changeset.ts";
import type { Json, Page, PageRequest } from "../../spec/common.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";

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
  packs: string[];
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
CREATE TABLE IF NOT EXISTS snapshots (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  first INTEGER NOT NULL,
  last INTEGER NOT NULL,
  body TEXT NOT NULL
);
`;

const LAYOUT = "1";

type Row = { seq: number; id: string; committed: string; header: string; facts: string; inverse: string; undone_by: string | null };

function entryOf(r: Row): Entry {
  const e: Entry = {
    id: r.id,
    seq: r.seq,
    committed: r.committed,
    header: JSON.parse(r.header) as Header,
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
    else if (layout.value !== LAYOUT) throw new Error(`history journal ${file} has layout ${layout.value}; this pack reads ${LAYOUT}`);
    const p = (sql: string) => this.db.prepare(sql);
    this.q = {
      add: p("INSERT OR IGNORE INTO entries (seq, id, run, committed, header, facts, inverse) VALUES (?, ?, ?, ?, ?, ?, ?)"),
      one: p("SELECT * FROM entries WHERE id = ?"),
      undone: p("UPDATE entries SET undone_by = ? WHERE id = ?"),
      newest: p("SELECT * FROM entries WHERE seq < ? ORDER BY seq DESC LIMIT ?"),
      newestRun: p("SELECT * FROM entries WHERE run = ? AND seq < ? ORDER BY seq DESC LIMIT ?"),
      count: p("SELECT count(*) AS n FROM entries"),
      oldest: p("SELECT * FROM entries ORDER BY seq LIMIT ?"),
      drop: p("DELETE FROM entries WHERE seq <= ?"),
      snap: p("INSERT INTO snapshots (first, last, body) VALUES (?, ?, ?)"),
      snaps: p("SELECT n, body FROM snapshots WHERE n < ? ORDER BY n DESC LIMIT ?"),
      covering: p("SELECT n FROM snapshots WHERE first <= ? AND last >= ? LIMIT 1"),
    };
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

  /** Entries newest first, a page at a time; `run` narrows to one run's. */
  entries(opts: { run?: string } = {}, page?: PageRequest): Page<Entry> {
    const limit = Math.max(1, Math.min(page?.limit ?? 50, LIMIT_MAX));
    const before = page?.after ? Number(page.after) : Number.MAX_SAFE_INTEGER;
    const rows = (opts.run ? this.q.newestRun!.all(opts.run, before, limit + 1) : this.q.newest!.all(before, limit + 1)) as Row[];
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
        packs: uniq(old.map((e) => e.header.pack.id)),
        actions: uniq(old.map((e) => e.header.action)),
        facts: netFacts(old.map((e) => e.facts)),
      };
      const { lastInsertRowid } = this.q.snap!.run(body.first, body.last, JSON.stringify(body));
      this.q.drop!.run(body.last);
      this.db.exec("COMMIT");
      return { n: Number(lastInsertRowid), ...body };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
