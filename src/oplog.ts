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
