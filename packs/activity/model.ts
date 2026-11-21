/**
 * What the activity view shows, off the page: runs from the exchange and
 * change sets from the journal in, groups and lines out. Pure, so the
 * tests reach it without a browser.
 */
import type { RunInfo } from "../../spec/agent.ts";
import type { ChangeSetId, Fact, Header } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";

/** A journal entry as `history.list` answers it (the inverse left out). */
export interface Change {
  id: ChangeSetId;
  seq: number;
  committed: string;
  header: Header;
  facts: Fact[];
  /** The set that undid this one, while that undo stands. */
  undoneBy?: ChangeSetId;
}

/** One run with the change sets it made, or a run of changes made outside any. */
export interface Group {
  /** `run:<id>`, or `actor:<id>@<seq>` for changes made outside a run. */
  key: string;
  run?: RunInfo;
  /** Who made the changes outside a run. */
  actor?: string;
  /** Newest first. */
  changes: Change[];
  /** The latest time in it: the run's start or its newest change. */
  last: string;
  /** The run hasn't ended. */
  open: boolean;
}

/**
 * Runs and changes, newest first. A run's changes go under it, whether or
 * not the run is on the page of runs read. Changes outside a run group by
 * actor while they follow one another.
 */
export function group(runs: readonly RunInfo[], changes: readonly Change[]): Group[] {
  const byRun = new Map<string, Group>();
  const out: Group[] = [];
  for (const r of runs) {
    const g: Group = { key: `run:${r.run}`, run: r, changes: [], last: r.started, open: !r.ended };
    byRun.set(r.run, g);
    out.push(g);
  }
  const sorted = [...changes].sort((a, b) => b.seq - a.seq);
  let loose: Group | undefined;
  for (const c of sorted) {
    const run = c.header.run;
    if (run) {
      loose = undefined;
      let g = byRun.get(run);
      if (!g) {
        g = { key: `run:${run}`, changes: [], last: c.committed, open: false };
        byRun.set(run, g);
        out.push(g);
      }
      g.changes.push(c);
      if (c.committed > g.last) g.last = c.committed;
      continue;
    }
    const actor = c.header.actor.id;
    if (!loose || loose.actor !== actor) {
      loose = { key: `actor:${actor}@${c.seq}`, actor, changes: [], last: c.committed, open: false };
      out.push(loose);
    }
    loose.changes.push(c);
  }
  return out.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}

/** What one change set did to one item. */
export interface Touch {
  id: Id;
  /** `new`: it was made; `gone`: it was removed; `set`: fields changed. */
  kind: "new" | "gone" | "set";
  /** The fields it set, with their new value (`null` when cleared). */
  fields: [string, Json][];
  /** Its title, when the set gave one. */
  title?: string;
  /** Its type, when the set made or removed it. */
  type?: string;
}

/** Each item a change set touched, in the order it first did. */
export function touches(facts: readonly Fact[]): Touch[] {
  const by = new Map<Id, { add: Map<string, Json>; drop: Map<string, Json> }>();
  for (const [op, id, field, value] of facts) {
    let t = by.get(id);
    if (!t) by.set(id, (t = { add: new Map(), drop: new Map() }));
    if (op === "+") t.add.set(field, value);
    else {
      t.drop.set(field, value);
      if (t.add.get(field) === value) t.add.delete(field);
    }
  }
  return [...by].map(([id, { add, drop }]) => {
    const kind = add.has("type") ? "new" : drop.has("type") ? "gone" : "set";
    const fields: [string, Json][] = [];
    if (kind === "set") {
      for (const f of new Set([...drop.keys(), ...add.keys()])) fields.push([f, add.has(f) ? add.get(f)! : null]);
    } else if (kind === "new") {
      for (const [f, v] of add) if (f !== "type") fields.push([f, v]);
    }
    const title = add.get("title") ?? drop.get("title");
    const type = add.get("type") ?? drop.get("type");
    return {
      id,
      kind,
      fields,
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof type === "string" ? { type } : {}),
    };
  });
}

/** One value as a short line. */
export function brief(v: Json, n = 60): string {
  if (v === null) return "∅";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

/**
 * The mark of a change set: `↶` it undoes another, `⊖` it was undone,
 * `●` it stands. Undoing an undo redoes, so its button says redo.
 */
export function standing(c: Change): { mark: string; state: "undo" | "undone" | "stands"; button: "undo" | "redo" | undefined } {
  if (c.undoneBy) return { mark: "⊖", state: "undone", button: undefined };
  if (c.header.undoes) return { mark: "↶", state: "undo", button: "redo" };
  return { mark: "●", state: "stands", button: "undo" };
}

/** A run counts as live this long after it began or was last heard from. */
export const LIVE_MS = 15 * 60 * 1000;

/**
 * `live`: not ended, and begun or heard from (an event seen) within
 * LIVE_MS. `open`: not ended, but quiet that long, as a session left open
 * or one that stopped without saying so. `ended`: it said so.
 */
export function liveness(r: RunInfo, heard: number | undefined, now: number): "live" | "open" | "ended" {
  if (r.ended) return "ended";
  const last = Math.max(Date.parse(r.started) || 0, heard ?? 0);
  return now - last <= LIVE_MS ? "live" : "open";
}

/** What the status region shows: the live and open runs, newest first, and the newest change. */
export function status(
  runs: readonly RunInfo[],
  changes: readonly Change[],
  heard: ReadonlyMap<string, number> = new Map(),
  now = Date.now(),
): { live: RunInfo[]; open: RunInfo[]; last?: Change } {
  const live = runs.filter((r) => liveness(r, heard.get(r.run), now) === "live");
  const open = runs.filter((r) => liveness(r, heard.get(r.run), now) === "open");
  let last: Change | undefined;
  for (const c of changes) if (!last || c.seq > last.seq) last = c;
  return { live, open, ...(last ? { last } : {}) };
}

/** Its items, its facts and its words: what a change set is called in one line. */
export function line(c: Change): string {
  const t = touches(c.facts);
  const what = t.length === 1 ? (t[0]!.title ?? t[0]!.id) : `${t.length} items`;
  return `${c.header.action} · ${what}`;
}
