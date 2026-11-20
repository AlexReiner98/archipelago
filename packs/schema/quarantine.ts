/**
 * Quarantine: change sets that didn't fit, kept whole with what was wrong,
 * in SQLite (Node's built-in `node:sqlite`). A held set stays until it is
 * released (sent again, and applied) or dropped by someone's choice; either
 * way the record stays.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ChangeSetId, Proposed } from "../../spec/changeset.ts";
import type { Page, PageRequest } from "../../spec/common.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Problem } from "./check.ts";

export type State = "held" | "released" | "dropped";

export interface Held {
  id: string;
  at: string;
  state: State;
  change: Proposed;
  problems: Problem[];
  /** When released: the change set it was applied as. When dropped: why. */
  released?: ChangeSetId;
  dropped?: { reason: string; by: string };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quarantine (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quarantine_state ON quarantine (state, n);
`;

const LAYOUT = "1";

export class Quarantine {
  readonly db: DatabaseSync;
  private readonly q: Record<string, StatementSync>;

  constructor(file: string = ":memory:") {
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    const layout = this.db.prepare("SELECT value FROM meta WHERE key = 'layout'").get() as { value: string } | undefined;
    if (!layout) this.db.prepare("INSERT INTO meta (key, value) VALUES ('layout', ?)").run(LAYOUT);
    else if (layout.value !== LAYOUT) throw new Error(`schema quarantine ${file} has layout ${layout.value}; this pack reads ${LAYOUT}`);
    const p = (sql: string) => this.db.prepare(sql);
    this.q = {
      add: p("INSERT INTO quarantine (state, body) VALUES ('held', ?)"),
      one: p("SELECT n, body FROM quarantine WHERE n = ?"),
      set: p("UPDATE quarantine SET state = ?, body = ? WHERE n = ?"),
      list: p("SELECT n, body FROM quarantine WHERE (? IS NULL OR state = ?) AND n < ? ORDER BY n DESC LIMIT ?"),
    };
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  hold(change: Proposed, problems: Problem[]): Held {
    const at = new Date().toISOString();
    const { lastInsertRowid } = this.q.add!.run(JSON.stringify({ at, state: "held", change, problems }));
    return { id: `q${lastInsertRowid}`, at, state: "held", change, problems };
  }

  get(id: string): Held | undefined {
    const n = Number(/^q(\d+)$/.exec(id)?.[1]);
    if (!Number.isFinite(n)) return undefined;
    const r = this.q.one!.get(n) as { n: number; body: string } | undefined;
    return r ? { id, ...(JSON.parse(r.body) as Omit<Held, "id">) } : undefined;
  }

  private put(h: Held): void {
    const { id, ...body } = h;
    this.q.set!.run(h.state, JSON.stringify(body), Number(id.slice(1)));
  }

  released(id: string, change: ChangeSetId): void {
    const h = this.get(id);
    if (h) this.put({ ...h, state: "released", released: change });
  }

  dropped(id: string, reason: string, by: string): void {
    const h = this.get(id);
    if (h) this.put({ ...h, state: "dropped", dropped: { reason, by } });
  }

  list(state: State | undefined, page?: PageRequest): Page<Held> {
    const limit = Math.max(1, Math.min(page?.limit ?? 50, LIMIT_MAX));
    const before = page?.after ? Number(page.after) : Number.MAX_SAFE_INTEGER;
    const rows = this.q.list!.all(state ?? null, state ?? null, before, limit + 1) as { n: number; body: string }[];
    const items = rows.slice(0, limit).map((r) => ({ id: `q${r.n}`, ...(JSON.parse(r.body) as Omit<Held, "id">) }));
    return rows.length > limit ? { items, next: String(rows[limit - 1]!.n) } : { items };
  }
}
