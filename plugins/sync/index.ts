/**
 * The sync plugin: one map's side of syncing with another (README). It
 * knows this map's id, how far each other map has had this one's change
 * sets (a cursor per peer), and makes a plan's writes true here as one
 * change set (`sync.apply`). The merge is merge.ts; the run between two
 * maps is run.ts, which `npm run map -- sync` drives.
 *
 * Injects `graph.read` and `action.register`. Node only.
 */
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { factsFor, idsOf, type Fields, type Write } from "./merge.ts";

export interface SyncConfig {
  /** Where this map's id and its peers' cursors are kept; absent, in memory. */
  db?: string;
  /** This map's name, said to its peers. Absent, a peer names it by where it reached it. */
  name?: string;
}

/** A map synced with this one: how far it has had this map's sets, and the last run's report. */
export interface Peer {
  id: string;
  name: string;
  /** This map's cursor up to which its sets have gone to the peer. */
  cursor?: string;
  /** When they last synced. */
  synced?: string;
  /** What the last run did, as run.ts reports it. */
  report?: Json;
}

/** The actor a sync writes as on this map, for the sets that came from `peer`. */
export const actorOf = (peer: string) => ({ id: `agent:sync/${peer}`, kind: "agent" as const });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS peers (id TEXT PRIMARY KEY, name TEXT NOT NULL, cursor TEXT, synced TEXT, report TEXT);
CREATE TABLE IF NOT EXISTS pairs (peer TEXT NOT NULL, mine TEXT NOT NULL, theirs TEXT NOT NULL, PRIMARY KEY (peer, mine));
`;

class Store {
  readonly db: DatabaseSync;
  readonly id: string;
  constructor(file = ":memory:") {
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'id'").get() as { value: string } | undefined;
    this.id = row?.value ?? randomUUID();
    if (!row) this.db.prepare("INSERT INTO meta (key, value) VALUES ('id', ?)").run(this.id);
  }
  peers(): Peer[] {
    return (this.db.prepare("SELECT id, name, cursor, synced, report FROM peers ORDER BY synced DESC").all() as Record<string, string | null>[]).map((r) => ({
      id: r.id!,
      name: r.name!,
      ...(r.cursor ? { cursor: r.cursor } : {}),
      ...(r.synced ? { synced: r.synced } : {}),
      ...(r.report ? { report: JSON.parse(r.report) as Json } : {}),
    }));
  }
  mark(p: Peer): void {
    this.db
      .prepare("INSERT INTO peers (id, name, cursor, synced, report) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, cursor = excluded.cursor, synced = excluded.synced, report = excluded.report")
      .run(p.id, p.name, p.cursor ?? null, p.synced ?? null, p.report === undefined ? null : JSON.stringify(p.report));
  }
  /** Ids paired with a peer's, a page at a time, by this map's id. */
  pairs(peer: string, after: string | undefined, limit: number): { items: [string, string][]; next?: string } {
    const rows = this.db.prepare("SELECT mine, theirs FROM pairs WHERE peer = ? AND mine > ? ORDER BY mine LIMIT ?").all(peer, after ?? "", limit + 1) as { mine: string; theirs: string }[];
    const items = rows.slice(0, limit).map((r) => [r.mine, r.theirs] as [string, string]);
    return rows.length > limit ? { items, next: items.at(-1)![0] } : { items };
  }
  pair(peer: string, pairs: [string, string][]): void {
    const add = this.db.prepare("INSERT INTO pairs (peer, mine, theirs) VALUES (?, ?, ?) ON CONFLICT (peer, mine) DO UPDATE SET theirs = excluded.theirs");
    this.db.exec("BEGIN");
    try {
      for (const [mine, theirs] of pairs) add.run(peer, mine, theirs);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
  close(): void {
    this.db.close();
  }
}

const by = { plugin: "sync" };
const isWrite = (w: unknown): w is Write =>
  !!w && typeof w === "object" && typeof (w as Write).id === "string" && !!(w as Write).id &&
  ((typeof (w as { field?: unknown }).field === "string" && !!(w as { field: string }).field) ||
    (w as { remove?: unknown }).remove === true ||
    (!!(w as { whole?: unknown }).whole && typeof (w as { whole?: unknown }).whole === "object"));

const sync: Plugin<SyncConfig> = {
  id: "sync",
  about: "Syncs this map with another, both ways: what each changed since they last synced, the later change winning field by field.",
  inject: ["graph.read", "action.register"],
  async apply(ctx: Context, config: SyncConfig = {}) {
    if (config.db) {
      const { mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(config.db), { recursive: true });
    }
    const store = new Store(config.db);
    ctx.effect(() => () => store.close());
    const graph = ctx.get<GraphRead>("graph.read");
    const register = ctx.get<ActionRegister>("action.register");
    const name = config.name;

    register.register({
      name: "sync.status",
      title: "This map's sync id and the maps it syncs with",
      doc: "This map's id and name, and each peer: how far it has had this map's change sets, when they last synced, and what that run did. Writes nothing.",
      input: { type: "object", properties: {} },
      async run() {
        return { id: store.id, ...(name ? { name } : {}), peers: store.peers() } as unknown as Json;
      },
    });

    register.register({
      name: "sync.mark",
      title: "Record a sync run with a peer",
      doc: "Keeps how far a peer has had this map's change sets (`cursor`, from graph.read.since), and the run's report. Writes nothing to the map.",
      input: {
        type: "object",
        properties: {
          peer: { type: "string" },
          name: { type: "string" },
          cursor: { type: "string" },
          report: {},
          pairs: { type: "array", description: `[mine, theirs]: an item made on each map with its own id; at most ${LIMIT_MAX} a call` },
          only: { type: "boolean", description: "Keep the pairs only: the cursor and report stay as they are" },
        },
        required: ["peer", "name"],
      },
      async run(input: { peer: string; name: string; cursor?: string; report?: Json; pairs?: Json[]; only?: boolean }) {
        if (!input.peer || input.peer === store.id) throw new Refused({ code: "sync.peer", message: "Name another map's sync id as the peer.", by });
        const pairs = (input.pairs ?? []).filter((p): p is [string, string] => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string");
        if (pairs.length > LIMIT_MAX) throw new Refused({ code: "sync.too_many", message: `At most ${LIMIT_MAX} pairs a call.`, by });
        if (pairs.length) store.pair(input.peer, pairs);
        if (input.only) return { ok: true, pairs: pairs.length };
        store.mark({ id: input.peer, name: input.name, ...(input.cursor ? { cursor: input.cursor } : {}), synced: new Date().toISOString(), ...(input.report !== undefined ? { report: input.report } : {}) });
        return { ok: true, pairs: pairs.length };
      },
    });

    register.register({
      name: "sync.pairs",
      title: "Ids paired with a peer's",
      doc: "Items made on this map and a peer each with its own id, paired as one: [this map's id, the peer's]. A page at a time. Writes nothing.",
      input: { type: "object", properties: { peer: { type: "string" }, after: { type: "string" }, limit: { type: "number" } }, required: ["peer"] },
      async run(input: { peer: string; after?: string; limit?: number }) {
        return store.pairs(input.peer, input.after, Math.max(1, Math.min(input.limit ?? LIMIT_MAX, LIMIT_MAX))) as unknown as Json;
      },
    });

    register.register({
      name: "sync.apply",
      title: "Make another map's change true here",
      doc: "Writes, as one change set, what makes `writes` true on this map: each field set or unset, an item brought back whole, or taken away. A field already so writes nothing. Made by `npm run map -- sync`, as agent:sync/<the other map's id>.",
      input: {
        type: "object",
        properties: { writes: { type: "array", description: "{ id, field, value? } | { id, whole: fields } | { id, remove: true }" } },
        required: ["writes"],
      },
      async run(input: { writes: Json[] }, call: ActionContext) {
        const writes = Array.isArray(input.writes) ? input.writes : [];
        const bad = writes.findIndex((w) => !isWrite(w));
        if (bad >= 0) throw new Refused({ code: "sync.writes", message: `Write ${bad + 1} is not { id, field, value? }, { id, whole }, or { id, remove: true }.`, by });
        const ids = idsOf(writes as Write[]);
        const now = new Map<Id, Fields | null>();
        for (let i = 0; i < ids.length; i += LIMIT_MAX) {
          const batch = ids.slice(i, i + LIMIT_MAX);
          const items = await graph.get(batch);
          batch.forEach((id, k) => {
            const it = items[k];
            now.set(id, it ? { type: it.type, ...it.fields } : null);
          });
        }
        const facts = factsFor(writes as Write[], now);
        if (facts.length) call.write(facts);
        return { facts: facts.length };
      },
    });
  },
};

export default sync;
