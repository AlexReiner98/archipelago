// The table the compacted streams (src/streams.ts) are kept in, made by step 21 of the schema (src/migrate.ts). Kept
// apart from the streams' code so the schema imports nothing that opens a database.

/** Step 21: the compacted streams' entries, append-only but for the compaction role. */
export const OPLOG = `
create table if not exists log_op (
  stream text not null,
  pos    bigint not null,
  at     timestamptz not null,
  head   jsonb not null,
  facts  jsonb not null,
  primary key (stream, pos)
);
create index if not exists log_op_at on log_op (stream, at);
do $$ begin create role pelago_compactor nologin; exception when duplicate_object then null; end $$;
create or replace function pelago_log_op_compacted() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'DELETE' and current_user = 'pelago_compactor' then return old; end if;
  raise exception 'The log is append-only: % on % is refused but to compaction', tg_op, tg_table_name;
end $fn$;
drop trigger if exists log_op_append_only on log_op;
create trigger log_op_append_only before update or delete on log_op for each row execute function pelago_log_op_compacted();
drop trigger if exists log_op_no_truncate on log_op;
create trigger log_op_no_truncate before truncate on log_op for each statement execute function pelago_log_append_only();
revoke update, delete, truncate on log_op from public;
grant select, insert on log_op to pelago_member;
grant select, delete on log_op to pelago_compactor;
`;

/** On a Postgres server: the app's user may become the compaction role, and what is transient is not written ahead. */
export const OPLOG_SERVER = `
do $$ begin
  if not (select rolsuper from pg_roles where rolname = current_user) then execute format('grant pelago_compactor to %I', current_user); end if;
end $$;
alter table transient set unlogged;
`;

/**
 * Step 26: the streams keep the fact stream's guarantees. A member reads an entry only when they may see every item
 * and link it names, and finds the next position through a function that sees them all. The compaction role reads
 * everything, and besides dropping entries may do the one thing a forget asks of it: put a sealed value, or a sealed
 * reason, as its digest (src/forget.ts), computed here so that nothing else can take its place.
 */
export const OPLOG_GUARDED = `
create or replace function pelago_op_digested(was jsonb, now jsonb) returns boolean language sql immutable as $fn$
  select jsonb_array_length(was) = jsonb_array_length(now) and coalesce(bool_and(coalesce(n.f = o.f
    or (jsonb_array_length(o.f) > 3 and (n.f - 3) = (o.f - 3) and n.f->3 = pelago_digest(o.f->3)), false)), true)
  from jsonb_array_elements(was) with ordinality o(f, i) join jsonb_array_elements(now) with ordinality n(f, i) using (i)
$fn$;
create or replace function pelago_log_op_compacted() returns trigger language plpgsql as $fn$
begin
  if current_user = 'pelago_compactor' then
    if tg_op = 'DELETE' then return old; end if;
    if (new.stream, new.pos, new.at) = (old.stream, old.pos, old.at) and pelago_op_digested(old.facts, new.facts)
       and (new.head - 'reason') = (old.head - 'reason')
       and (new.head->'reason' is not distinct from old.head->'reason' or new.head->'reason' = pelago_digest(old.head->'reason')) then return new; end if;
  end if;
  raise exception 'The log is append-only: % on % is refused but to compaction', tg_op, tg_table_name;
end $fn$;
grant update on log_op to pelago_compactor;
create or replace function pelago_op_seen(facts jsonb) returns boolean language sql stable as $fn$
  select not exists (select 1 from jsonb_array_elements(facts) f
    where (left(f->>1, 2) = 'e_' and not exists (select 1 from entity where id = f->>1))
       or (left(f->>1, 2) = 'r_' and not exists (select 1 from relation where id = f->>1)))
$fn$;
create or replace function pelago_log_op_last(s text) returns table (pos bigint, at timestamptz) language sql stable security definer set search_path = public as $fn$
  select pos, at from log_op where stream = s order by pos desc limit 1
$fn$;
revoke execute on function pelago_log_op_last(text) from public;
grant execute on function pelago_log_op_last(text) to pelago_member;
alter table log_op enable row level security;
drop policy if exists member_log_op on log_op;
create policy member_log_op on log_op for select to pelago_member using (pelago_op_seen(facts));
drop policy if exists member_log_op_add on log_op;
create policy member_log_op_add on log_op for insert to pelago_member with check (true);
drop policy if exists compactor_log_op on log_op;
create policy compactor_log_op on log_op for all to pelago_compactor using (true) with check (true);
`;
