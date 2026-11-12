// What is a place's or an item's: what a token within some items may write to (./within.ts), and what the reads API
// reads as it (scope, within, runs, type_info; packs/surface/kernel/packreads-scope.ts re-exports it). The write root's
// (wave 7), below the surface that reads it: a bounded scan, never a pack's, since the runs pack's places are answered by
// name and the sessions pack is optional.

import type { Archipelago } from './pelago.ts';
import { notKernel } from '../../loader/kernel/head.ts';

/** The link that ties a thing to this place: of the relations that are a kind of lives_in, the nearest one its type is made for. */
export function livesInFor(l: Archipelago, placeType: string): string {
  const lineage = l.registry.type(placeType)?.lineage ?? [placeType];
  const fits = l.registry
    .relationFamily('lives_in')
    .map((id) => l.registry.relations.get(id)!)
    .map((r) => ({ id: r.id, at: Math.min(...r.to.map((t) => (t === '*' ? lineage.length : lineage.indexOf(t))).filter((i) => i >= 0)) }))
    .filter((r) => Number.isFinite(r.at));
  return fits.sort((a, b) => a.at - b.at)[0]?.id ?? 'lives_in';
}

/** The relations a thing lives in a place by, read whichever flavour tied it. */
export const livesIn = (l: Archipelago) => l.registry.relationFamily('lives_in');

/**
 * Everything that is a place's or an item's, as a query over $1 and the lives_in relations in $2: the item itself,
 * what lives in it, and all that is part of that or about it. An issue is often filed as about a project, not as
 * part of it, and is that project's work all the same.
 */
export const SCOPE = `with recursive scope(id) as (
       select $1::text
       union
       select from_id from relation where type = any($2::text[]) and to_id = $1 and valid_to is null
       union
       select r.from_id from relation r join scope s on r.to_id = s.id where r.type in ('part_of', 'about') and r.valid_to is null
     )`;

/** The ids of everything that is a place's or an item's (SCOPE); open: only what is open and not the system's, and the item; among: only which of these. */
export async function scopeOf(l: Archipelago, id: string, open = false, among?: string[]): Promise<Set<string>> {
  const { rows } = await l.db.query<{ id: string }>(
    open
      ? `${SCOPE} select s.id from scope s join entity e on e.id = s.id where s.id = $1 or (e.is_open and e.archived_at is null and ${notKernel(l.registry, 'e.type')})`
      : `${SCOPE} select id from scope${among ? ' where id = any($3::text[])' : ''}`,
    [id, livesIn(l), ...(among ? [among] : [])],
  );
  return new Set(rows.map((r) => r.id));
}
