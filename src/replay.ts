// The projector: the log read into the tables every page reads (docs/log.md, section 7). Each fact sets one column
// or one declared field of an item or a link, the times come from the entry, and a held change's record and the
// entry that decides it make its row of the review queue. The write path plans a change into facts and projects
// them as it goes, in the append's transaction, so a page never sees the log ahead of its projections; a rebuild
// projects a whole stream into empty tables the same way (`rebuild`), and the two must agree row for row.

import type { Entry, Fact } from './log.ts';
import type { Registry } from './packs.ts';
import type { Q } from './db.ts';
import { ITEM_COLUMNS } from './facts.ts';

type Props = Record<string, unknown>;

/** Whether an id is a link's (r_…), whose `link` field is its ends; an item's id is e_…. */
export const isLink = (id: string) => id.startsWith('r_');

/** Entries the system writes when a pack moves a type or its kind: the items did not change, so their time does not move. */
export const MOVED = ['type.moved', 'kind.moved'];

const COLUMN = new Map(ITEM_COLUMNS.map(([column, field, unsaid]) => [field, { column, unsaid }]));
/** What the log says of an item beside its columns: they move its time only. */
const ABOUT = ['checked', 'merged_into', 'forgotten'];
/** A forgotten item's rows leave today's tables, its links with them, and what named it as owner or source names nothing. */
export const FORGET_ROWS = [`update entity set owner = null where owner = $1`, `update entity set source_id = null where source_id = $1`, `update relation set source_id = null where source_id = $1`,
  `delete from relation where from_id = $1 or to_id = $1`, `delete from entity where id = $1`];
const LINK_COLUMNS: Record<string, [column: string, unsaid: unknown]> = { confidence: ['confidence', 1], source: ['source_id', null] };

/** A declared field said or cleared: what is set, and what is taken away. */
function fold(props: Props, unset: Set<string>, f: Fact) {
  if (f[0] === '+') {
    props[f[2]] = f[3];
    unset.delete(f[2]);
  } else {
    delete props[f[2]];
    unset.add(f[2]);
  }
}

/** Runs of facts on one id, in the order they were said. */
function runs(facts: Fact[]): Fact[][] {
  const out: Fact[][] = [];
  for (const f of facts) {
    const last = out.at(-1);
    if (last && last[0][1] === f[1]) last.push(f);
    else out.push([f]);
  }
  return out;
}

/** One run of facts on an item, folded into the columns and fields it sets. */
async function item(tx: Q, reg: Registry, at: string, moved: boolean, id: string, run: Fact[]) {
  const { rows } = await tx.query<{ type: string; status: string }>(`select type, status from entity where id = $1`, [id]);
  const was = rows[0];
  if (!was && !run.some((f) => f[0] === '+' && f[2] === 'type')) return; // a type's definition, or another record: not an item
  if (run.some((f) => f[0] === '+' && f[2] === 'forgotten')) {
    for (const sql of FORGET_ROWS) await tx.query(sql, [id]);
    return;
  }
  const set: Props = {};
  const props: Props = {};
  const unset = new Set<string>();
  let archived: boolean | undefined;
  for (const f of run) {
    const [op, , field] = f;
    const head = COLUMN.get(field);
    if (head) set[head.column] = op === '+' ? f[3] : (head.unsaid ?? null);
    else if (field === 'archived') archived = op === '+';
    else if (ABOUT.includes(field)) continue;
    else fold(props, unset, f);
  }
  const type = (set.type ?? was?.type) as string;
  const isOpen = reg.isOpen(type, (set.status ?? was?.status) as string);
  // What kind it is comes with its type, as whether it is open does with its status.
  if (set.type !== undefined) set.kind = reg.type(type)?.kind ?? null;
  if (!was) {
    const row: Props = { ...Object.fromEntries(ITEM_COLUMNS.map(([column, , unsaid]) => [column, unsaid ?? null])), ...set };
    await tx.query(
      `insert into entity (id, type, kind, title, body, status, visibility, private_to, owner, confidence, source_id, is_open, props, created_at, updated_at, archived_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $14, $15)`,
      [id, row.type, row.kind, row.title, row.body, row.status, row.visibility, row.private_to, row.owner, row.confidence, row.source_id, isOpen, JSON.stringify(props), at, archived ? at : null],
    );
    return;
  }
  const params: unknown[] = [id, at, isOpen, JSON.stringify(props), [...unset], moved];
  const cols = Object.entries(set).map(([column, value]) => `${column} = $${params.push(value)}`);
  if (archived !== undefined) cols.push(`archived_at = ${archived ? '$2' : 'null'}`);
  await tx.query(
    `update entity set ${[...cols, ''].join(', ')}is_open = $3, props = (props || $4::jsonb) - $5::text[], updated_at = case when $6 then updated_at else $2 end where id = $1`,
    params,
  );
}

/** One run of facts on a link: made with its ends, moved, ended, or one of its fields set. */
async function link(tx: Q, at: string, id: string, run: Fact[]) {
  const { rows } = await tx.query<{ id: string }>(`select id from relation where id = $1`, [id]);
  let made = !rows.length ? undefined : false;
  const set: Props = {};
  const props: Props = {};
  const unset = new Set<string>();
  for (const f of run) {
    const [op, , field] = f;
    if (field === 'link') {
      if (op === '-') set.valid_to = at;
      else {
        // A link said again with other ends has moved (a merge) or been retyped; it is not made again, nor brought back.
        const [type, from, to] = f[3] as [string, string, string];
        Object.assign(set, { type, from_id: from, to_id: to });
        if (made === undefined) made = true;
      }
    } else if (LINK_COLUMNS[field]) set[LINK_COLUMNS[field][0]] = op === '+' ? f[3] : LINK_COLUMNS[field][1];
    else fold(props, unset, f);
  }
  if (made === undefined) return; // nothing said of it is a link
  if (made) {
    const row: Props = { confidence: 1, source_id: null, valid_to: null, ...set };
    await tx.query(
      `insert into relation (id, type, from_id, to_id, props, confidence, source_id, valid_from, valid_to) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
      [id, row.type, row.from_id, row.to_id, JSON.stringify(props), row.confidence, row.source_id, at, row.valid_to],
    );
    return;
  }
  const params: unknown[] = [id, JSON.stringify(props), [...unset]];
  const cols = Object.entries(set).map(([column, value]) => `${column} = $${params.push(value)}`);
  await tx.query(`update relation set ${[...cols, ''].join(', ')}props = (props || $2::jsonb) - $3::text[] where id = $1`, params);
}

/**
 * Facts said at a moment, projected into entity and relation in order. moved: a pack moved a type or a kind, and
 * the items' time stays. The write path calls it op by op, so each op reads what the ones before it did.
 */
export async function projectFacts(tx: Q, reg: Registry, at: string, facts: Fact[], moved = false): Promise<void> {
  for (const run of runs(facts)) {
    const id = run[0][1];
    // A link's id says it is one: an item may have a field called link of its own.
    if (isLink(id)) await link(tx, at, id, run);
    else await item(tx, reg, at, moved, id, run);
  }
}

/** The review queue: a held change's record makes its row, and the entry that decides it says what became of it. */
export async function projectDecision(tx: Q, e: Entry): Promise<void> {
  if (e.stream === 'pending') {
    await tx.query(
      `insert into proposal (id, ts, actor, reason, source, ops, warnings, private_to, held_by) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb)`,
      [e.id, e.at, e.actor.id, e.reason, JSON.stringify(e.source ?? null), JSON.stringify(e.ops ?? []), JSON.stringify(e.warnings ?? []), (e.private_to as string | null) ?? null, JSON.stringify(e.held_by ?? null)],
    );
    return;
  }
  const rule = e.rule as { outcome: string; proposal?: string; by?: string; note?: string } | undefined;
  if (!rule?.proposal) return;
  const status = rule.outcome;
  const note = status === 'rejected' ? e.reason : status === 'superseded' ? `Already so since ${rule.by}` : (rule.note ?? null);
  await tx.query(`update proposal set status = $2, decided_by = $3, decided_at = $4, note = $5 where id = $1`, [rule.proposal, status, status === 'superseded' ? 'agent:pelago' : rule.by, e.at, note]);
}

/** One entry of any stream, projected: its facts, then what it says of the review queue. */
export async function projectEntry(tx: Q, reg: Registry, e: Entry): Promise<void> {
  if (e.stream === 'facts') await projectFacts(tx, reg, e.at, e.facts, MOVED.includes(e.action as string));
  await projectDecision(tx, e);
}

/** The tables the log projects into, and the order a rebuild empties and fills them in. */
export const PROJECTED = ['proposal', 'relation', 'entity'];

/**
 * Every projection made again from the log: the tables emptied, then each entry of both streams projected in the
 * order it was appended. Run on a copy of the log (the test does) or, later, in the background with a snapshot.
 */
export async function rebuild(tx: Q, reg: Registry, all: Entry[]): Promise<void> {
  for (const table of PROJECTED) await tx.query(`delete from ${table}`);
  const order = (e: Entry) => [Date.parse(e.at), e.stream === 'pending' ? 0 : 1, e.pos];
  const sorted = [...all].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  for (const e of sorted) await projectEntry(tx, reg, e);
}

/**
 * What the log does not hold yet, laid back on items a rebuild made elsewhere (a move, src/move.ts): the operational
 * fields kept on them (KEPT_FIELDS in src/operational.ts), as they were.
 */
export async function keepFields(tx: Q, kept: { id: string; kept: Record<string, unknown> }[]): Promise<void> {
  for (const r of kept) await tx.query(`update entity set props = props || $2::jsonb where id = $1`, [r.id, JSON.stringify(r.kept)]);
}

/**
 * Take the fact stream's lock and say the time its next entry will have, as append will (the transaction's time,
 * never before the last entry's). The write path projects with it before it appends, so it holds the lock from the
 * start: nothing can be appended in between.
 */
export async function stamp(tx: Q): Promise<string> {
  await tx.query(`select pg_advisory_xact_lock(hashtext('pelago.log'), hashtext('facts'))`);
  const { rows } = await tx.query<{ now: Date; at: Date | null }>(`select date_trunc('milliseconds', now()) as now, (select at from log_entry where stream = 'facts' order by pos desc limit 1) as at`);
  return new Date(Math.max(new Date(rows[0].now).getTime(), rows[0].at ? new Date(rows[0].at).getTime() : 0)).toISOString();
}
