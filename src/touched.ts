// What the map's changes since a page last looked touched, as that viewer may see them: the items changed and both
// ends of each link made or ended. The page draws again only what bears on one of them (ui/live.js), so a change
// elsewhere on the map leaves it still.

import type { Q } from './db.ts';
import { lastSeq, readEvents } from './eventlog.ts';

/** More events than this since the last look, and the page is told only that much changed. */
const MOST = 400;

export interface Touched {
  /** The last event the viewer can see: the next look asks from here. */
  seq: number;
  /** The items changed or linked since `after`; null when too much changed to say. */
  ids: string[] | null;
  /** How many items were made since `after`: a list may hold a new one. */
  made: number;
}

/** What changed after the event `after`, read through the viewer's own rows. Without `after`, only where things stand. */
export async function touched(db: Q, after?: number): Promise<Touched> {
  if (after === undefined) return { seq: await lastSeq(db), ids: [], made: 0 };
  const rows = await readEvents(db, { after, oldest: true, limit: MOST + 1 });
  if (rows.length > MOST) return { seq: await lastSeq(db), ids: null, made: 0 };
  const ids = new Set<string>();
  for (const r of rows) for (const id of [r.target_id, r.detail?.to]) if (typeof id === 'string') ids.add(id);
  return { seq: rows.length ? rows.at(-1)!.seq : after, ids: [...ids], made: rows.filter((r) => r.action === 'entity.create').length };
}
