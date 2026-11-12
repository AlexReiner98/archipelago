// The reads the sessions pack needs of the reads API (packs/sessions/kernel, on its context): the chats begun in a
// folder lately, a run's parent and what it works on, what a session vouches for as it ends, what closing an item
// offers to close. Each is bounded by the ids it is given, a moment, a limit, or an index it names, and answered as the
// asker under row-level security, as every read of packreads.ts is. The SQL is the modules' own, moved as it was.

import type { Archipelago, Entity } from '../../../src/pelago.ts';
import { scopeWithin } from '../../write/kernel/within.ts';
import { packVersionsFor } from '../../loader/kernel/pack-versions.ts';
import { itemLink } from '../../identity/kernel/members.ts';

export type SessionsRead = {
  /** The open runs a chat's hook made (a session id) since a moment, newest first, at most 50. */
  chat_runs_since?: string;
  /** The link to its parent (started_from) a run has now, if any. */
  parent_of?: string;
  /** The run already reported by this link and title, if any. */
  run_reported?: { link: string; title: string };
  /** What is still open that these items run one of these links to, each with the link and what it runs from. */
  offer_targets?: { from: string[]; types: string[] };
  /** Of these items, those open and of these types: the due first, then the newest changed. */
  open_work?: { ids: string[]; types: string[] };
  /** The items a change waiting for a person names. */
  pending_ids?: true;
  /** Of these items, those not changed after a moment. */
  untouched?: { ids: string[]; at: string };
  /** The resources an item needs, whole. */
  needs_of?: string;
  /** The run a clear ended in this folder a moment ago, whose chat goes on, not already taken over. */
  cleared_here?: { cwd: string; since: string };
  /** The words the open sessions hold. */
  names_held?: true;
  /** The open notices that a run went quiet. */
  quiet_notices?: string;
  /** What a run works on (works_on), not archived: each with its type. */
  works_of?: string;
  /** The packs in force on an island, or the map's, each with its version and its manifest's hash. */
  packs_at?: { island?: string };
  /** Everything a token within these items may write to. */
  token_scope?: string[];
  /** Whose screen the map is read for: its workspace and the person it is read as, as the presence pack's names take it. */
  whose?: true;
  /** The island a session works on: its task's, once it has said one, else its repository's (the place it lives in). */
  run_island?: string;
  /** The open items that may be held: of a type with a capacity, saying it in one of these fields, or every one where a type says it as a number. */
  holdable?: { types: string[]; fields: string[]; any: boolean };
  /** How an item of this workspace is linked for a person: the site's address with {id} in it. */
  item_link?: true;
};

const ids = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((id) => typeof id !== 'string')) throw new Error(`${what} is a list of ids`);
  return v as string[];
};

/** The answer to one of these reads, or undefined when the read is none of them. */
export async function sessionsRead(l: Archipelago, q: SessionsRead): Promise<unknown> {
  if (q.chat_runs_since !== undefined) {
    const { rows } = await l.db.query<Entity>(
      `select * from entity where type = any($1::text[]) and is_open and archived_at is null and props ? 'session_id' and created_at > $2 order by created_at desc limit 50 -- index entity_type`,
      [l.registry.family('run'), new Date(String(q.chat_runs_since)).toISOString()],
    );
    return rows;
  }
  if (q.parent_of !== undefined) {
    const { rows } = await l.db.query<{ id: string; to_id: string }>(
      `select id, to_id from relation where from_id = $1 and type = any($2::text[]) and valid_to is null limit 1`,
      [String(q.parent_of), l.registry.relationFamily('started_from')],
    );
    return rows[0] ?? null;
  }
  if (q.run_reported !== undefined) {
    const { rows } = await l.db.query<{ id: string }>(`select id from entity where type = any($1::text[]) and props->>'link' = $2 and title = $3 and archived_at is null limit 1`, [l.registry.family('run'), String(q.run_reported.link), String(q.run_reported.title)]);
    return rows[0]?.id ?? null;
  }
  if (q.offer_targets !== undefined) {
    const { rows } = await l.db.query(
      `select e.id, e.title, e.status, e.type, r.from_id as by, r.type as link from relation r join entity e on e.id = r.to_id
       where r.from_id = any($1::text[]) and r.type = any($2::text[]) and r.valid_to is null and e.is_open and e.archived_at is null order by e.id`,
      [ids(q.offer_targets.from, 'offer_targets.from'), ids(q.offer_targets.types, 'offer_targets.types')],
    );
    return rows;
  }
  if (q.open_work !== undefined) {
    const { rows } = await l.db.query(
      `select id, type, title, status from entity where id = any($1::text[]) and is_open and archived_at is null and type = any($2::text[]) order by props->>'due' nulls last, updated_at desc`,
      [ids(q.open_work.ids, 'open_work.ids'), ids(q.open_work.types, 'open_work.types')],
    );
    return rows;
  }
  if (q.pending_ids !== undefined) {
    const { rows } = await l.db.query<{ ops: { id?: string }[] }>(`select ops from proposal where status = 'pending' -- index proposal_status`);
    return [...new Set(rows.flatMap((p) => p.ops.flatMap((o) => ('id' in o && o.id ? [o.id] : []))))];
  }
  if (q.untouched !== undefined) {
    const { rows } = await l.db.query<{ id: string }>(`select id from entity where id = any($1::text[]) and updated_at <= $2`, [ids(q.untouched.ids, 'untouched.ids'), new Date(String(q.untouched.at))]);
    return rows.map((r) => r.id);
  }
  if (q.needs_of !== undefined) {
    const { rows } = await l.db.query<Entity>(
      `select res.* from relation n join entity res on res.id = n.to_id
       where n.type = any($2::text[]) and n.from_id = $1 and n.valid_to is null and res.archived_at is null`,
      [String(q.needs_of), l.registry.relationFamily('needs')],
    );
    return rows;
  }
  if (q.cleared_here !== undefined) {
    const { rows } = await l.db.query<Entity>(
      `select * from entity e where type = any($1::text[]) and not is_open and archived_at is null and props->>'ended_by' = 'clear' and props->>'cwd' = $2 and updated_at > $3
         and not exists (select 1 from entity o where o.type = any($1::text[]) and o.props->>'took_over' = e.id) order by updated_at desc limit 1`,
      [l.registry.family('run'), String(q.cleared_here.cwd), new Date(String(q.cleared_here.since)).toISOString()],
    );
    return rows[0] ?? null;
  }
  if (q.names_held !== undefined) {
    const { rows } = await l.db.query<{ name: string }>(`select props->>'name' as name from entity where type = any($1::text[]) and is_open and archived_at is null and props ? 'name'`, [l.registry.family('run')]);
    return rows.map((r) => r.name);
  }
  if (q.quiet_notices !== undefined) {
    const { rows } = await l.db.query<{ id: string }>(
      `select n.id from entity n join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
       where r.to_id = $1 and n.type = 'notification' and n.is_open and n.archived_at is null and n.props->>'from' = 'agent:pelago'`,
      [String(q.quiet_notices)],
    );
    return rows.map((r) => r.id);
  }
  if (q.works_of !== undefined) {
    const { rows } = await l.db.query<{ id: string; type: string }>(
      `select e.id, e.type from relation r join entity e on e.id = r.to_id where r.type = 'works_on' and r.from_id = $1 and r.valid_to is null and e.archived_at is null`,
      [String(q.works_of)],
    );
    return rows;
  }
  if (q.packs_at !== undefined) return packVersionsFor(l, typeof q.packs_at.island === 'string' ? { props: { island: q.packs_at.island } } : undefined);
  if (q.token_scope !== undefined) return [...(await scopeWithin(l, ids(q.token_scope, 'token_scope')))];
  if (q.item_link !== undefined) return itemLink(l.workspace);
  if (q.whose !== undefined) return { workspace: l.workspace, ...(l.viewer !== undefined && { viewer: l.viewer }) };
  if (q.run_island !== undefined) {
    const { rows } = await l.db.query<{ island: unknown; works: boolean }>(
      `select e.props->>'island' as island, r.type = any($2::text[]) as works from relation r join entity e on e.id = r.to_id
       where r.from_id = $1 and r.valid_to is null and e.archived_at is null and r.type = any($2::text[] || $3::text[]) and e.props ? 'island'
       order by works desc, r.valid_from desc limit 1`,
      [String(q.run_island), l.registry.relationFamily('works_on'), l.registry.relationFamily('lives_in')],
    );
    return typeof rows[0]?.island === 'string' ? rows[0].island : null;
  }
  if (q.holdable !== undefined) {
    const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and is_open and archived_at is null and (props ?| $2::text[] or $3) -- index entity_type`, [ids(q.holdable.types, 'holdable.types'), ids(q.holdable.fields, 'holdable.fields'), q.holdable.any === true]);
    return rows;
  }
  return undefined;
}
