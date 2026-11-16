// Answers kept until the map moves (task e_unbw4gtp). A read a pack marks kept (its service's `kept` in kernel.provides)
// answers from the map alone: asked again with the same input by the same reader, and nothing written since that it
// may depend on, it answers the same. So its answer is kept under where the map stood before it was read
// (packs/log/kernel/clock.ts) and given again while the map stands there: a canvas whose filter changed one term
// asks the frontier, the views and the style again, and only the term that changed is read.
//
// Kept per database and per reader, never across: the key is the database the map is of, the registry it is read
// through, the reader's scope (packs/database/kernel/db.ts: the viewer, whether an admin, whether they only read),
// the service and its input. A reader of no known scope (anyone with no login, a handle that names none) is never
// kept for. What a read weighs by the clock (what is due, how far back is recent) may lag by AGE_MS at most: an answer
// is asked again after that, the map moved or not. Memory is bounded: MOST answers a database, the least lately
// asked dropped first, and none whose input is over INPUT_MOST.

import type { Archipelago } from '../../write/kernel/pelago.ts';
import type { Db } from '../../database/kernel/db.ts';
import { mapClock } from '../../log/kernel/clock.ts';
import { keptCall } from '../../../src/timing.ts';

/** How long an answer is kept at most, the map moved or not: what is weighed by the clock lags by no more. */
export const AGE_MS = 60_000;
/** Answers kept for one database at most. */
export const MOST = 300;
/** The longest input, as JSON, whose answer is kept: a read asked with a whole state in hand is asked again. */
const INPUT_MOST = 8_000;

type Kept = { clock: string; at: number; answer: Promise<unknown> };

/** The answers kept, by the database they were read from. */
const stores = new WeakMap<Db, Map<string, Kept>>();
/** Each registry as a number, for a key: a map read through another registry (an island's) reads otherwise. */
const registries = new WeakMap<object, number>();
let registryCount = 0;

/** Who reads through the map, as one value, or undefined when it cannot be told: then nothing is kept for them. */
function readerOf(l: Archipelago): string | undefined {
  const scope = l.db.scope;
  if (scope === 'anyone') return undefined;
  if (scope !== undefined) return `${scope}|${l.props}`;
  return l.viewer === undefined && l.db.whole === undefined ? `whole|${l.props}` : undefined;
}

/** A copy for each asker: what one does with an answer never reaches another's. */
const copy = <T>(answer: T): T => structuredClone(answer);

/** The answer to `name` with `input`, kept until the map moves: `read` asks it when no answer is kept for where the map stands. */
export async function keptAnswer<T>(l: Archipelago, name: string, input: unknown, read: () => Promise<T>): Promise<T> {
  const reader = readerOf(l);
  const said = reader === undefined ? undefined : JSON.stringify(input ?? null);
  if (reader === undefined || said === undefined || said.length > INPUT_MOST) {
    keptCall(false);
    return read();
  }
  const whole = l.db.whole ?? l.db;
  let store = stores.get(whole);
  if (!store) stores.set(whole, (store = new Map()));
  if (!registries.has(l.registry)) registries.set(l.registry, ++registryCount);
  const key = `${l.workspace}|${registries.get(l.registry)}|${reader}|${name}|${said}`;
  // Where the map stands, read before the answer: the answer is never older than the clock it is kept under.
  const clock = await mapClock(whole);
  const now = Date.now();
  const had = store.get(key);
  if (had && had.clock === clock && now - had.at < AGE_MS) {
    store.delete(key);
    store.set(key, had); // the most lately asked last
    keptCall(true);
    return copy((await had.answer) as T);
  }
  keptCall(false);
  const answer = read();
  const kept: Kept = { clock, at: now, answer };
  store.delete(key);
  store.set(key, kept);
  while (store.size > MOST) store.delete(store.keys().next().value!);
  answer.catch(() => { if (store.get(key) === kept) store.delete(key); }); // a read that failed is asked again
  return copy(await answer);
}

/** How many answers are kept for a map's database: for the tests. */
export const keptCount = (l: Archipelago): number => stores.get(l.db.whole ?? l.db)?.size ?? 0;
