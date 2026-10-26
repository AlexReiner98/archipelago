// What a session touched: the items it read, showed or changed, as a set kept with its run. Each read is presence
// (src/presence.ts), kept nowhere; only the set is kept, in the transient store (src/transient.ts) under the run, for
// a week after the session was last heard from, and a week after it ends. Every agent session may share one token, so
// the server cannot tell from a call whose session made it: the session's own hook says, at each prompt, turn and
// end, which items its calls to the map named (scripts/pelago-hook.mjs reads them from the session's transcript).

import type { Q } from './db.ts';
import { wholeMap } from './outbox.ts';
import type { Archipelago } from './pelago.ts';
import { keep, kept } from './transient.ts';

/** How long a run's set is kept after it was last heard from, or ended. */
export const TOUCHED_MS = 7 * 86_400_000;
/** The most items a run's set holds: past it, the first touched are let go. */
export const TOUCHED_KEPT = 500;
const ID = /^e_[a-z0-9]{8}$/;
const key = (run: string) => `touched:${run}`;

/** Add what the hook says a run touched to its set, and keep the set a week from now. */
export async function addTouched(db: Q, run: string, said: unknown): Promise<string[]> {
  const ids = Array.isArray(said) ? said.filter((v): v is string => typeof v === 'string' && ID.test(v)) : [];
  const had = (await kept<string[]>(db, key(run))) ?? [];
  const all = [...new Set([...had, ...ids])].slice(-TOUCHED_KEPT);
  await keep(db, key(run), all, TOUCHED_MS);
  return all;
}

/** The items a run touched, in the order it first touched them. */
export async function touchedBy(l: Archipelago, run: string): Promise<string[]> {
  return (await kept<string[]>((await wholeMap(l)).db, key(run))) ?? [];
}

/** A run has ended: its set is kept a week from now. */
export async function keepTouched(l: Archipelago, run: string): Promise<void> {
  const { db } = await wholeMap(l);
  const had = await kept<string[]>(db, key(run));
  if (had) await keep(db, key(run), had, TOUCHED_MS);
}
