// Where a change's facts came from: a source item for each uri a change or an op names, made the first time and
// found every time after. Moved from the write path's apply loop (ensureSource, src/change-apply.ts) into the
// placement pack (docs/kernel-packs.md, "Where each module goes"). It fills write.follow.rides (the owner, 12 Nov
// 2026, e_umv4gdqr): the source it makes rides the change that names it, with that change's verdict and authority,
// and no rule judges it on its own. The write path asks it where an op names its source, inside the apply's
// transaction (`q`), and says what it makes before the facts that name it.

import type { KernelContext } from '#pelago/kernel';

/** A source as a change or an op names it. */
export interface SourceSpec { uri: string; title?: string; kind?: string; excerpt?: string }
/** What the write path hands: a query on the change's transaction. */
export interface Q { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
/** What the write path hands a filling of write.follow.rides, as this reads it (src/write-hooks.ts, Ride). */
export interface Ride { q: Q; place: string; source?: SourceSpec }
/** The source item it makes. */
export type Made = { op: 'create'; ref: string; type: string; title: string; body: string; status: string; props: Record<string, unknown> };

/** The ref a source made in a change is named by: its uri, so the same uri is made once. */
export const sourceRef = (uri: string) => `source ${uri}`;

/** The filling of write.follow.rides: the item a named source is, found by its uri or made, where the map has sources. */
export async function follow(ctx: KernelContext, _ops: unknown[], ride: Ride): Promise<{ is?: string; ops?: Made[] }> {
  const spec = ride.place === 'source' ? ride.source : undefined;
  const type = spec && ctx.registry.type('source');
  if (!spec || !type) return {};
  const found = await ride.q.query<{ id: string }>(`select id from entity where type = 'source' and props->>'uri' = $1 and archived_at is null -- index entity_source_uri`, [spec.uri]);
  if (found.rows.length) return { is: found.rows[0].id };
  const ref = sourceRef(spec.uri);
  const props: Record<string, unknown> = { uri: spec.uri };
  if (spec.kind) props.kind = spec.kind;
  return { is: ref, ops: [{ op: 'create', ref, type: type.id, title: spec.title ?? spec.uri, body: spec.excerpt ?? '', status: 'recorded', props }] };
}
