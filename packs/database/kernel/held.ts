// One transaction per request. A person's reads in one request (src/timing.ts keeps the request) share a transaction
// on one connection, entered once (the viewer, the role, read only), instead of each read beginning, entering and
// committing its own. What may share one, and how long it is held:
//
// - Only a plain read shares (`shares`): one statement that selects and names nothing that writes, locks or sets. A
//   write, and anything unsure, runs in its own transaction as before, so a later read's failure can never roll it
//   back, and a statement can never change the viewer or role of the reads after it.
// - Who shares: one request, one database, one scope (viewer, admin, read only, or anyone). Another request, viewer
//   or scope never reaches it; a transaction's settings are `local`, gone at its commit, so a connection given back
//   carries nothing to the next.
// - It is held while its reads come and go, and given back the moment the request is idle (IDLE_MS with nothing
//   out), when the request asks the database for anything else (`yieldHeld`: PGlite has one connection, and a pool
//   can run dry, so a held transaction never waits on its own request), or once held MOST_MS. A request that waits
//   (a long poll, a pack's code) therefore holds no connection.
// - A read that fails aborts the transaction: it is rolled back, the reads that were in it with that read and failed
//   only for that (25P02) run again in a new one, and the failing read's own error is the request's.

import type { Db, Q } from './db.ts';
import { timing, type Timing } from '../../../src/timing.ts';

/** How long a request's transaction is kept with nothing out, for the next read of the same burst. */
const IDLE_MS = 2;
/** The longest one transaction is held: past it, the next idle moment gives it back, so a long request never starves another of PGlite's one connection. */
const MOST_MS = 250;

interface Held {
  ready: Promise<Q>;
  out: number;
  born: number;
  /** No more reads join it: it is being given back. */
  closing: boolean;
  /** A read failed in it: it rolls back once nothing is out. */
  broken: boolean;
  end: (ok: boolean) => void;
  idle?: ReturnType<typeof setTimeout>;
}

/** Per request: per database, per scope, the transaction its reads share now. */
const requests = new WeakMap<Timing, Map<Db, Map<string, Held>>>();
/** Set while a held transaction is being asked for, so its own begin is not taken for the request asking for something else. */
let opening = false;

const WRITES = /\b(insert|update|delete|merge|upsert|copy|lock|share|notify|listen|refresh|vacuum|analyze)\b|nextval|setval|set_config|advisory|pelago_(vault_destroy|forget_stores|bytes_add|bytes_fold|mentioned)/i;

/** Whether a statement is a plain read, which may share the request's transaction. Anything unsure is not. */
export const shares = (sql: string) => /^\s*(select|with)\b/i.test(sql) && !WRITES.test(sql) && !/;\s*\S/.test(sql);

/** The request's own transaction for this database and scope, if the code runs in a request; else undefined. */
export function heldQuery<T>(db: Db, scope: string, enter: (tx: Q) => Promise<unknown>, sql: string, params?: unknown[]): Promise<{ rows: T[] }> | undefined {
  const t = timing();
  if (!t || !shares(sql)) return undefined;
  return run<T>(t, db, scope, enter, sql, params);
}

async function run<T>(t: Timing, db: Db, scope: string, enter: (tx: Q) => Promise<unknown>, sql: string, params: unknown[] | undefined, again = false): Promise<{ rows: T[] }> {
  const h = current(t, db, scope, enter);
  h.out++;
  if (h.idle) clearTimeout(h.idle), (h.idle = undefined);
  try {
    const tx = await h.ready;
    return await tx.query<T>(sql, params);
  } catch (err) {
    h.broken = true;
    // Failed only because another read had failed in the same transaction: it never ran, so it runs in a new one.
    if (again || (err as { code?: string }).code !== '25P02') throw err;
  } finally {
    h.out--;
    settle(t, db, scope, h);
  }
  return run<T>(t, db, scope, enter, sql, params, true);
}

function current(t: Timing, db: Db, scope: string, enter: (tx: Q) => Promise<unknown>): Held {
  let dbs = requests.get(t);
  if (!dbs) requests.set(t, (dbs = new Map()));
  let scopes = dbs.get(db);
  if (!scopes) dbs.set(db, (scopes = new Map()));
  const now = scopes.get(scope);
  if (now && !now.closing && !now.broken) return now;
  const h = open(db, enter);
  scopes.set(scope, h);
  return h;
}

/** Begin a transaction, enter it, and keep it until `end`: committed when every read in it went well, else rolled back. */
function open(db: Db, enter: (tx: Q) => Promise<unknown>): Held {
  let ready!: (tx: Q) => void, failed!: (err: unknown) => void, end!: (ok: boolean) => void;
  const h: Held = { ready: new Promise<Q>((y, n) => ((ready = y), (failed = n))), out: 0, born: performance.now(), closing: false, broken: false, end: (ok) => end(ok) };
  const ended = new Promise<boolean>((y) => (end = y));
  const ROLLBACK = new Error('rolled back: a read in it failed');
  opening = true;
  let done: Promise<unknown>;
  try {
    done = db.transaction(async (tx) => {
      await enter(tx);
      ready(tx);
      if (!(await ended)) throw ROLLBACK;
    });
  } finally {
    opening = false;
  }
  done.catch((err) => {
    failed(err); // a begin or an entry that failed is each waiting read's error; after ready, a no-op
    if (err !== ROLLBACK && !h.broken) console.error(`a request's transaction did not commit: ${(err as Error).message}`);
  });
  h.ready.catch(() => {}); // read by the reads; one that nobody reads again is not unhandled
  return h;
}

/** A read came back: give the transaction back if nothing is out and it is broken, being given back, old, or idle a moment. */
function settle(t: Timing, db: Db, scope: string, h: Held) {
  if (h.out > 0) return;
  const back = performance.now();
  if (h.broken || h.closing || back - h.born > MOST_MS) return finish(t, db, scope, h);
  // The loop's clock is read once a turn, so after a long turn (PGlite runs in it) a timer can be due at once: it
  // counts the idle time itself, and waits out the rest.
  const wait = (ms: number) => (h.idle = setTimeout(() => {
    const idle = performance.now() - back;
    if (h.out === 0) (idle >= IDLE_MS ? finish(t, db, scope, h) : wait(IDLE_MS - idle));
  }, ms));
  wait(IDLE_MS);
}

function finish(t: Timing, db: Db, scope: string, h: Held) {
  if (h.idle) clearTimeout(h.idle), (h.idle = undefined);
  const scopes = requests.get(t)?.get(db);
  if (scopes?.get(scope) === h) scopes.delete(scope);
  h.closing = true;
  if (h.out === 0) h.end(!h.broken);
}

/**
 * The request asks the database for something outside its held transactions (another transaction, a write, the whole
 * map): each is given back, at once or as soon as its reads are back, and later reads begin another. On PGlite the
 * ask would otherwise wait for the request's own transaction, which waits for the request: never.
 */
export function yieldHeld() {
  if (opening) return;
  const t = timing();
  const dbs = t && requests.get(t);
  if (!dbs) return;
  for (const [db, scopes] of dbs) for (const [scope, h] of [...scopes]) finish(t, db, scope, h);
}
