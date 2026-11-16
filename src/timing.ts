// Where one request's time goes: its statements, its waits for a connection, its calls into pack code, and the
// whole. Kept per request in an AsyncLocalStorage the server opens around /api and /agent (packs/surface/kernel/server.ts),
// filled by the database's wrapper (packs/database/kernel/db.ts, `timedDb`) and the pack call paths
// (packs/loader/kernel/packhost.ts, kernel-context.ts), and sent back as a Server-Timing header, so the browser's
// network panel and `curl -v` show it live. Outside a request nothing is kept: each wrapper costs one lookup.
//
// Statements asked side by side queue for the database (PGlite's lock, the pool's connections), so their times summed
// can exceed the whole. `db` is therefore the wall time in which the request had anything out at the database, and
// `app` the rest of the whole: the two add up to it. The sum is kept besides, in db's description.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';

/** One request's times, in ms. */
export interface Timing {
  start: number;
  statements: number;
  /** Each statement's time from asked to answered, summed. */
  summed: number;
  /** The wall time with something out at the database: statements, a wait for a transaction, its commit. */
  db: number;
  out: number;
  outSince: number;
  waits: number;
  wait: number;
  packCalls: number;
  pack: number;
  /** Pack calls open now: a call inside another is counted, its time is not counted twice. */
  packDepth: number;
  /** Answers that may be kept until the map moves (packs/loader/kernel/kept.ts): asked, and of those, given as kept. */
  keepable: number;
  kept: number;
  /** Reading where the map stands, for reads kept by it (packs/log/kernel/position.ts), and how many were answered unchanged; undefined when not read. */
  stand?: number;
  unchanged: number;
}

const store = new AsyncLocalStorage<Timing>();

/** The times of the request this code runs for, if any. */
export const timing = (): Timing | undefined => store.getStore();

/** Run `fn` as one request, timed. */
export function timed<T>(fn: () => T): T {
  return store.run({ start: performance.now(), statements: 0, summed: 0, db: 0, out: 0, outSince: 0, waits: 0, wait: 0, packCalls: 0, pack: 0, packDepth: 0, keepable: 0, kept: 0, unchanged: 0 }, fn);
}

/** Something is out at the database from now. */
export function sent(t: Timing): number {
  const now = performance.now();
  if (t.out++ === 0) t.outSince = now;
  return now;
}

/** It came back. */
export function back(t: Timing): number {
  const now = performance.now();
  if (--t.out === 0) t.db += now - t.outSince;
  return now;
}

/** Time one statement of the request, if it is in one. */
export async function statement<T>(run: () => Promise<T>): Promise<T> {
  const t = store.getStore();
  if (!t) return run();
  const from = sent(t);
  try {
    return await run();
  } finally {
    t.statements++;
    t.summed += back(t) - from;
  }
}

/** Time one call into a pack's code, if in a request: a call inside another adds to the count, not to the time. */
export async function packCall<T>(run: () => Promise<T>): Promise<T> {
  const t = store.getStore();
  if (!t) return run();
  t.packCalls++;
  if (t.packDepth++ > 0) {
    try {
      return await run();
    } finally {
      t.packDepth--;
    }
  }
  const from = performance.now();
  try {
    return await run();
  } finally {
    t.packDepth--;
    t.pack += performance.now() - from;
  }
}

/** Count an answer that may be kept, if in a request: whether it was given as kept. */
export function keptCall(kept: boolean): void {
  const t = store.getStore();
  if (!t) return;
  t.keepable++;
  if (kept) t.kept++;
}

/** Time reading where the map stands, if in a request. */
export async function stood<T>(run: () => Promise<T>): Promise<T> {
  const t = store.getStore(), from = performance.now();
  try {
    return await run();
  } finally {
    if (t) t.stand = (t.stand ?? 0) + performance.now() - from;
  }
}

/** A kept read answered unchanged, without being read. */
export function unchanged(): void {
  const t = store.getStore();
  if (t) t.unchanged++;
}

/** Answer a request timed: its head carries Server-Timing as it is written, however it is written. */
export function timedAnswer<T>(res: ServerResponse, fn: () => T): T {
  return timed(() => {
    const t = timing()!;
    const head = res.writeHead;
    res.writeHead = function (this: ServerResponse, ...args: Parameters<ServerResponse['writeHead']>) {
      if (!this.headersSent) this.setHeader('server-timing', serverTiming(t));
      return head.apply(this, args);
    } as ServerResponse['writeHead'];
    return fn();
  });
}

const ms = (n: number) => n.toFixed(1);

/**
 * The Server-Timing header of a request so far: db (the wall time with anything out at the database; its statements
 * and their times summed), wait (for a connection or the database's lock, with the begin; summed, so transactions
 * asked side by side can add up past the whole: within db's wall time, it is the queue), pack (calls
 * into pack code, which hold some of the db time), stand (reading where the map stands, within db, and how many kept reads it answered unchanged), app (the whole less db: what Node did) and total.
 */
export function serverTiming(t: Timing): string {
  const now = performance.now(), total = now - t.start, db = t.db + (t.out > 0 ? now - t.outSince : 0);
  return [
    `db;dur=${ms(db)};desc="${t.statements} statements, ${Math.round(t.summed)} ms summed"`,
    `wait;dur=${ms(t.wait)};desc="${t.waits} transactions"`,
    `pack;dur=${ms(t.pack)};desc="${t.packCalls} calls"`,
    ...(t.keepable ? [`kept;desc="${t.kept} of ${t.keepable} answers kept"`] : []),
    `app;dur=${ms(Math.max(0, total - db))}`,
    ...(t.stand !== undefined ? [`stand;dur=${ms(t.stand)};desc="${t.unchanged} answered unchanged"`] : []),
    `total;dur=${ms(total)}`,
  ].join(', ');
}
