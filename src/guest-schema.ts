// A guest's reach, enforced by the database (decision e_qpaqnmrc, axis A). A guest is a member who reads one view the
// owner shared with them, live, and nothing else: their requests run as pelago_reader, which may only select, and
// only the items and links in that view's answer now. The answer is worked out by the server as the person who shared
// it (src/guests.ts) and kept in `reach`, one row per item or link, made again whenever the log has moved; the
// policies here read it. The log itself is not granted: a guest's feed of it is the one narrow function below.

/** Step 36 (src/migrate.ts): a view shared with a guest, who reads it live and nothing else. */
export const GUEST_READER = `
-- A share made out to a guest names them (their person); a member who is a guest names the share they read.
alter table share  add column if not exists guest text;
alter table member add column if not exists reads text;

create table if not exists reach (
  share_id text not null,
  id       text not null,
  primary key (share_id, id)
);
alter table reach enable row level security;

do $$ begin create role pelago_reader nologin; exception when duplicate_object then null; end $$;
grant select on entity, relation, picture, type_def, reach, setting, vault_key to pelago_reader;

-- Which share a reader reads under is said with the request, by the server, from the guest's token.
drop policy if exists reader_reach on reach;
create policy reader_reach on reach for select to pelago_reader
  using (share_id = current_setting('pelago.share', true));

drop policy if exists reader_entity on entity;
create policy reader_entity on entity for select to pelago_reader
  using (private_to is null and archived_at is null and exists (select 1 from reach r where r.id = entity.id));

drop policy if exists reader_relation on relation;
create policy reader_relation on relation for select to pelago_reader
  using (exists (select 1 from reach r where r.id = relation.id) and from_id in (select id from entity) and to_id in (select id from entity));

drop policy if exists reader_picture on picture;
create policy reader_picture on picture for select to pelago_reader
  using (entity_id in (select id from entity));

-- Only the settings a read needs: whose map it is, and whether new things are private.
drop policy if exists reader_setting on setting;
create policy reader_setting on setting for select to pelago_reader
  using (key in ('me', 'default_visibility'));

-- The keys of what a reader may see, so its words open (src/seal.ts), and no other. A member reads and adds every key, as before.
alter table vault_key enable row level security;
drop policy if exists member_vault_key on vault_key;
create policy member_vault_key on vault_key for all to pelago_member using (true) with check (true);
drop policy if exists reader_vault_key on vault_key;
create policy reader_vault_key on vault_key for select to pelago_reader
  using (id in (select id from entity) or id in (select id from relation));

-- A guest's feed of the log: the facts after a position on the items and links in reach that are not private, from
-- at most \`most\` entries, while the share stands. Also the last entry read, and whether more follow.
create or replace function pelago_reader_facts(after bigint, most int) returns jsonb
language sql stable security definer set search_path = public as $fn$
  with s as (select id from share where id = current_setting('pelago.share', true) and guest is not null and revoked_at is null),
  w as (select pos, at from log_entry where stream = 'facts' and pos > after
          and at >= coalesce((select at from log_entry where stream = 'facts' and pos = after), '-infinity')
        order by pos limit most + 1),
  k as (select pos, at from w order by pos limit most),
  r as (select x.id from reach x join s on s.id = x.share_id),
  f as (select f.pos::int as pos, f.at, f.n, f.op, f.id, f.field, f.value, f.meta from log_fact f
        where f.stream = 'facts' and f.pos in (select pos from k) and f.at >= (select min(at) from k) and f.at <= (select max(at) from k)
          and f.id in (select id from r)
          and (exists (select 1 from entity e where e.id = f.id and e.private_to is null and e.archived_at is null)
               or exists (select 1 from relation l join entity a on a.id = l.from_id join entity b on b.id = l.to_id
                          where l.id = f.id and a.private_to is null and b.private_to is null)))
  select jsonb_build_object(
    'last', (select max(pos) from k),
    'more', (select count(*) from w) > most,
    'facts', coalesce((select jsonb_agg(to_jsonb(f) order by f.pos, f.n) from f), '[]'::jsonb))
  where exists (select 1 from s)
$fn$;
create or replace function pelago_reader_head() returns int
language sql stable security definer set search_path = public as $fn$
  select coalesce(max(pos), 0)::int from log_entry where stream = 'facts' -- index log_entry_pos
$fn$;
revoke execute on function pelago_reader_facts(bigint, int), pelago_reader_head() from public;
grant execute on function pelago_reader_facts(bigint, int), pelago_reader_head() to pelago_reader;
`;
