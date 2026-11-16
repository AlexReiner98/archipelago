// Answers kept until the map moves (task e_unbw4gtp). A read a pack marks kept (its service's `kept` in kernel.provides)
// answers from the map alone: asked again with the same input by the same reader, and nothing written since that it
// may depend on, it answers the same. So its answer is kept under where the map stood before it was read
// (packs/log/kernel/position.ts, mapClock) and given again while the map stands there: a canvas whose filter changed one term
// asks the frontier, the views and the style again, and only the term that changed is read.
//
// Kept per map and per reader, never across: the key is the registry the map is read
// through, the reader's scope (packs/database/kernel/db.ts: the viewer, whether an admin, whether they only read),
// the service and its input. A reader of no known scope (anyone with no login, a handle that names none) is never
// kept for. What a read weighs by the clock (what is due, how far back is recent) may lag by AGE_MS at most: an answer
// is asked again after that, the map moved or not. Memory is bounded: MOST answers a database, the least lately
// asked dropped first, and none whose input is over INPUT_MOST.

import type { Archipelago } from '../../write/kernel/pelago.ts';
import { mapClock } from '../../log/kernel/position.ts';
import { keptCall } from '../../../src/timing.ts';

/** How long an answer is kept at most, the map moved or not: what is weighed by the clock lags by no more. */
export const AGE_MS = 60_000;
/** Answers kept for one database at most. */
export const MOST = 300;
/** The longest input, as JSON, whose answer is kept: a read asked with a whole state in hand is asked again. */
const INPUT_MOST = 8_000;

type Kept = { clock: string; at: number; answer: Promise<unknown> };

/** The answers kept, by the registry the map is read through: one store for every reader of a workspace (each answer still the reader's own, by its key). Two databases that share a registry (a map rebuilt from the same log) stand at the same place only when their logs do, and then answer the same. */
const stores = new WeakMap<object, Map<string, Kept>>();
/** Each registry as a number, for a key: a map read through another registry (an island's) reads otherwise. */
const registries = new WeakMap<object, number>();
let registryCount = 0;

/** Who reads through the map, as one value, or undefined when it cannot be told: then nothing is kept for them. */
function readerOf(l: Archipelago): string | undefined {
  const scope = l.db.scope;
  if (scope === 'anyone') return undefined;
  if (scope !== undefined) return `${scope}|${l.props}`;
  // No scope and no viewer: the database itself, read as the system reads it.
  return l.viewer === undefined ? `whole|${l.props}` : undefined;
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
  let store = stores.get(l.registry);
  if (!store) stores.set(l.registry, (store = new Map()));
  if (!registries.has(l.registry)) registries.set(l.registry, ++registryCount);
  const key = `${l.workspace}|${registries.get(l.registry)}|${reader}|${name}|${said}`;
  // Where the map stands, read before the answer, as the reader (what they may not see is only counted, by step 50):
  // the answer is never older than the clock it is kept under.
  const clock = await mapClock(l.db);
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

/** How many answers are kept for a map: for the tests. */
export const keptCount = (l: Archipelago): number => stores.get(l.registry)?.size ?? 0;
