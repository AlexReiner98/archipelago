// The structure guard: a sync never shows a principle the code has broken further. Each structure check's principle on
// the island holds how many known breaks its ratchet lists hold (`breaks`, extract-checks.ts). A list may only shrink,
// yet the structure test takes a list as its allowance, so an entry added to one passes CI: the island is the record of
// where each count stood. A count that rises against it stops the sync, naming the check; one that falls, a check that
// is new and a check that went are synced as ever. Pure: what the extractors want and the island as read in, the verdict out.

import type { Model } from './model.ts';
import type { Island } from './plan.ts';

/** A check whose known breaks rose: its name, and its count on the island and in the code. */
export interface Rise { check: string; was: number; now: number }

/** The checks whose known breaks are higher in the code than on the island; none when the sync may go on. */
export function risen(want: Model, island: Pick<Island, 'byKey'>): Rise[] {
  const out: Rise[] = [];
  for (const w of want.items) {
    if (!w.key.startsWith('check:')) continue;
    const was = Number(island.byKey.get(w.key)?.props?.breaks), now = Number(w.props.breaks);
    if (Number.isFinite(was) && Number.isFinite(now) && now > was) out.push({ check: String(w.props.check ?? w.key.slice(6)), was, now });
  }
  return out;
}

/** The rises as one sentence: what stopped the sync, and how to go on. */
export const rose = (rises: Rise[]) =>
  `The known breaks of ${rises.map((r) => `"${r.check}" rose from ${r.was} to ${r.now}`).join(', ')}: a ratchet list only shrinks. Fix the code, or sync anyway with scripts/anatomy.ts --force.`;
