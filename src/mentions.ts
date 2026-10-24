// What names an item in its text or fields: a projection kept as items are written (src/replay.ts), so an item's
// page reads what mentions it by an index and not by searching every note on the map. A row says one item's note or
// fields hold another's id; every read joins it to entity, whose row-level security keeps out what may not be seen.

import type { Q } from './db.ts';
import { isApart } from './closure.ts';

/** An item's id as it is written in a note: e_ and eight letters or digits (src/db.ts newId). */
const ID = `'[[:<:]](e_[a-z0-9]{8})[[:>:]]'`;
const FROM = (where: string) => `insert into mention (from_id, to_id)
  select distinct e.id, m[1] from entity e, regexp_matches(coalesce(e.body, '') || ' ' || e.props::text, ${ID}, 'g') m where ${where} and m[1] <> e.id
  on conflict do nothing`;

// Written as the one who made the change, it is a function that reads that one item whole and does nothing else.
export const MENTIONS = `
create table if not exists mention (from_id text not null, to_id text not null, primary key (to_id, from_id));
create index if not exists mention_from on mention (from_id);
grant select on mention to pelago_member;
create or replace function pelago_mentioned(i text) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  delete from mention where from_id = i;
  ${FROM('e.id = i')};
end $fn$;
grant execute on function pelago_mentioned(text) to pelago_member;
${FROM('true')};
`;

/** An item's note or fields were written: what it names is read again from them. */
export async function mentioned(tx: Q, id: string): Promise<void> {
  if (!isApart(tx)) return void (await tx.query(`select pelago_mentioned($1)`, [id]));
  // Projected into tables of its own (src/closure.ts): those are the ones written.
  await tx.query(`delete from mention where from_id = $1`, [id]);
  await tx.query(FROM('e.id = $1'), [id]);
}

/** Made again whole, after a restore. */
export async function mentionedAll(tx: Q): Promise<void> {
  await tx.query(`delete from mention`);
  await tx.query(FROM('true'));
}
