// What a pack's handler may read of the map, answered as the actor the call is made for (under row-level security,
// like any of the actor's reads). Every item comes with what it is (is: its type and those it extends), so a
// handler asks what kind of thing it is rather than naming a type alone. A read that asks for some fields is given
// those of each item's props, and no note: a session's story or a long note need not cross the pipe for nothing.

import { livesIn, livesInFor, SCOPE } from './packreads-scope.ts';
import type { Archipelago, Entity } from '../../../src/pelago.ts';
import { blockGraph } from './blocking.ts';
import { packVersions } from '../../loader/kernel/pack-versions.ts';
import { scanAround } from './region.ts';
import { NAME, pageOf, paged, READ_LIMIT, shapes, type Page } from './packreads-rows.ts';
import { confirmQuestions, factsByRun, heldChanges, lastSaid, runsOf } from './packreads-log.ts';
import type { Pin } from './packreads-pin.ts';
import { filled, kernelRead, type KernelRead } from './packreads-kernel.ts';
import { serviceRead, type ServiceRead } from './packreads-service.ts';
import { viewsRead, type ViewsRead } from './packreads-views.ts';
import { runsRead, type RunsRead } from './packreads-runs.ts';
import { fillReads } from '../../loader/kernel/packhost.ts'; import { trail } from './map-reads.ts';

export type Read = KernelRead & ServiceRead & ViewsRead & RunsRead & {
  get?: string;
  /** Items of a type (flavours included): with a status or one of several, fields equal to where's, and a field between two values. */
  items?: { type: string; status?: string | string[]; where?: Record<string, unknown>; between?: { field: string; from?: string; to?: string } };
  /** What an item is linked to by a kind of link (flavours included), each with the link's id; only of some types, newest first if asked. */
  related?: string;
  relation?: string;
  direction?: 'out' | 'in';
  types?: string[];
  newest?: 'created' | 'updated';
  /** What an item is part of, outermost first. */
  trail?: string;
  /** Everything that is a place's or an item's: itself, what lives in it, and all part of that or about it; of some types, open or not. */
  scope?: string;
  open?: boolean;
  /** With scope: only what is part of it, not what is about it or lives in it. */
  parts?: boolean;
  /** With scope: only what changed after this moment (an ISO date-time). */
  since?: string;
  /** Everything part of any of these items, and the items themselves, in one read. */
  parts_of?: string[];
  /** What is around an item (src/region.ts), in one read: what is inside it, what it is tied to and what is inside that, and the links among them, each with what it is, the links in the order they were made. over: the links it follows (every kind unless given); above: what holds what it is tied to, all the way up. */
  around?: { from: string; over?: string[]; above?: boolean };
  /** Items of these types placed in a window of time (src/timeaxis.ts): each with where it falls (time), by its when (a repeat's days) or bound, a session where it was at work. Only what falls in it; what is closed, only if it changed in or after the window. */
  placed?: { types: string[]; from: string; to: string; by?: ('when' | 'bound')[] };
  /** Which of these items have a picture kept for them. */
  pictures?: string[];
  /** For each item: whether it is blocked, whether it waits on someone's answer, and what has to move first. */
  blocked?: string[];
  /** The runs whose changes wrote these items (made them or changed them), as the log keeps each change's run: one row per item and run, with the run's title and the packs it ran under. */
  writers?: string[];
  view?: string;
  params?: Record<string, unknown>;
  /** With view: the pack that answers it and the version (or manifest hash) the asking view was made against. A view that
   *  reads another is refused, saying both, when what answers now is not that one, rather than read a changed answer. */
  pin?: Pin;
  /** One page of items, related, scope, facts, runs or held: { rows, next } in place of the list, next the cursor for the page after. */
  page?: Page;
  /** Every fact a run's changes wrote, oldest first, a page at a time (values: false leaves their values out). */
  facts?: { run: string; values?: boolean };
  /** Who last said each field of these items, when, in which change and on whose authority (values: true adds what). */
  said?: { ids: string[]; fields?: string[]; values?: boolean };
  /** The runs of a repository or a folder, newest first, a page at a time; touched: true adds what each touched. */
  runs?: { repo?: string; folder?: string; open?: boolean; touched?: boolean };
  /** The changes held for a person that the asker may see, oldest first, a page at a time. */
  held?: boolean;
  /** The questions agents settled that the owner has not confirmed. */
  confirm?: { limit?: number };
  /** What a type is: its statuses, whether a person settles it (a question) and how, and whether it is estimated, so a handler need not know it. */
  type_info?: string;
  /** The live types that declare this field, by id, so a handler can find what carries a field without naming types. */
  with_field?: string;
  /** Who the answer is for: the person asking, else the workspace's owner. */
  me?: boolean;
  /** Whether a change with this op is waiting for a person already. */
  proposed?: Record<string, unknown>;
  /** Only these of each item's props, and no note. */
  fields?: string[];
  /** The packs in force here, each with its version and its manifest's hash (src/pack-versions.ts). */
  packs?: boolean;
};

// The loader's sandbox asks its packs' reads of this (the slot loader.reads, src/packhost.ts).
fillReads((l, read, pack) => answerRead(l, read, pack));

/** The answer to a read, as the map asks it; `pack` is the internal pack asking, when one is (its own memory is read by it alone). */
export async function answerRead(l: Archipelago, q: Read, pack?: string): Promise<unknown> {
  // The reads a kernel view needs as a service pack (src/packreads-kernel.ts), and those the moved services need (src/packreads-service.ts).
  const kernel = await kernelRead(l, q, pack);
  if (kernel !== undefined) return kernel;
  const service = await serviceRead(l, q, pack);
  if (service !== undefined) return service;
  const views = await viewsRead(l, q);
  if (views !== undefined) return views;
  const runs = await runsRead(l, q);
  if (runs !== undefined) return runs;
  if (q.fields && (!Array.isArray(q.fields) || q.fields.some((f) => !NAME.test(f)))) throw new Error('fields is a list of field names');
  // An item's columns as the asker may read them: anyone with no login reads no note, no owner, no link's id, and of the
  // props only the few public ones, and may not filter by props at all.
  const { open, cols, typed, family } = shapes(l, q.fields);
  // A paged read is one row past the page, from where the last page ended, by its order's key (src/packreads-rows.ts).
  const page = pageOf(q.page);
  const size = page ? page.size + 1 : READ_LIMIT;
  const after = page?.after ?? [null, null];
  const answer = (rows: (Entity & { page_key?: string; page_id?: string })[]) =>
    page ? paged(rows as (Entity & { page_key: string; page_id: string })[], page.size, (r) => typed(r as Entity)) : rows.map(({ page_key: _k, page_id: _i, ...r }) => typed(r as Entity));
  if (q.get !== undefined) {
    const { rows } = await l.db.query<Entity>(`select ${cols('entity')} from entity where id = $1`, [q.get]);
    return rows[0] ? typed(rows[0]) : null;
  }
  if (q.items) {
    const { type, status, where, between } = q.items;
    const field = between?.field;
    if (field !== undefined && !NAME.test(field)) throw new Error('between.field is the name of a field');
    if (!open && (field !== undefined || Object.keys(where ?? {}).length)) throw new Error('Anyone with no login cannot filter by fields.');
    const byProps = open ? `and props @> $3::jsonb and ($4::text is null or $5::text is null or props ->> $4 >= $5) and ($4::text is null or $6::text is null or props ->> $4 <= $6)` : `and $3::jsonb is not null and $4::text is null and $5::text is null and $6::text is null`;
    const { rows } = await l.db.query<Entity>(
      `select ${cols('entity')}, created_at::text as page_key, id as page_id from entity where type = any($1::text[]) and archived_at is null and ($2::text[] is null or status = any($2::text[])) ${byProps}
       and ($7::timestamptz is null or (created_at, id) > ($7::timestamptz, $8::text))
       order by created_at, id limit ${size}`,
      [l.registry.family(type), status === undefined ? null : [status].flat(), JSON.stringify(where ?? {}), field ?? null, between?.from ?? null, between?.to ?? null, after[0], after[1]],
    );
    return answer(rows);
  }
  if (q.related !== undefined) {
    const [near, far] = q.direction === 'in' ? ['to_id', 'from_id'] : ['from_id', 'to_id'];
    // Paged, the order is by a time and the item's id, so a cursor can say where a page ended: newest first if asked, else oldest.
    const at = q.newest === 'updated' ? 'e.updated_at' : 'e.created_at';
    const desc = page && q.newest ? ' desc' : '';
    const order = page ? `${at}${desc}, e.id${desc}` : q.newest === 'created' ? 'e.created_at desc' : q.newest === 'updated' ? 'e.updated_at desc' : open ? 'r.id' : 'e.id';
    const { rows } = await l.db.query<Entity & { link: string }>(
      `select ${cols('e')}, ${open ? 'r.id' : 'null'} as link, ${at}::text as page_key, e.id as page_id from relation r join entity e on e.id = r.${far}
       where r.${near} = $1 and r.type = any($2::text[]) and r.valid_to is null and e.archived_at is null and ($3::text[] is null or e.type = any($3::text[]))
       and ($4::timestamptz is null or (${at}, e.id) ${desc ? '<' : '>'} ($4::timestamptz, $5::text))
       order by ${order} limit ${size}`,
      [q.related, l.registry.relationFamily(q.relation ?? 'link'), family(q.types), after[0], after[1]],
    );
    return answer(rows);
  }
  if (q.trail !== undefined) return (await trail(l, q.trail)).map(({ id, type, title }) => typed({ id, type, title }));
  if (q.scope !== undefined) {
    // Its parts at any depth, along the part_of family as the registry has it. Walked, not read from the closure: a
    // pack's read may run for a public page, whose reader is not given the closure (src/closure.ts).
    const under = q.parts ? `with recursive scope(id) as (select $1::text union select r.from_id from relation r join scope s on r.to_id = s.id where r.type = any($6::text[]) and r.valid_to is null and $2::text[] is not null)` : SCOPE;
    // Unpaged, all of it as before; paged, newest first by when it changed and its id, a page at a time.
    const n = q.parts ? 7 : 6;
    const { rows } = await l.db.query<Entity>(
      `${under} select ${cols('e')}, e.updated_at::text as page_key, e.id as page_id from entity e join scope s on s.id = e.id
       where e.archived_at is null and ($3::text[] is null or e.type = any($3::text[])) and ($4::boolean is null or e.is_open = $4) and ($5::timestamptz is null or e.updated_at > $5::timestamptz)
       ${page ? `and ($${n}::timestamptz is null or (e.updated_at, e.id) < ($${n}::timestamptz, $${n + 1}::text))` : ''}
       order by e.updated_at desc, e.id desc${page ? ` limit ${size}` : ''}`,
      [q.scope, livesIn(l), family(q.types), q.open ?? null, q.since ?? null, ...(q.parts ? [l.registry.relationFamily('part_of')] : []), ...(page ? after : [])],
    );
    return answer(rows);
  }
  if (q.parts_of !== undefined) {
    if (!Array.isArray(q.parts_of) || q.parts_of.some((id) => typeof id !== 'string')) throw new Error('parts_of is a list of item ids');
    const { rows } = await l.db.query<Entity>(
      `with recursive scope(id) as (select unnest($1::text[]) union select r.from_id from relation r join scope s on r.to_id = s.id where r.type = any($2::text[]) and r.valid_to is null)
       select ${cols('e')} from entity e join scope s on s.id = e.id where e.archived_at is null order by e.updated_at desc`,
      [q.parts_of, l.registry.relationFamily('part_of')],
    );
    return rows.map(typed);
  }
  if (q.around !== undefined) {
    const over = q.around.over ?? 'all';
    if (over !== 'all' && (!Array.isArray(over) || over.some((kind) => !l.registry.relations.has(kind)))) throw new Error(`around.over: a list of kinds of link. Known: ${[...l.registry.relations.keys()].join(', ')}`);
    const reg = l.registry;
    const read = await scanAround(l, { starts: [String(q.around.from)], by: reg.relationFamily('part_of'), over: over === 'all' ? null : reg.relationFamily(...over), waits: [], above: Boolean(q.around.above), made: true });
    // What a link is: its kind and those it extends, as an item says what it is.
    const lineage = (type: string): string[] => [type, ...(l.registry.relations.get(type)?.extends ? lineage(l.registry.relations.get(type)!.extends!) : [])];
    return {
      items: read.entities.map(({ body: _body, ...e }) => typed({ ...e, ...(!open && { owner: null }) })),
      links: read.relations.map((r) => ({ ...(open && { id: r.id }), type: r.type, from: r.from_id, to: r.to_id, is: lineage(r.type) })),
    };
  }
  if (q.placed !== undefined) return filled(l, 'placed', q, pack);
  if (q.pictures) {
    const { rows } = await l.db.query<{ entity_id: string }>(`select entity_id from picture where entity_id = any($1::text[])`, [q.pictures]);
    return rows.map((r) => r.entity_id);
  }
  if (q.blocked) {
    const graph = await blockGraph(l, q.blocked);
    const roots = [...new Set(q.blocked.flatMap((id) => graph.roots(id)))];
    const { rows } = roots.length ? await l.db.query<{ id: string; type: string; title: string; status: string }>(`select id, type, title, status from entity where id = any($1::text[])`, [roots]) : { rows: [] };
    const found = new Map(rows.map((r) => [r.id, r]));
    const root = (r: string) => ({ id: r, title: found.get(r)?.title, type: found.get(r)?.type, status: found.get(r)?.status });
    return Object.fromEntries(q.blocked.map((id) => [id, { blocked: graph.isBlocked(id), waits_on_someone: graph.waitsOnSomeone(id), roots: graph.roots(id).map(root) }]));
  }
  if (q.writers !== undefined) {
    if (!Array.isArray(q.writers) || q.writers.some((id) => typeof id !== 'string')) throw new Error('writers is a list of item ids');
    if (!open || !q.writers.length) return [];
    const { rows } = await l.db.query<{ item: string; run: string }>(
      `select distinct f.id as item, e.head->>'run' as run from log_fact f join log_entry e on e.stream = f.stream and e.pos = f.pos and e.at = f.at
       where f.id = any($1::text[]) and f.stream = 'facts' and e.head ? 'run'`,
      [q.writers],
    );
    const ids = [...new Set(rows.map((r) => r.run))];
    // The runs as the asker may see them: one hidden from them is left out with its rows.
    const { rows: runs } = ids.length ? await l.db.query<{ id: string; title: string; packs: unknown }>(`select id, title, props->'packs' as packs from entity where id = any($1::text[])`, [ids]) : { rows: [] };
    const run = new Map(runs.map((r) => [r.id, r]));
    return rows.filter((r) => run.has(r.run)).map((r) => ({ item: r.item, run: r.run, title: run.get(r.run)!.title, ...(run.get(r.run)!.packs != null && { packs: run.get(r.run)!.packs }) }));
  }
  if (q.facts !== undefined) return factsByRun(l, { ...q.facts, page: q.page });
  if (q.said !== undefined) return lastSaid(l, q.said);
  if (q.runs !== undefined) return runsOf(l, { ...q.runs, fields: q.fields, page: q.page });
  if (q.held) return heldChanges(l, { page: q.page });
  if (q.confirm !== undefined) return confirmQuestions(l, q.confirm ?? {});
  if (q.packs) return packVersions(l.registry);
  // A kernel view, a lens preset (attention, hubs) or a pack's view, each by its short name (repo_work), pinned or not.
  if (q.view !== undefined) return filled(l, 'view', q, pack);
  if (q.type_info !== undefined) {
    const t = l.registry.type(q.type_info);
    // lives_in: the link that puts an item in a place of this type.
    return t ? { id: t.id, is: t.lineage, statuses: t.statuses, settles: l.registry.having('settles').includes(t.id), settled_by: t.capabilities.settles?.by ?? null, estimated: Boolean(t.fields.tokens_estimated), lives_in: livesInFor(l, t.id), fields: Object.keys(t.fields) } : null;
  }
  if (q.with_field !== undefined) {
    if (typeof q.with_field !== 'string' || !q.with_field) throw new Error('with_field is a field name');
    return [...l.registry.types.values()].filter((t) => !t.dormant && q.with_field! in t.fields).map((t) => t.id).sort();
  }
  if (q.me) return l.viewer || (await l.setting<string>('me')) || null;
  if (q.proposed !== undefined) {
    const { rows } = await l.db.query(`select 1 from proposal where status = 'pending' and ops @> $1::jsonb limit 1`, [JSON.stringify([q.proposed])]);
    return rows.length > 0;
  }
  throw new Error('A read is one of: get, items, related, trail, scope, parts_of, around, placed, events, pictures, blocked, writers, facts, said, runs, held, confirm, packs, view, type_info, with_field, me, proposed, ids, links, history, tops, within, blocks, holds, region, kinds, instructions, view_lives, in_projects, mentioned, marked, owner, link, log_head, memory, islands_off, public_views, public_view_at, public_document, published_row, shared, picture, counts, corrections, run_of, runs_lately, runs_made, run_rows, run_works, run_links, run_tasks, run_signs, run_open, run_names, run_events, events_in, worked_on, part_around, run_items, hubs_among, places_of, search_map, steps_near, settling.');
}
