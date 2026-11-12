// The reads of the reads API (src/packreads.ts) that kernel modules of service rows still answer, as fillings of the
// surface's slot surface.reads (src/surface-fillings.ts): a view by its name (the query pack's views and askview) and what
// falls in a window of time (the query pack's timeaxis and its limit). Each is what packreads answered itself before,
// moved whole; the step that moves its module into its pack moves its filling there too, named in the pack's manifest.
// An instruction counted as said is the usage pack's filling (reads.ts#told), what a run touched the reads API's own
// (src/packreads-log.ts, runsOf), and the activity log's events the reads API's own (packreads-views.ts, wave 6).

import type { Archipelago, Entity } from './pelago.ts';
import type { Read } from './packreads.ts';
import { pinned } from './packreads-pin.ts';
import { shapes } from './packreads-rows.ts';
import { LENS_LIMIT } from './query-flat.ts';
import { placeAll, readAxis, zoneOf } from './timeaxis.ts';
import { askPackView, VIEWS } from './views.ts';

/** A kernel view, a lens preset (attention, hubs) or a pack's view, each by its short name (repo_work); refused when pinned to another. */
export async function view(l: Archipelago, q: Read & { view: string }): Promise<unknown> {
  const found = VIEWS[q.view];
  if (q.pin !== undefined) pinned(l, q.view, q.pin, Boolean(found));
  return found ? found.run(l, q.params ?? {}) : askPackView(l, q.view, q.params ?? {});
}

/** Items of some types placed in a window of time, each with where it falls. */
export async function placed(l: Archipelago, q: Read & { placed: NonNullable<Read['placed']> }): Promise<unknown> {
  const { cols, typed, family } = shapes(l, q.fields);
  const axis = readAxis(q.placed);
  const { rows } = await l.db.query<Entity>(
    `select ${cols('e')} from entity e where e.type = any($1::text[]) and e.archived_at is null and (e.is_open or e.updated_at >= $2::timestamptz) order by e.updated_at desc limit ${LENS_LIMIT} -- index entity_type`,
    [family(q.placed.types) ?? [], axis.from],
  );
  const spans = await placeAll(l, rows, axis, await zoneOf(l));
  return rows.filter((e) => spans.get(e.id)?.length).map((e) => ({ ...typed(e), open: e.is_open, time: spans.get(e.id) }));
}
