// What the log root fills of a workspace's open (packs/identity/kernel/lifecycle.ts, read in the order packs/roots.json starts the roots):
// in the restore phase, what a backup brings; in the types phase, once the map's packs are read, the packs' tables made
// again if a restore asked it (packs/log/kernel/log-project.ts). While this server leads, the log is kept once a day.

import type { RootLeading, RootOpen } from '../../identity/kernel/lifecycle.ts';
import type { Workspace } from '../../identity/kernel/workspaces.ts';
import { restore } from './backup.ts';
import { projectAgainIfAsked } from './log-project.ts';
import { makePartitions } from './partitions.ts';
import { rebuildProjections, snapshotNow } from './rebuild.ts';
import { newestHead, snapshots } from './snapshot.ts';
import { headOf } from './log.ts';
import { compact, seal } from './streams.ts';

export const OPEN: RootOpen = {
  restore: [async (o) => { if (o.backup) await restore(o.db, o.backup, o.id); }],
  types: [async (o) => { if (o.registry && (await projectAgainIfAsked(o.db, o.registry))) console.log(`${o.id}: the packs' tables made again from what was restored`); }],
};

/** Make the log's partitions ahead, seal its compacted streams up to today and compact what their rules no longer keep (docs/log.md, section 4). */
export async function keepStreams(ws: Workspace, now = new Date()): Promise<void> {
  const { pelago } = ws;
  await makePartitions(pelago.db); // the log's partitions, two months ahead (packs/log/kernel/partitions.ts)
  const sealed = await seal(pelago.db, pelago.workspace, now);
  const { dropped } = await compact(pelago.db, pelago.workspace, pelago.registry.rules, now);
  if (sealed.length || dropped) console.log(`${ws.id}: ${sealed.length} days sealed, ${dropped} entries compacted away`);
}

/**
 * The projections kept as a snapshot at the head of the log, made from the newest one before it (docs/log.md, section
 * 7). Where no snapshot fits the projector this code runs (a new projector, or a map that has none), the projections
 * are made again from the log's start, beside the live ones, and swapped in.
 */
export async function keepSnapshots(ws: Workspace): Promise<void> {
  const { pelago } = ws;
  const [last, facts, pending] = await Promise.all([newestHead(pelago.db), headOf(pelago.db, 'facts'), headOf(pelago.db, 'pending')]);
  if (last && last.positions.facts === facts.pos && last.positions.pending === pending.pos) return void console.log(`${ws.id}: snapshot kept already at ${facts.pos}`);
  const fits = (await snapshots(pelago.db, pelago.workspace)).some((s) => !s.problems.length);
  const done = await (fits ? snapshotNow : rebuildProjections)(pelago.db, pelago.registry, pelago.workspace, { pace: 1 });
  console.log(`${ws.id}: ${fits ? 'snapshot taken' : 'projections rebuilt from the log'} at ${done.to.facts} (${done.entries} entries, ${done.ms} ms)${done.swapped ? `, rows put right: ${JSON.stringify(done.swapped)}` : ''}`);
}

/**
 * Whether the day's keeping is done in a workspace, asked of the database rather than this process: a snapshot this
 * code made today (the streams are kept just before it). A server restarted on the same code (every deploy) finds one
 * and keeps nothing; on new projector code none fits, and the walk runs once.
 */
export async function keptToday(ws: Workspace, now = new Date()): Promise<boolean> {
  const last = await newestHead(ws.pelago.db);
  return !!last && last.taken_at.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
}

/** The day each workspace's log was last kept on, in this process. */
const keptOn = new Map<string, string>();
const HOURLY = 60 * 60_000;
/** How long after a server starts to lead it first asks: the switch-over and the first pages come before any keeping. */
const AFTER = Number(process.env.PELAGO_KEEP_AFTER_MS ?? 5 * 60_000);

/** One workspace kept at a time, in the order they came due: never every map's walk on the database at once. */
let line: Promise<unknown> = Promise.resolve();
function inLine(f: () => Promise<void>): Promise<void> {
  const turn = line.then(f, f);
  line = turn.catch(() => {});
  return turn;
}

/**
 * Once a day, the first time the clock is asked after midnight (UTC): the streams kept, then a snapshot taken, unless
 * the database says it was done today already. One the workspace closed under (it stopped leading, or closed) is let
 * go unsaid, and is kept again at its next open.
 */
async function keepIfDue(ws: Workspace, stopped: () => boolean): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (keptOn.get(ws.id) === today) return;
  keptOn.set(ws.id, today);
  const failed = (what: string) => (err: unknown) => {
    if (stopped()) keptOn.delete(ws.id);
    else console.error(`keeping the ${what} of ${ws.id} failed:`, err);
  };
  await inLine(async () => {
    if (stopped()) return void keptOn.delete(ws.id);
    if (await keptToday(ws).catch(() => false)) return void console.log(`${ws.id}: kept already today`);
    await keepStreams(ws).catch(failed('streams'));
    if (stopped()) return void keptOn.delete(ws.id);
    await keepSnapshots(ws).catch(failed('snapshots'));
  });
}

export const LEADING: RootLeading = [
  (ws) => {
    let stopped = false;
    const keep = () => void keepIfDue(ws, () => stopped);
    const first = setTimeout(keep, AFTER).unref();
    const t = setInterval(keep, HOURLY).unref();
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(t);
    };
  },
];
