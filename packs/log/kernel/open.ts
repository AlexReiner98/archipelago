// What the log root fills of a workspace's open (packs/identity/kernel/lifecycle.ts, read in the order packs/roots.json starts the roots):
// in the restore phase, what a backup brings; in the types phase, once the map's packs are read, the packs' tables made
// again if a restore asked it (packs/log/kernel/log-project.ts). While this server leads, the log is kept once a day.

import type { RootLeading, RootOpen } from '../../identity/kernel/lifecycle.ts';
import type { Workspace } from '../../identity/kernel/workspaces.ts';
import { restore } from './backup.ts';
import { projectAgainIfAsked } from './log-project.ts';
import { makePartitions } from './partitions.ts';
import { rebuildProjections, snapshotNow } from './rebuild.ts';
import { snapshots } from './snapshot.ts';
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
  const fits = (await snapshots(pelago.db, pelago.workspace)).some((s) => !s.problems.length);
  const done = await (fits ? snapshotNow : rebuildProjections)(pelago.db, pelago.registry, pelago.workspace);
  console.log(`${ws.id}: ${fits ? 'snapshot taken' : 'projections rebuilt from the log'} at ${done.to.facts} (${done.entries} entries, ${done.ms} ms)${done.swapped ? `, rows put right: ${JSON.stringify(done.swapped)}` : ''}`);
}

/** The day each workspace's log was last kept on, in this process: a restart keeps it again, which changes nothing. */
const keptOn = new Map<string, string>();
const HOURLY = 60 * 60_000;

/**
 * Once a day, the first time the clock is asked after midnight (UTC): the streams kept, then a snapshot taken. One the
 * workspace closed under (it stopped leading, or closed) is let go unsaid, and is kept again at its next open.
 */
async function keepIfDue(ws: Workspace, stopped: () => boolean): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (keptOn.get(ws.id) === today) return;
  keptOn.set(ws.id, today);
  const failed = (what: string) => (err: unknown) => {
    if (stopped()) keptOn.delete(ws.id);
    else console.error(`keeping the ${what} of ${ws.id} failed:`, err);
  };
  await keepStreams(ws).catch(failed('streams'));
  if (stopped()) return void keptOn.delete(ws.id);
  await keepSnapshots(ws).catch(failed('snapshots'));
}

export const LEADING: RootLeading = [
  (ws) => {
    let stopped = false;
    const keep = () => void keepIfDue(ws, () => stopped);
    keep();
    const t = setInterval(keep, HOURLY).unref();
    return () => {
      stopped = true;
      clearInterval(t);
    };
  },
];
