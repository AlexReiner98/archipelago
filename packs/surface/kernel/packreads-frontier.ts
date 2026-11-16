// The frontier and attention, each read in one statement (task e_k25mjqq3). The default canvas finds what the
// frontier finds, and the frontier weighs what attention weighs: asked a read at a time, that was some twenty-five
// statements for every canvas read, each its own round trip. Here the reads they ask are the same statements, each
// the read's own SQL bound into one (`bind`): what each read answers alone comes back as one JSON value, its rows in
// the order the read gives them, under the asker's row-level security as every read is. What is weighed stays the
// packs': attention (packs/attention) and the runs pack's frontier take these answers in place of their reads.

import type { Archipelago } from '../../write/kernel/pelago.ts';
import { openSaidWith } from '../../seal/kernel/seal.ts';
import { KEYS_OF, type Wrapped } from '../../seal/kernel/vault.ts';
import { shapes } from './packreads-rows.ts';
import { blockingLinks, EDGES, graphOf, HELD, HOLDS, REACH, type Edge as BlockEdge } from './blocking.ts';
import { boundsOf, DUE, HISTORY, LAST_SAID, TOPS, UNDER } from './packreads-kernel.ts';
import { CONFIRMED_UPTO, SETTLED_SINCE, settledFrom, settlingTypes, touchedSets, type SettledRow } from './packreads-log.ts';
import { CORRECTIONS } from './packreads-service.ts';
import { CHANGED_BY, HUBS_AMONG, PART_AROUND, RUN_ITEMS, SET_ON } from './packreads-runs.ts';

export type FrontierRead = {
  /** What attention reads of some open items, at once: the items, what they wait on, what blocks them and what it is, who holds what, what is due, the sessions on them, what they read that moved, what agents settled, and what each is part of at the top. */
  attention_state?: AttentionAsk & { among: string[] };
  /** What the frontier reads of some sessions, at once: what they worked on and one step along part_of, those items, who corrected them, which are hubs, and what attention reads of the open ones. */
  frontier_state?: AttentionAsk & { runs: string[]; since: string };
};

/** What attention asks of what it reads: days ahead that count as due. */
type AttentionAsk = { days?: number };

/** The readings that move: link types that cross (and their flavours), to types that promise fields, and those fields (packs/attention/kernel/moved.ts). */
const readings = (l: Archipelago) => {
  const reg = l.registry;
  const promised = reg.having('promised');
  return { kinds: reg.relationFamily(...[...reg.relations.values()].filter((r) => r.crosses).map((r) => r.id)), promised, fields: [...new Set(promised.flatMap((t) => reg.type(t)?.capabilities.promised?.fields ?? []))] };
};

/** The parameters of one statement, each named as $n where it is used. */
const params = () => {
  const values: unknown[] = [];
  return { values, add: (v: unknown) => (values.push(v), `$${values.length}`) };
};
type Params = ReturnType<typeof params>;

/** A read's statement with each of its parameters ($1, $2 …) said as given: a parameter of the whole, or a set of it. */
export function bind(sql: string, ...as: string[]): string {
  return sql.replace(/\$(\d+)/g, (_, n: string) => {
    const a = as[Number(n) - 1];
    if (a === undefined) throw new Error(`bind: no value for $${n}`);
    return a;
  });
}

/** A statement's rows as one JSON value, in its order. On lines of their own: a read may end in a comment. */
const rows = (sql: string) => `coalesce((select json_agg(t) from (\n${sql}\n) t), '[]'::json)`;
/** The ids of a part of the statement, as a read takes some ids. */
const ids = (cte: string, col = 'id') => `array(select ${col} from ${cte})`;

/** The types the system keeps: nobody's work. */
const systemTypes = (l: Archipelago) => [...l.registry.types.values()].filter((t) => t.system === true).map((t) => t.id);

/** A link as the read links gives it, of those the conditions say. */
const linksWhere = (l: Archipelago, where: string) => {
  const open = l.props === 'props';
  return `select ${open ? 'r.id' : 'null as id'}, r.type, r.from_id, r.to_id, ${open ? 'r.props' : `'{}'::jsonb as props`}, r.valid_from from relation r where r.valid_to is null and ${where}`;
};

/** The times a JSON answer says as text, as the reads give them: as moments. */
const TIMES = new Set(['created_at', 'updated_at', 'archived_at', 'valid_from', 'at', 'ts', 'since']);
const revived = <T>(list: T[]): T[] => {
  for (const r of list as Record<string, unknown>[]) for (const k of Object.keys(r)) if (TIMES.has(k) && typeof r[k] === 'string') r[k] = new Date(r[k] as string);
  return list;
};

/** What attention reads of the items `among` names (a set of the statement), as parts of the statement and of its answer. */
function attentionParts(l: Archipelago, p: Params, among: string, ask: AttentionAsk) {
  const { cols } = shapes(l);
  const { families, needs } = blockingLinks(l);
  const bounds = boundsOf(l);
  const live = ids('att_live');
  const reached = ids('att_reach');
  const logged = l.props === 'props';
  const read = readings(l);
  const moved = logged && read.kinds.length && read.promised.length ? read : undefined; // the log is read by those logged in alone
  const ctes = [
    // The owner, as the setting says: one merged into another is that other (Archipelago.setting).
    `att_owner(id, hop) as (select value #>> '{}', 0 from setting where key = 'me' and jsonb_typeof(value) = 'string'
       union all select (select f.value #>> '{}' from log_fact f join entity e on e.id = f.id and e.archived_at is not null
         where f.stream = 'facts' and f.id = o.id and f.field = 'merged_into' order by f.pos desc limit 1 -- index log_fact_history
       ), o.hop + 1 from att_owner o where o.hop < 5 and o.id is not null)`,
    `att_rows as (select ${cols('entity')}, entity.confidence from entity where id = any(${among}))`,
    `att_live as (select id from att_rows where is_open and archived_at is null and not (type = any(${p.add(systemTypes(l))}::text[])))`,
    `att_waits as (\n${linksWhere(l, `r.from_id = any(${live}) and r.type = any(${p.add(l.registry.relationFamily('waits_on'))}::text[])`)}\n)`,
    `att_reach as (\n${bind(REACH, live, p.add(families.flat()))}\n)`,
    `att_edges as (\n${bind(EDGES(' and r.from_id = any($4::text[])'), p.add(families[0]), p.add(families[1]), p.add(families[2]), reached)}\n)`,
    `att_held as (\n${bind(HELD(' and n.from_id = any($2::text[])'), p.add(needs), reached)}\n)`,
    `att_works as (\n${linksWhere(l, `r.to_id = any(${live}) and r.type = 'works_on'`)}\n)`,
    ...(moved
      ? [
          `att_reading as (\n${linksWhere(l, `r.from_id = any(${live}) and r.type = any(${p.add(moved.kinds)}::text[])`)}\n)`,
          `att_last as (\n${bind(LAST_SAID, `array(select from_id from att_reading union select id from att_reading)`)}\n)`,
          `att_facts as (\n${bind(HISTORY, ids('att_reading', 'to_id'), p.add(moved.fields))}\n)`,
        ]
      : []),
    ...(logged ? [`att_upto as (\n${CONFIRMED_UPTO}\n)`, `att_settled as (\n${bind(SETTLED_SINCE, `coalesce((select upto from att_upto), 0)`, p.add(settlingTypes(l)))}\n)`] : []),
  ];
  const settled = logged ? ' union select id from att_settled' : '';
  // Each item some part names, as the read ids gives it: whom a link waits on, what blocks, the sessions, what is read, what was settled.
  const named = `select to_id as id from att_waits union select y from att_edges union select y from att_held union select from_id from att_works${moved ? ' union select to_id from att_reading' : ''}${settled}`;
  const fields = [
    `'owner', coalesce((select to_jsonb(id) from att_owner where id is not null order by hop desc limit 1), (select value from setting where key = 'me'))`,
    `'rows', ${rows('select * from att_rows')}`,
    `'named', ${rows(`select ${cols('entity')}, entity.confidence from entity where id = any(array(${named}))`)}`,
    `'waits', ${rows('select * from att_waits')}`,
    `'edges', ${rows('select * from att_edges')}`,
    `'held', ${rows('select * from att_held')}`,
    `'holds', ${rows(HOLDS)}`,
    `'due', ${rows(bind(DUE, p.add(ask.days ?? 7), p.add(bounds.due), live))}`,
    // numeric is a string as the drivers give it (packs/database/kernel/pg.ts): as text, not a JSON number.
    `'under', ${rows(`select u.id, u.type, u.title, u.status, u.owner, u.value::text as value, u.limit::text as "limit" from (\n${bind(UNDER, p.add(bounds.under), live)}\n) u`)}`,
    `'works', ${rows('select * from att_works')}`,
    ...(moved ? [`'reading', ${rows('select * from att_reading')}`, `'last', ${rows('select * from att_last')}`, `'facts', ${rows('select * from att_facts')}`] : []),
    ...(logged ? [`'upto', (select upto from att_upto)`, `'settled', ${rows('select * from att_settled')}`] : []),
    `'tops', ${rows(bind(TOPS, `array(select id from att_live${settled})`))}`,
    // The vault's keys of what may hold sealed words: what was read said, and the change sets that settled. Opened only where a value is sealed.
    ...(moved || logged ? [`'keys', ${rows(bind(KEYS_OF, `array(${[...(moved ? ['select id from att_facts'] : []), ...(logged ? ['select changeset from att_settled'] : [])].join(' union ')})`))}`] : []),
  ];
  return { ctes, fields, moved: Boolean(moved), logged };
}

/** One statement of parts and the JSON object of their answers, run as the asker. */
async function once(l: Archipelago, p: Params, ctes: string[], fields: string[]): Promise<Record<string, unknown>> {
  const sql = `with recursive ${ctes.join(',\n')}\nselect json_build_object(${fields.join(',\n')}) as state`;
  const { rows: [row] } = await l.db.query<{ state: Record<string, unknown> | string }>(sql, p.values);
  return typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
}

/** Attention's answers from the statement's: each read's as it gives it alone, the sealed words opened. */
async function attentionAnswers(l: Archipelago, got: Record<string, unknown>, parts: { moved: boolean; logged: boolean }) {
  const { typed } = shapes(l);
  const list = <T>(k: string) => revived((got[k] ?? []) as T[]);
  type Edge = BlockEdge;
  const graph = graphOf(l, list<Edge>('edges'), list<Edge & { type: string; props: Record<string, unknown>; held: number }>('held'));
  // bytea comes as JSON text, \x and its hex.
  const keys = list<Omit<Wrapped, 'wrapped'> & { wrapped: string }>('keys').map((k) => ({ ...k, wrapped: Buffer.from(k.wrapped.slice(2), 'hex') }));
  const open = <T extends { id: string; field: string; value: unknown }>(said: T[]) => openSaidWith(l.db, said, keys);
  const facts = parts.moved ? await open(list<{ id: string; field: string; value: unknown; op: string; pos: number; at: Date }>('facts')) : [];
  const confirm = parts.logged ? await settledFrom(l, list<SettledRow>('settled'), (got.upto as number | null) ?? 0, 40, open) : null;
  return {
    owner: (got.owner as string | null) || null,
    rows: list<{ type: string }>('rows').map(typed),
    named: list<{ type: string }>('named').map(typed),
    waits: list('waits'),
    blocks: [...graph.direct.values()].flat(),
    holds: list('holds'),
    bounds: { due: list('due'), under: list('under') },
    works: list('works'),
    ...(parts.moved && { moved: { reading: list('reading'), last: list('last'), facts } }),
    confirm,
    tops: list('tops'),
  };
}

/** The answer to one of these reads, or undefined when the read is none of them. */
export async function frontierRead(l: Archipelago, q: FrontierRead): Promise<unknown> {
  if (q.attention_state !== undefined) {
    const among = q.attention_state.among;
    if (!Array.isArray(among) || among.some((id) => typeof id !== 'string')) throw new Error('attention_state.among is a list of ids');
    const p = params();
    const parts = attentionParts(l, p, p.add(among) + '::text[]', q.attention_state);
    return attentionAnswers(l, await once(l, p, parts.ctes, parts.fields), parts);
  }
  if (q.frontier_state !== undefined) {
    const { runs, since } = q.frontier_state;
    if (!Array.isArray(runs) || runs.some((id) => typeof id !== 'string')) throw new Error('frontier_state.runs is a list of ids');
    // What the sessions touched is the server's store, read past row-level security (touchedSets): read first, by itself.
    const touched = runs.length ? (await touchedSets(l, runs)).flat() : [];
    const p = params();
    const sys = p.add(systemTypes(l));
    const ran = runs.length ? p.add(runs) + '::text[]' : '';
    const worked = runs.length ? `select id from (\n${bind(CHANGED_BY, ran, p.add(new Date(since)))}\n) c union select id from (\n${bind(SET_ON, ran)}\n) o union select unnest(${p.add(touched)}::text[])` : `select null::text as id where false`;
    const ctes = [
      `f_worked as (${worked})`,
      `f_around as (\n${bind(PART_AROUND, ids('f_worked'))}\n)`,
      `f_scope as (select id from f_worked union select from_id from f_around union select to_id from f_around)`,
      `f_items as (\n${bind(RUN_ITEMS, ids('f_scope'))}\n)`,
      `f_mine as (select id, is_open from f_items where not (type = any(${sys}::text[])))`,
    ];
    const parts = attentionParts(l, p, `array(select id from f_mine where is_open)`, q.frontier_state);
    const got = await once(l, p, [...ctes, ...parts.ctes], [
      `'items', ${rows('select * from f_items')}`,
      `'corrections', ${rows(bind(CORRECTIONS, ids('f_mine')))}`,
      `'hubs', ${rows(bind(HUBS_AMONG, `array(select id from f_mine where is_open)`))}`,
      `'attention', json_build_object(${parts.fields.join(',\n')})`,
    ]);
    return {
      items: got.items,
      corrections: revived(got.corrections as { at: Date }[]),
      hubs: (got.hubs as { id: string }[]).map((r) => r.id),
      attention: await attentionAnswers(l, got.attention as Record<string, unknown>, parts),
    };
  }
  return undefined;
}
