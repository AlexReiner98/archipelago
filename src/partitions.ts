// The log partitioned by time (docs/log.md, sections 4 and 7; task e_m6a2uw2f). log_entry, log_fact and log_op are
// each cut into one partition a year (UTC, `pelago_log_unit`), so old history costs nothing to keep and a read of a
// stretch of time touches only the partitions it names. A workspace is one database, so each has partitions of its own.
//
// The partition key is in every unique index, so the keys name `at`: what the old key (stream, pos) promised, that a
// position is taken once, a trigger now promises more strongly. An entry must be its stream's next position, name the
// last entry's hash and not be earlier than it, under the same lock append takes, whichever partition it lands in.
// Partitions are made ahead of need (at open, daily and by an append that finds its own missing), never by default: a
// row outside every partition is refused, and a default partition would stop the one it overlaps from being made.

import type { Q } from './db.ts';

/** The tables cut by time, and what their partitions are called: `log_entry_2026`. */
export const PARTITIONED = ['log_entry', 'log_fact', 'log_op'] as const;
/** How far ahead partitions are made: through the one that holds two months from now. */
export const AHEAD = `interval '2 months'`;

/**
 * Step 22. The three tables made again, partitioned, with what they held moved into them in order, and every index,
 * trigger and grant steps 18 to 21 gave them. The history index takes `at` before the position, so an as-of read walks
 * the partitions newest first and stops at the first that answers; BRIN indexes on `at` serve a stretch of time in one.
 */
export const PARTITION = `
create or replace function pelago_log_append_only() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'UPDATE' and current_setting('pelago.forgetting', true) = 'on' then
    if tg_argv[0] = 'fact' then
      if (new.stream, new.pos, new.n, new.op, new.id, new.field, new.at) = (old.stream, old.pos, old.n, old.op, old.id, old.field, old.at)
         and new.meta is not distinct from old.meta and new.value = pelago_digest(old.value) then return new; end if;
    elsif tg_argv[0] = 'entry' and (new.stream, new.pos, new.id, new.at, new.prev, new.hash) = (old.stream, old.pos, old.id, old.at, old.prev, old.hash)
         and new.undoes is not distinct from old.undoes then return new;
    end if;
  end if;
  raise exception 'The log is append-only: % on % is refused', tg_op, tg_table_name;
end $fn$;

-- How long one partition covers: a year. A month was tried first and costs PGlite more than it saves: a read that
-- cannot be pruned by time is planned against every partition, and three years of months took a query from 0.4 ms
-- of planning to 4 to 9 (task e_m6a2uw2f). A stretch of time inside a year is the BRIN index's.
create or replace function pelago_log_unit() returns text language sql immutable as $fn$ select 'year' $fn$;
-- The partition of a table that holds a moment: log_entry_2026 (or log_entry_2026_10, by the month).
create or replace function pelago_log_part(t text, at timestamptz) returns text language sql stable as $fn$
  select t || '_' || to_char(date_trunc(pelago_log_unit(), at at time zone 'UTC'), case pelago_log_unit() when 'year' then 'YYYY' else 'YYYY_MM' end)
$fn$;

create or replace function pelago_log_periods(since timestamptz, through timestamptz) returns int language plpgsql security definer set search_path = public as $fn$
declare
  unit text := pelago_log_unit();
  m timestamp := date_trunc(unit, since at time zone 'UTC');
  t text;
  part text;
  made int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('pelago.partitions'));
  while m <= through at time zone 'UTC' loop
    foreach t in array array['log_entry', 'log_fact', 'log_op'] loop
      part := pelago_log_part(t, m at time zone 'UTC');
      if to_regclass(part) is null then
        execute format('create table %I partition of %I for values from (%L) to (%L)', part, t, m at time zone 'UTC', (m + ('1 ' || unit)::interval) at time zone 'UTC');
        execute format('create trigger %I before truncate on %I for each statement execute function pelago_log_append_only()', part || '_no_truncate', part);
        made := made + 1;
      end if;
    end loop;
    m := m + ('1 ' || unit)::interval;
  end loop;
  return made;
end $fn$;
revoke execute on function pelago_log_periods(timestamptz, timestamptz) from public;
grant execute on function pelago_log_periods(timestamptz, timestamptz) to pelago_member;

create or replace function pelago_log_next() returns trigger language plpgsql security definer set search_path = public as $fn$
declare last record;
begin
  perform pg_advisory_xact_lock(hashtext('pelago.log'), hashtext(new.stream));
  select pos, hash, at into last from log_entry where stream = new.stream order by at desc, pos desc limit 1;
  if new.pos <> coalesce(last.pos, 0) + 1 then raise exception 'The log''s % stream is at %: an entry at % does not follow it', new.stream, coalesce(last.pos, 0), new.pos; end if;
  if new.prev <> coalesce(last.hash, decode(repeat('0', 64), 'hex')) then raise exception 'The log''s % entry % does not name the hash of the entry before it', new.stream, new.pos; end if;
  if new.at < last.at then raise exception 'The log''s % entry % is earlier than the entry before it', new.stream, new.pos; end if;
  return new;
end $fn$;

create or replace function pelago_log_op_next() returns trigger language plpgsql security definer set search_path = public as $fn$
declare last record;
begin
  perform pg_advisory_xact_lock(hashtext('pelago.oplog'), hashtext(new.stream));
  select pos, at into last from log_op where stream = new.stream order by at desc, pos desc limit 1;
  if new.pos <= last.pos then raise exception 'The % stream is at %: an entry at % does not follow it', new.stream, last.pos, new.pos; end if;
  if new.at < last.at then raise exception 'The % stream''s entry % is earlier than the entry before it', new.stream, new.pos; end if;
  return new;
end $fn$;

-- The tables made again when they are not cut yet; taken again over ones that are (a step can be), nothing moves.
do $do$ begin
  if (select relkind from pg_class where oid = 'log_entry'::regclass) = 'r' then
    alter table log_fact rename to log_fact_v1;
    alter table log_entry rename to log_entry_v1;
    alter table log_op rename to log_op_v1;
    alter index log_fact_pkey rename to log_fact_v1_pkey;
    alter index log_entry_pkey rename to log_entry_v1_pkey;
    alter index log_op_pkey rename to log_op_v1_pkey;
    drop index log_entry_id, log_entry_undoes, log_entry_at, log_fact_history, log_fact_seq, log_fact_link_from, log_fact_merged_into, log_op_at;

    create table log_entry (
      stream text not null,
      pos    bigint not null,
      id     text not null,
      at     timestamptz not null,
      head   jsonb not null,
      undoes text,
      prev   bytea not null,
      hash   bytea not null,
      primary key (stream, at, pos)
    ) partition by range (at);
    create table log_fact (
      stream text not null,
      pos    bigint not null,
      n      int not null,
      op     text not null check (op in ('+', '-')),
      id     text not null,
      field  text not null,
      value  jsonb,
      meta   jsonb,
      seq    bigint default nextval('event_seq_seq'),
      -- Its entry's time. The default is what append gives it, for an app from before this step that names no time.
      at     timestamptz not null default date_trunc('milliseconds', now()),
      primary key (stream, pos, n, at),
      foreign key (stream, at, pos) references log_entry (stream, at, pos)
    ) partition by range (at);
    create table log_op (
      stream text not null,
      pos    bigint not null,
      at     timestamptz not null,
      head   jsonb not null,
      facts  jsonb not null,
      primary key (stream, at, pos)
    ) partition by range (at);

    perform pelago_log_periods(least((select min(at) from log_entry_v1), (select min(at) from log_op_v1), now()), now() + ${AHEAD});
    insert into log_entry select * from log_entry_v1 order by stream, pos;
    insert into log_fact select f.*, e.at from log_fact_v1 f join log_entry_v1 e using (stream, pos) order by f.stream, f.pos, f.n;
    insert into log_op select * from log_op_v1 order by stream, pos;
    drop table log_fact_v1, log_entry_v1, log_op_v1;
  end if;
end $do$;

create index if not exists log_entry_pos on log_entry (stream, pos);
create index if not exists log_entry_id on log_entry (id);
create index if not exists log_entry_undoes on log_entry (undoes) where undoes is not null;
create index if not exists log_entry_at on log_entry using brin (at);
create index if not exists log_fact_history on log_fact (id, field, at, pos, n);
create index if not exists log_fact_seq on log_fact (seq);
create index if not exists log_fact_link_from on log_fact ((value->>1)) where field = 'link';
create index if not exists log_fact_merged_into on log_fact (value) where field = 'merged_into';
create index if not exists log_fact_at on log_fact using brin (at);
create index if not exists log_op_pos on log_op (stream, pos);
create index if not exists log_op_at on log_op using brin (at);

drop trigger if exists log_entry_next on log_entry;
create trigger log_entry_next before insert on log_entry for each row execute function pelago_log_next();
drop trigger if exists log_entry_append_only on log_entry;
create trigger log_entry_append_only before update or delete on log_entry for each row execute function pelago_log_append_only('entry');
drop trigger if exists log_entry_no_truncate on log_entry;
create trigger log_entry_no_truncate before truncate on log_entry for each statement execute function pelago_log_append_only();
drop trigger if exists log_fact_append_only on log_fact;
create trigger log_fact_append_only before update or delete on log_fact for each row execute function pelago_log_append_only('fact');
drop trigger if exists log_fact_no_truncate on log_fact;
create trigger log_fact_no_truncate before truncate on log_fact for each statement execute function pelago_log_append_only();
drop trigger if exists log_op_next on log_op;
create trigger log_op_next before insert on log_op for each row execute function pelago_log_op_next();
drop trigger if exists log_op_append_only on log_op;
create trigger log_op_append_only before update or delete on log_op for each row execute function pelago_log_op_compacted();
drop trigger if exists log_op_no_truncate on log_op;
create trigger log_op_no_truncate before truncate on log_op for each statement execute function pelago_log_append_only();
revoke update, delete, truncate on log_entry, log_fact, log_op from public;
grant select, insert on log_entry, log_fact, log_op to pelago_member;
grant select, delete on log_op to pelago_compactor;
`;

/** Make the partitions from `since` (now when not given) through two months from now that are not there yet. Returns how many tables it made. */
export async function makePartitions(q: Q, since?: Date | string): Promise<number> {
  const { rows } = await q.query<{ made: number }>(`select pelago_log_periods(coalesce($1::timestamptz, now()), now() + ${AHEAD}) as made`, [since ?? null]);
  return rows[0].made;
}

/**
 * For an append: whether the partition of `table` that holds this moment is there, read in the statement that finds
 * the stream's last entry, so the check costs a catalog lookup. Append makes it when it is not (`makePartitions`).
 */
export const partitionMade = (table: (typeof PARTITIONED)[number]) => `to_regclass(pelago_log_part('${table}', now())) is not null`;
