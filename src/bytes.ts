// What each item adds to the log, in bytes: so a workspace on a plan can see what its storage is made of (the usage
// view, src/usage.ts). Counted in the append's transaction from the facts as they are stored (sealed, compressed),
// each fact the length of its JSON, by the item or link it is about; and summed by the type of that item, links as
// one. A count, not a record: made again whole from the log after a restore (recountBytes), and a forget leaves the
// bytes its item had added (the log keeps a fact for each change, its words gone).

import type { Q } from './db.ts';

/** A fact as the log stores it, as JSON: what each is counted by, in an append and in a count made again. */
const STORED = `case when f.op = '-' then jsonb_build_array(f.op, f.id, f.field) when f.meta is null then jsonb_build_array(f.op, f.id, f.field, f.value) else jsonb_build_array(f.op, f.id, f.field, f.value, f.meta) end`;
/** What an id's bytes are summed under: its item's type, every link as one. */
const TYPE_OF = `coalesce(e.type, case when s.id like 'r\\_%' then 'links' when s.id like 'pack:%' then 'packs' end, 'other')`;

/** Schema step 28: the counts, the function the append adds to them with, and the counts of the log there is. */
export const ITEM_BYTES = `
create table if not exists item_bytes (id text primary key, type text not null, bytes bigint not null);
create index if not exists item_bytes_largest on item_bytes (bytes desc);
create table if not exists type_bytes (type text primary key, bytes bigint not null);
grant select on item_bytes, type_bytes to pelago_member;
create or replace function pelago_bytes_add(facts jsonb) returns void
language sql security definer set search_path = public as $fn$
  with s as (select x->>1 as id, sum(octet_length(x::text))::bigint as n from jsonb_array_elements(facts) x group by 1),
  t as (select s.id, s.n, ${TYPE_OF} as type from s left join entity e on e.id = s.id),
  i as (insert into item_bytes (id, type, bytes) select id, type, n from t
        on conflict (id) do update set bytes = item_bytes.bytes + excluded.bytes, type = excluded.type)
  insert into type_bytes (type, bytes) select type, sum(n) from t group by type
  on conflict (type) do update set bytes = type_bytes.bytes + excluded.bytes;
$fn$;
grant execute on function pelago_bytes_add(jsonb) to pelago_member;
${RECOUNT()}
`;

function RECOUNT() {
  return `
delete from item_bytes;
delete from type_bytes;
insert into item_bytes (id, type, bytes)
  select s.id, ${TYPE_OF}, s.n from (select f.id, sum(octet_length((${STORED})::text))::bigint as n from log_fact f group by f.id) s left join entity e on e.id = s.id;
insert into type_bytes (type, bytes) select type, sum(bytes) from item_bytes group by type;`;
}

/** Add an append's stored facts to the counts. */
export async function countBytes(tx: Q, facts: unknown[]): Promise<void> {
  if (facts.length) await tx.query(`select pelago_bytes_add($1::jsonb)`, [JSON.stringify(facts)]);
}

/** The counts made again whole from the log, as the owner: after a restore. */
export async function recountBytes(tx: Q): Promise<void> {
  for (const sql of RECOUNT().split(';').map((s) => s.trim()).filter(Boolean)) await tx.query(sql);
}

/** The items (not links or packs) that have added most to the log, largest first. */
export async function largestItems(db: Q, limit: number): Promise<{ id: string; type: string; bytes: number }[]> {
  const { rows } = await db.query<{ id: string; type: string; bytes: string }>(`select id, type, bytes from item_bytes where id like 'e\_%' order by bytes desc limit $1 -- index item_bytes_largest`, [limit]);
  return rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
}

/** What the log holds of each type of item (links as one), largest first: one row a type. */
export async function bytesByType(db: Q): Promise<{ type: string; bytes: number }[]> {
  const { rows } = await db.query<{ type: string; bytes: string }>(`select type, bytes from type_bytes order by bytes desc`);
  return rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
}
