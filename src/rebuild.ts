// Rebuilding the projections from the log in the background (docs/log.md, section 7). The projector writes into a
// schema of its own beside the live tables (`pelago_rebuild`, named first on the search path), starting from the
// newest snapshot this code can build on, a chunk of entries per transaction so pages are served between them. When
// what is left is a last chunk, one transaction takes both streams' locks, projects the rest and swaps the result in
// (src/replay.ts, swapIn). The same walk, without the swap, takes a snapshot; with a stop, it answers a past position.

import { setImmediate } from 'node:timers/promises';
import type { Db, Q } from './db.ts';
import { headOf, stored, type Entry } from './log.ts';
import { beforeTheLog, inOrder, type Kinds, loadRows, projectEntry, projectedRows, PROJECTED, shadowTables, swapIn, SHADOW, type Rows } from './replay.ts';
import { projectsApart, regatherAll } from './closure.ts';
import { mentionedAll } from './mentions.ts';
import { openAll } from './seal.ts';
import { KEPT_FIELDS } from './operational.ts';
import { newestValid, prune, takeSnapshot, type Positions, type Snapshot } from './snapshot.ts';

export interface RebuildOptions {
  /** Entries projected per transaction. */
  chunk?: number;
  /** Take a snapshot every this many fact entries projected (and at the end). Section 7: 100,000. */
  snapshotEvery?: number;
  /** Build from the start, passing over every snapshot. */
  fromStart?: boolean;
  /** Told how far it has come, after each chunk. */
  progress?: (at: Positions, head: Positions) => void;
}

export interface RebuildReport {
  from: Snapshot['id'] | 'start';
  to: Positions;
  entries: number;
  chunks: number;
  snapshots: string[];
  swapped?: Record<string, number>;
  ms: number;
  /** Of which keeping snapshots, and swapping in. */
  snapshot_ms: number;
  swap_ms?: number;
}

const running = new WeakSet<object>();

/**
 * The entries of both streams after a position, in the order they are projected, at most `limit`: as many of each
 * stream are read, so none that comes before the last one given is left out.
 */
async function next(q: Q, at: Positions, limit: number): Promise<Entry[]> {
  const [facts, pending] = await Promise.all([stored(q, 'facts', at.facts + 1, limit), stored(q, 'pending', at.pending + 1, limit)]);
  return openAll(q, [...facts, ...pending].sort(inOrder).slice(0, limit));
}

/** Project entries into the shadow (or temporary tables), in one transaction that names it first. */
async function project(tx: Q, reg: Kinds, entries: Entry[], at: Positions): Promise<void> {
  projectsApart(tx);
  for (const e of entries) {
    await projectEntry(tx, reg, e);
    at[e.stream as keyof Positions] = e.pos;
  }
}

const inShadow = (tx: Q) => tx.query(`select set_config('search_path', '${SHADOW}, public', true)`);
const heads = async (q: Q): Promise<Positions> => ({ facts: (await headOf(q, 'facts')).pos, pending: (await headOf(q, 'pending')).pos });
const behind = (at: Positions, head: Positions) => head.facts - at.facts + head.pending - at.pending;

/**
 * Walk the log into the shadow from the newest valid snapshot (or the start), a chunk at a time, then finish under
 * both streams' locks: swap the result in (`swap`), or only keep a snapshot of it. The database must be unscoped.
 */
export async function catchUp(db: Db, reg: Kinds, ws: string, swap: boolean, o: RebuildOptions = {}): Promise<RebuildReport> {
  if (running.has(db)) throw new Error('A rebuild is already running on this workspace.');
  running.add(db);
  const t0 = performance.now();
  const chunk = o.chunk ?? 2000;
  const every = o.snapshotEvery ?? 100_000;
  try {
    const start = o.fromStart ? undefined : await newestValid(db, ws);
    const at: Positions = start ? { ...start.snapshot.positions } : { facts: 0, pending: 0 };
    await db.transaction(async (tx) => {
      await shadowTables(tx);
      await inShadow(tx);
      await loadRows(tx, start?.rows ?? (await beforeTheLog(tx, KEPT_FIELDS)));
      // A snapshot keeps items, links and the queue: what is inside what and what names what are made from them, when
      // they are to be swapped in. A snapshot alone never reads them.
      if (swap) {
        await regatherAll(tx, reg.relationFamily('part_of'));
        await mentionedAll(tx);
      }
    });
    const report: RebuildReport = { from: start?.snapshot.id ?? 'start', to: at, entries: 0, chunks: 0, snapshots: [], ms: 0, snapshot_ms: 0 };
    let since = at.facts;
    const keep = async (tx: Q) => {
      const t = performance.now();
      report.snapshots.push((await takeSnapshot(tx, ws, { ...at }, await projectedRows(tx))).id);
      report.snapshot_ms += Math.round(performance.now() - t);
      since = at.facts;
    };
    // In the background: each chunk its own transaction, nothing locked, the live tables untouched.
    for (let head = await heads(db); behind(at, head) > chunk; head = await heads(db)) {
      await db.transaction(async (tx) => {
        await inShadow(tx);
        const entries = await next(tx, at, chunk);
        await project(tx, reg, entries, at);
        report.entries += entries.length;
        if (at.facts - since >= every) await keep(tx);
      });
      report.chunks++;
      o.progress?.({ ...at }, head);
      await setImmediate();
    }
    // Caught up but for a last chunk: nothing can be appended to either stream until this commits.
    await db.transaction(async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(hashtext('pelago.log'), hashtext('facts'))`);
      await tx.query(`select pg_advisory_xact_lock(hashtext('pelago.log'), hashtext('pending'))`);
      await inShadow(tx);
      for (let entries = await next(tx, at, chunk); entries.length; entries = await next(tx, at, chunk)) {
        await project(tx, reg, entries, at);
        report.entries += entries.length;
      }
      report.chunks++;
      if (at.facts > since || !report.snapshots.length) await keep(tx);
      await tx.query(`select set_config('search_path', 'public', true)`);
      const t = performance.now();
      if (swap) (report.swapped = await swapIn(tx, KEPT_FIELDS)), (report.swap_ms = Math.round(performance.now() - t));
      await prune(tx);
    });
    report.ms = Math.round(performance.now() - t0);
    return report;
  } finally {
    await db.transaction((tx) => dropShadow(tx)).catch(() => {});
    running.delete(db);
  }
}

async function dropShadow(tx: Q) {
  for (const t of PROJECTED) await tx.query(`drop table if exists ${SHADOW}.${t}`);
}

/** Make every projection again from the log, beside the live ones, and swap it in when caught up. */
export const rebuildProjections = (db: Db, reg: Kinds, ws: string, o?: RebuildOptions) => catchUp(db, reg, ws, true, o);

/** Keep a snapshot of the projections at the head of the log, made from the newest one before it and what followed. */
export const snapshotNow = (db: Db, reg: Kinds, ws: string, o?: RebuildOptions) => catchUp(db, reg, ws, false, o);

/**
 * The projections as they stood at a fact position: the nearest snapshot at or before it, and the entries of both
 * streams up to that moment, projected into tables that live for one transaction and are thrown away. `reader` says
 * who asks: only the items and links their database shows them now are given back, as the log's facts are read.
 */
export async function asOf(db: Db, reg: Kinds, ws: string, pos: number, reader: Q = db): Promise<{ at: Positions; rows: Rows }> {
  const start = await newestValid(db, ws, pos);
  const out = await db.transaction(async (tx) => {
    for (const t of PROJECTED) await tx.query(`create temp table ${t} (like public.${t} including defaults including indexes) on commit drop`);
    await loadRows(tx, start?.rows ?? (await beforeTheLog(tx, KEPT_FIELDS)));
    const at: Positions = start ? { ...start.snapshot.positions } : { facts: 0, pending: 0 };
    // The moment of fact entry `pos`: the held changes made by then are in, those after it are not.
    const until = (await tx.query<{ at: Date }>(`select at from log_entry where stream = 'facts' and pos = $1`, [pos])).rows[0]?.at;
    if (!until && pos > 0) throw new Error(`The fact stream has no entry ${pos}.`);
    const by = (e: Entry) => (e.stream === 'facts' ? e.pos <= pos : !!until && Date.parse(e.at) <= new Date(until).getTime());
    for (let entries = await next(tx, at, 2000); entries.length; entries = await next(tx, at, 2000)) {
      const upto = entries.filter(by);
      await project(tx, reg, upto, at);
      if (upto.length < entries.length) break;
    }
    return { rows: await projectedRows(tx), at };
  });
  // Visibility is the database's: of what stood then, what the reader's database shows them now.
  const { rows } = await reader.query<{ id: string }>(`select id from entity where id = any($1::text[])`, [out.rows.entity.map((r) => r.id)]);
  const seen = new Set(rows.map((r) => r.id));
  const { entity, relation, proposal } = out.rows;
  return {
    at: out.at,
    rows: {
      entity: entity.filter((r) => seen.has(r.id as string)),
      relation: relation.filter((r) => seen.has(r.from_id as string) && seen.has(r.to_id as string)),
      proposal: reader === db ? proposal : [],
    },
  };
}
