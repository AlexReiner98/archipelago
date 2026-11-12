// root.merge (docs/kernel-packs.md, "Root services"): a backup merged into a map, called only by the packs
// packs/roots.json names for it (the backup pack), values in and values out. It is the write root's: what it writes of
// the map's rows goes through the restore path the write root keeps (restoreRows, packs/write/kernel/pelago.ts); the backup is opened,
// and what the log makes of the rows made again, by the log root below it (src/backup.ts).

import { opened, type Dump } from '../../log/kernel/backup.ts';
import { regatherAll } from '../../log/kernel/closure.ts';
import { projectAgain } from '../../log/kernel/log-project.ts';
import { recountBytes } from '../../log/kernel/bytes.ts';
import { bringIn } from '../../log/kernel/activity.ts';
import { analyzeDue } from '../../database/kernel/stats.ts';
import type { RootCall } from '../../loader/kernel/root-calls.ts';
import { restoreRows } from './pelago.ts';

/** What merging a backup did to the map's rows, or would do: the backup pack makes its report from it. */
export interface Merged {
  from: { id: string; name: string };
  taken: string;
  /** Each item of the file, newest first, and what becomes of it here. */
  plan: { title: string; what: 'added' | 'updated' | 'kept_newer_here' | 'same' }[];
  relations: { added: boolean }[];
  proposals: { added: boolean }[];
  /** The positions its events took in this map's activity stream. */
  events: number[];
  owner_set: boolean;
  open_sessions: number;
  holds: number;
}

class Preview extends Error {}

/**
 * root.merge: a dump merged into the map that asks, matching rows by id. Nothing is deleted. An entity on both sides
 * keeps whichever was edited later, as a whole. A relation ended on either side is ended; a proposal decided on either
 * side is decided. Events the map does not have are added after its own, keeping their times. Tokens and settings stay
 * as they are here, except that a map with no owner takes the file's. Sessions still open in the file (of
 * `session_types`), and what they hold, are left out. Without `apply` it changes nothing. The map is the whole one.
 */
export async function mergeOf(call: RootCall, input: { dump: Dump; session_types?: string[]; apply?: boolean }): Promise<Merged> {
  const l = call.map;
  if (!l || l.viewer !== undefined) throw new Error('root.merge writes the whole map: call it from the whole map, not one person’s view');
  const { db, workspace } = l;
  const backup = await db.transaction((tx) => opened(tx, input.dump, Boolean(input.apply)));
  const here = (rows: Record<string, unknown>[] = []) => rows.map((row) => ({ ...row, workspace }));
  const openSession = (e: Record<string, unknown>) => Boolean(input.session_types?.includes(e.type as string) && e.is_open);
  const all = backup.tables.entity ?? [];
  const entities = JSON.stringify(here(all.filter((e) => !openSession(e))));
  const held = (r: Record<string, unknown>) => r.type === 'holds' && r.valid_to == null;
  const relations = backup.tables.relation ?? [];
  const me = backup.tables.setting?.find((s) => s.key === 'me')?.value ?? null;
  let merged!: Merged;
  try {
    await db.transaction(async (tx) => {
      const { rows: plan } = await tx.query<Merged['plan'][number]>(
        `select i.title, case when e.id is null then 'added' when i.updated_at > e.updated_at then 'updated' when e.updated_at > i.updated_at then 'kept_newer_here' else 'same' end as what
         from jsonb_populate_recordset(null::entity, $1::jsonb) i left join entity e on e.id = i.id order by i.updated_at desc`,
        [entities],
      );
      const rels = await restoreRows(tx, entities, JSON.stringify(here(relations.filter((r) => !held(r)))));
      await regatherAll(tx, ['part_of']);
      await projectAgain(tx, l.registry);
      await recountBytes(tx);
      const { rows: props } = await tx.query<{ added: boolean }>(
        `insert into proposal select * from jsonb_populate_recordset(null::proposal, $1::jsonb)
         on conflict (id) do update set status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at, note = excluded.note
         where proposal.status = 'pending' and excluded.status <> 'pending'
         returning (xmax = 0) as added`,
        [JSON.stringify(here(backup.tables.proposal))],
      );
      // Its events go in the activity stream, after this map's own (packs/log/kernel/activity.ts): each once.
      const events = await bringIn(tx, workspace, [], backup.tables.event ?? []);
      // The file's owner, if this map has none and the person is on it: read by the id, as only an id names an item.
      const { rows: owner } = await tx.query(
        `insert into setting (key, value) select 'me', $1::jsonb where exists (select 1 from entity where id = $2) on conflict (key) do nothing returning key`,
        [JSON.stringify(me), typeof me === 'string' ? me : null],
      );
      merged = { from: backup.workspace, taken: backup.taken, plan, relations: rels, proposals: props, events, owner_set: owner.length > 0, open_sessions: all.filter(openSession).length, holds: relations.filter(held).length };
      // Looking only: undo all of it.
      if (!input.apply) throw new Preview();
    });
  } catch (err) {
    if (!(err instanceof Preview)) throw err;
  }
  if (input.apply) await analyzeDue(db);
  return merged;
}
