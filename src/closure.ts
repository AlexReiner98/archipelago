// What is inside what, all the way down: a projection of the part_of links (docs/log.md, section 7), so a subtree is
// one lookup by index and not a walk of the map. Each row says an ancestor holds a descendant, at any depth, along open
// links of the part_of family; a loop of belonging holds each of its members once. The projector keeps it in the
// append's transaction (src/replay.ts): a link made adds the pairs it joins, and one ended, moved or retyped has the
// ancestors of everything below it found again. A row says nothing of visibility: every read joins it to entity,
// whose row-level security keeps what the reader may not see out. The migration fills it from part_of itself, which no
// pack extends today; a rebuild (regatherAll) reads the whole family as the registry has it.

import type { Q } from './db.ts';

/** Every pair a set of items' ancestors make, walked up the open part_of links of a family. */
const UP = (from: string, fam: string) => `with recursive up(d, a) as (
    select r.from_id, r.to_id from relation r where ${from} and r.valid_to is null and r.type = any(${fam})
    union
    select up.d, r.to_id from up join relation r on r.from_id = up.a where r.valid_to is null and r.type = any(${fam})
  ) select a, d from up where a <> d`;

/** The pairs a part_of link from `f` to `t` joins: each thing at or above `t` holds each at or below `f`. */
const JOIN = (f: string, t: string) => `insert into part_closure (ancestor, descendant)
  select a.id, d.id from (select ${t} as id union select ancestor from part_closure where descendant = ${t}) a,
                         (select ${f} as id union select descendant from part_closure where ancestor = ${f}) d
   where a.id <> d.id
  on conflict do nothing`;

// The projector writes as the one who made the change, under row-level security, and a closure must hold the links
// nobody but their author sees as well: the two writes are functions that read every link, and do nothing else.
export const CLOSURE = `
create table if not exists part_closure (ancestor text not null, descendant text not null, primary key (ancestor, descendant));
create index if not exists part_closure_descendant on part_closure (descendant);
grant select on part_closure to pelago_member;
create or replace function pelago_part_joined(f text, t text) returns void
language sql security definer set search_path = public as $fn$
  ${JOIN('f', 't')};
$fn$;
create or replace function pelago_part_regather(f text[], fam text[]) returns void
language plpgsql security definer set search_path = public as $fn$
declare below text[];
begin
  select array_agg(id) into below from (select unnest(f) as id union select descendant from part_closure where ancestor = any(f)) b;
  delete from part_closure where descendant = any(below);
  insert into part_closure (ancestor, descendant) ${UP('r.from_id = any(below)', 'fam')} on conflict do nothing;
end $fn$;
grant execute on function pelago_part_joined(text, text) to pelago_member;
grant execute on function pelago_part_regather(text[], text[]) to pelago_member;
insert into part_closure (ancestor, descendant) ${UP('true', "array['part_of']")} on conflict do nothing;
`;

/**
 * Transactions that project into tables of their own, named first on the search path (a rebuild's shadow, an as-of
 * read's or a backup's temporary tables, src/rebuild.ts): they run as the owner, and the closure and mentions they
 * keep are those tables'. The functions above name public on their path, which reaches past the shadow to the live
 * tables, so these write directly.
 */
const apart = new WeakSet<Q>();
export const projectsApart = (tx: Q) => void apart.add(tx);
export const isApart = (tx: Q) => apart.has(tx);

/** A part_of link from `from` to `to` was made: each thing at or above `to` now holds each at or below `from`. */
export async function joined(tx: Q, from: string, to: string): Promise<void> {
  if (from === to) return;
  await tx.query(apart.has(tx) ? JOIN('$1::text', '$2::text') : `select pelago_part_joined($1, $2)`, [from, to]);
}

/**
 * A part_of link from one of these was ended, moved or retyped: what is at or below each has its ancestors found again
 * from the links that are open now, step by step up.
 */
export async function regather(tx: Q, from: string[], family: string[]): Promise<void> {
  if (!apart.has(tx)) return void (await tx.query(`select pelago_part_regather($1::text[], $2::text[])`, [from, family]));
  const { rows } = await tx.query<{ below: string[] }>(
    `select array_agg(id) as below from (select unnest($1::text[]) as id union select descendant from part_closure where ancestor = any($1::text[])) b`,
    [from],
  );
  await tx.query(`delete from part_closure where descendant = any($1::text[])`, [rows[0].below]);
  await tx.query(`insert into part_closure (ancestor, descendant) ${UP('r.from_id = any($1::text[])', '$2::text[]')} on conflict do nothing`, [rows[0].below, family]);
}

/** The whole projection made again from the open links, as the owner: after a restore. */
export async function regatherAll(tx: Q, family: string[]): Promise<void> {
  await tx.query(`delete from part_closure`);
  await tx.query(`insert into part_closure (ancestor, descendant) ${UP('true', '$1::text[]')} on conflict do nothing`, [family]);
}
