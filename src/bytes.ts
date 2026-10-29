// What each item adds to the log, in bytes: so a workspace on a plan can see what its storage is made of (the usage
// view, src/usage.ts). Each append adds a row for each item or link its facts are about, the length of those facts'
// JSON as they are stored (sealed, compressed): rows only ever inserted, so writers at once never wait on each other.
// They are folded into the counts by item and by type (links as one, the packs' manifests as one) before the counts
// are read, under one lock. A count, not a record: made again whole from the log after a restore (recountBytes), and a
// forget leaves the bytes its item had added (the log keeps a fact for each change, its words gone).

import type { Q } from './db.ts';

/** A fact as the log stores it, as JSON: what each is counted by, in an append and in a count made again. */
const STORED = `case when f.op = '-' then jsonb_build_array(f.op, f.id, f.field) when f.meta is null then jsonb_build_array(f.op, f.id, f.field, f.value) else jsonb_build_array(f.op, f.id, f.field, f.value, f.meta) end`;
/** What an id's bytes are summed under: its item's type, every link as one, the packs' manifests as one. */
const TYPE_OF = `coalesce(e.type, case when s.id like 'r\\_%' then 'links' when s.id like 'pack:%' then 'packs' end, 'other')`;

/** Schema step 28: what appends add, the counts it is folded into, the functions that add and fold, and the counts of the log there is. */
export const ITEM_BYTES = `
create table if not exists bytes_added (id text not null, type text not null, bytes bigint not null);
create table if not exists item_bytes (id text primary key, type text not null, bytes bigint not null);
create index if not exists item_bytes_largest on item_bytes (bytes desc);
create table if not exists type_bytes (type text primary key, bytes bigint not null);
grant select on item_bytes, type_bytes to pelago_member;
create or replace function pelago_bytes_add(facts jsonb) returns void
language sql security definer set search_path = public as $fn$
  insert into bytes_added (id, type, bytes)
  select s.id, ${TYPE_OF}, s.n from (select x->>1 as id, sum(octet_length(x::text))::bigint as n from jsonb_array_elements(facts) x group by 1) s
  left join entity e on e.id = s.id;
$fn$;
create or replace function pelago_bytes_fold() returns void
language plpgsql security definer set search_path = public as $fn$
begin
  perform pg_advisory_xact_lock(hashtext('pelago.bytes'));
  with d as (delete from bytes_added returning id, type, bytes),
  i as (insert into item_bytes (id, type, bytes) select id, max(type), sum(bytes) from d group by id
        on conflict (id) do update set bytes = item_bytes.bytes + excluded.bytes, type = excluded.type)
  insert into type_bytes (type, bytes) select type, sum(bytes) from d group by type
  on conflict (type) do update set bytes = type_bytes.bytes + excluded.bytes;
end $fn$;
grant execute on function pelago_bytes_add(jsonb), pelago_bytes_fold() to pelago_member;
${RECOUNT()}
`;

function RECOUNT() {
  return `
select pg_advisory_xact_lock(hashtext('pelago.bytes'));
delete from bytes_added;
delete from item_bytes;
delete from type_bytes;
insert into item_bytes (id, type, bytes)
  select s.id, ${TYPE_OF}, s.n from (select f.id, sum(octet_length((${STORED})::text))::bigint as n from log_fact f group by f.id) s left join entity e on e.id = s.id;
insert into type_bytes (type, bytes) select type, sum(bytes) from item_bytes group by type;`;
}

/** Add an append's stored facts to what is to be counted. */
export async function countBytes(tx: Q, facts: unknown[]): Promise<void> {
  if (facts.length) await tx.query(`select pelago_bytes_add($1::jsonb)`, [JSON.stringify(facts)]);
}

/** What appends have added, folded into the counts: before they are read. */
export async function foldBytes(db: Q): Promise<void> {
  await db.query(`select pelago_bytes_fold()`);
}

/** The counts made again whole from the log, as the owner: after a restore. */
export async function recountBytes(tx: Q): Promise<void> {
  for (const sql of RECOUNT().split(';').map((s) => s.trim()).filter(Boolean)) await tx.query(sql);
}

/** The items (not links or packs) that have added most to the log, largest first. */
export async function largestItems(db: Q, limit: number): Promise<{ id: string; type: string; bytes: number }[]> {
  await foldBytes(db);
  const { rows } = await db.query<{ id: string; type: string; bytes: string }>(`select id, type, bytes from item_bytes where id like 'e\\_%' order by bytes desc limit $1 -- index item_bytes_largest`, [limit]);
  return rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
}

/** What the log holds of each type of item (links as one), largest first: one row a type. */
export async function bytesByType(db: Q): Promise<{ type: string; bytes: number }[]> {
  await foldBytes(db);
  const { rows } = await db.query<{ type: string; bytes: string }>(`select type, bytes from type_bytes order by bytes desc`);
  return rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
}
