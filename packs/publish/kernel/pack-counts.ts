// What a server pack counts on a site's workspace, per key per day (the acts count.add and count.read,
// src/server-acts.ts): only how many, never of whom. A count is held in memory and written down each minute as one
// entry of the pack's stream on that workspace, adding to the day, and read back as what was added after a position.

import type { Archipelago } from '../../../src/pelago.ts';
import { opEntries, type CountStream, type OpFact } from '../../../src/streams.ts';

/** A key a count may be kept under: a short word of letters, digits, _ and -. */
export const COUNT_KEY = /^[A-Za-z0-9_-]{1,40}$/;
/** The most rows a stream entry holds, and a read answers. */
export const COUNT_ROWS = 1000;
/** Each count's fact names its key so: a key is never taken for an item's id. Any word before the colon is read alike. */
const ID = 'key:';
const keyOf = (id: string) => /^[a-z]+:(.*)$/.exec(id)?.[1];

/** Today as a count's day: the date in UTC. */
export const dayOf = (at = new Date()) => at.toISOString().slice(0, 10);

/** The counts not yet written down: "workspace stream" → "key day" → how many. */
const pending = new Map<string, Map<string, number>>();
const place = (workspace: string, stream: string) => `${workspace} ${stream}`;
const rowOf = (key: string, n: number) => ({ key: key.split(' ')[0], day: key.split(' ')[1], n });

/** Add to a key's count for a day on a workspace's stream, in memory until it is written down. */
export function addCount(workspace: string, stream: string, key: string, day = dayOf(), n = 1) {
  const at = place(workspace, stream);
  const counts = pending.get(at) ?? pending.set(at, new Map()).get(at)!;
  counts.set(`${key} ${day}`, (counts.get(`${key} ${day}`) ?? 0) + n);
}

/** The counts held in memory for a workspace's stream, as rows, without taking them. */
export const heldCounts = (workspace: string, stream: string) => [...(pending.get(place(workspace, stream)) ?? [])].map(([key, n]) => rowOf(key, n));

type Opened = { pelago: Pick<Archipelago, 'record' | 'db'> };

/** Write down what has been counted since the last time: one entry of each stream that counted, adding to the day. */
export async function flushCounts(open: (workspace: string) => Promise<Opened>) {
  for (const [at, counts] of [...pending]) {
    pending.delete(at);
    const [workspace, stream] = at.split(' ') as [string, CountStream];
    const facts = [...counts].map(([key, n]): OpFact => { const r = rowOf(key, n); return ['+', ID + r.key, r.day, r.n]; });
    try {
      const { pelago } = await open(workspace);
      for (let i = 0; i < facts.length; i += COUNT_ROWS) await pelago.record(stream, 'system', facts.slice(i, i + COUNT_ROWS));
    } catch (err) {
      // Kept for the next minute rather than lost.
      for (const [key, n] of counts) { const r = rowOf(key, n); addCount(workspace, stream, r.key, r.day, r.n); }
      console.error(`writing down the counts of ${workspace} (${stream}) failed:`, err);
    }
  }
}

/** Flush the counts each minute, until what this returns is called, which flushes what is left. */
export function keepCounts(open: (workspace: string) => Promise<Opened>, everyMs = 60_000): () => Promise<void> {
  const timer = setInterval(() => void flushCounts(open), everyMs);
  timer.unref();
  return () => (clearInterval(timer), flushCounts(open));
}

/**
 * The counts written down after a position of a stream, summed per key per day: each n is what was added to that day
 * since `after`. At most COUNT_ROWS rows, whole entries only; `pos` is the last entry read, to ask from next.
 */
export async function countsSince(pelago: Pick<Archipelago, 'db'>, stream: string, after = 0): Promise<{ counts: { key: string; day: string; n: number }[]; pos: number }> {
  const entries = await opEntries(pelago.db, stream as CountStream, { from: after + 1, limit: COUNT_ROWS });
  const sum = new Map<string, number>();
  let pos = after;
  for (const e of entries) {
    const added = e.facts.flatMap((f) => { const key = f[0] === '+' ? keyOf(f[1]) : undefined; return key ? [[`${key} ${f[2]}`, Number(f[3])] as const] : []; });
    if (new Set([...sum.keys(), ...added.map(([key]) => key)]).size > COUNT_ROWS) break;
    for (const [key, n] of added) sum.set(key, (sum.get(key) ?? 0) + n);
    pos = e.pos;
  }
  return { counts: [...sum].map(([key, n]) => rowOf(key, n)), pos };
}
