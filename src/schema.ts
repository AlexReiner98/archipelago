// The schema as SQL, in the parts src/migrate.ts applies once each, in order. What is here already stands in
// every database: change it only by adding a migration there, never by editing a part a database has applied.

// Types are not stored here: pack files are the source of truth for them.
// `workspace` is unused until teams exist, but is far cheaper to carry from the
// start than to add to every table later.
export const SCHEMA = `
create table if not exists entity (
  id          text primary key,
  workspace   text not null default 'default',
  type        text not null,
  title       text not null,
  body        text not null default '',
  status      text not null,
  is_open     boolean not null,
  owner       text references entity(id),
  visibility  text not null default 'private',
  confidence  real not null default 1,
  props       jsonb not null default '{}',
  source_id   text references entity(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists entity_type on entity(type);
create index if not exists entity_owner on entity(owner);

create table if not exists relation (
  id          text primary key,
  workspace   text not null default 'default',
  type        text not null,
  from_id     text not null references entity(id),
  to_id       text not null references entity(id),
  props       jsonb not null default '{}',
  confidence  real not null default 1,
  source_id   text references entity(id),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz
);
create index if not exists relation_from on relation(from_id);
create index if not exists relation_to on relation(to_id);

-- Append-only. Every change to the map, and every external tool call we import.
create table if not exists event (
  seq       bigserial primary key,
  workspace text not null default 'default',
  ts        timestamptz not null default now(),
  origin    text not null default 'pelago',
  actor     text not null,
  action    text not null,
  target_id text,
  changeset text,
  reason    text not null default '',
  detail    jsonb not null default '{}'
);
-- A database made while this was called Lattice named its own events so.
alter table event alter column origin set default 'pelago';
update event set origin = 'pelago' where origin = 'lattice';
create index if not exists event_ts on event(ts);
create index if not exists event_target on event(target_id);
-- One claim of a resource at a time. PGlite has one connection, so nothing to wait for; a server makes it a lock (src/pg.ts).
do $$ begin if to_regprocedure('pelago_hold_lock(text)') is null then create function pelago_hold_lock(resource text) returns void language plpgsql as $fn$ begin end $fn$; end if; end $$;

create table if not exists proposal (
  id         text primary key,
  workspace  text not null default 'default',
  ts         timestamptz not null default now(),
  actor      text not null,
  reason     text not null,
  source     jsonb,
  ops        jsonb not null,
  warnings   jsonb not null default '[]',
  status     text not null default 'pending',
  decided_by text,
  decided_at timestamptz,
  note       text
);

-- Stored as a hash only; the secret is shown once when the token is made.
create table if not exists token (
  id         text primary key,
  hash       text not null unique,
  hint       text not null,
  kind       text not null,
  name       text not null,
  entity_id  text,
  created_at timestamptz not null default now(),
  last_used  timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

-- A link that lets someone with no login read one document. Stored as a hash only; the secret is shown once.
create table if not exists share (
  id         text primary key,
  workspace  text not null default 'default',
  hash       text not null unique,
  hint       text not null,
  entity_id  text not null references entity(id),
  made_by    text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists setting (
  key   text primary key,
  value jsonb not null
);

-- The picture a test drew, kept only for a result that is shown in public: until then it stays in the
-- repository it was made in. One for each result; a test that is run again loses its old one.
create table if not exists picture (
  entity_id    text primary key references entity(id),
  workspace    text not null default 'default',
  content_type text not null,
  bytes        bytea not null,
  size         int not null,
  created_at   timestamptz not null default now()
);

-- Every type and relation the workspace has used, as it was last loaded: active while its pack is, dormant after.
-- A dormant type's items keep their kind, statuses, fields and capabilities from here. Written when a workspace
-- opens; read by everyone, since a type says nothing private.
create table if not exists type_def (
  id      text primary key,
  what    text not null check (what in ('type', 'relation')),
  pack    text not null,
  state   text not null default 'active' check (state in ('active', 'dormant')),
  def     jsonb not null,
  changed timestamptz not null default now()
);

-- What a pack asked to be done outside the map: a request to a host it declared, made with a secret the kernel
-- holds. One that moves money or cannot be taken back waits here for a person; once made it is logged, never undone.
create table if not exists act (
  id         text primary key,
  workspace  text not null default 'default',
  pack       text not null,
  action     text not null,
  act        text not null,
  request    jsonb not null,
  actor      jsonb not null,
  made_for   text,
  changeset  text,
  status     text not null check (status in ('held', 'done', 'refused', 'failed')),
  result     jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
`;

// Who may see what, enforced by the database itself. A request made on behalf
// of a person runs as the role below with that person as "viewer", and row
// level security hides everything private to someone else: entities, any
// relation touching one, any event about one, and other people's proposals.
// No query in the application has to remember to filter.
export const VISIBILITY = `
alter table entity   add column if not exists private_to text;
alter table proposal add column if not exists private_to text;
alter table event    add column if not exists private_to text;
alter table token    add column if not exists admin boolean not null default false;
-- What an agent's token is limited to changing (repository ids; null is everything), and where it has been used from.
alter table token    add column if not exists repos jsonb;
alter table token    add column if not exists seen jsonb;

do $$ begin create role pelago_member nologin; exception when duplicate_object then null; end $$;
grant select, insert, update on entity, relation, event, proposal, setting, token to pelago_member;
grant select on type_def to pelago_member;
grant select, insert, update on act to pelago_member;
grant usage, select on all sequences in schema public to pelago_member;

alter table entity   enable row level security;
alter table relation enable row level security;
alter table event    enable row level security;
alter table proposal enable row level security;

drop policy if exists member_entity on entity;
create policy member_entity on entity for all to pelago_member
  using (private_to is null or private_to = current_setting('pelago.viewer', true))
  with check (true);

drop policy if exists member_relation on relation;
create policy member_relation on relation for all to pelago_member
  using (from_id in (select id from entity) and to_id in (select id from entity))
  with check (from_id in (select id from entity) and to_id in (select id from entity));

-- A picture is seen by whoever may see the result it is of.
grant select, insert, update, delete on picture to pelago_member;
alter table picture enable row level security;
drop policy if exists member_picture on picture;
create policy member_picture on picture for all to pelago_member
  using (entity_id in (select id from entity))
  with check (entity_id in (select id from entity));

drop policy if exists member_event on event;
create policy member_event on event for all to pelago_member
  using ((private_to is null or private_to = current_setting('pelago.viewer', true))
         and (target_id is null or target_id in (select id from entity)))
  with check (true);

-- Two facts have to cross the privacy line, or coordination breaks. Each is
-- answered by a function that sees everything and gives away as little as it
-- can.
--
-- Who holds a resource: a shared resource held by someone's private session
-- is still held. The holder's title is given only to those who may see it.
create or replace function pelago_active_holds(is_member boolean, viewer text)
returns table (id text, from_id text, to_id text, props jsonb, valid_from timestamptz, holder_title text)
language sql stable security definer set search_path = public as $fn$
  select h.id, h.from_id, h.to_id, h.props, h.valid_from,
         case when not is_member or s.private_to is null or s.private_to = viewer then s.title else 'someone''s private session' end
  from relation h join entity s on s.id = h.from_id
  where h.type = 'holds' and h.valid_to is null
$fn$;

-- How many things that are not the viewer's own private items depend on this
-- one. Only a count: it says a dependent exists, not what it is.
create or replace function pelago_external_dependents(target text, viewer text) returns int
language sql stable security definer set search_path = public as $fn$
  select count(*)::int from relation r join entity s on s.id = r.from_id
  where r.to_id = target and r.valid_to is null and r.type in ('depends_on', 'needs') and s.archived_at is null
    and (s.private_to is null or s.private_to <> viewer)
$fn$;

grant execute on function pelago_active_holds(boolean, text), pelago_external_dependents(text, text) to pelago_member;

-- A pack's secret as it is kept, sealed. The kernel opens it with a key the database does not hold, to add it to a
-- request the pack asked for; whoever the request is made for cannot read settings, so it crosses here. Pack
-- secrets only.
create or replace function pelago_pack_secret(name text) returns text
language sql stable security definer set search_path = public as $fn$
  select value #>> '{}' from setting where key = name and left(name, 12) = 'pack_secret:'
$fn$;
grant execute on function pelago_pack_secret(text) to pelago_member;

-- Public: a third level, for anyone, with no login. A request for a public page runs as the role below, which may
-- read only what is public, and only some columns of it: never a note, an event, a proposal, a token or a setting,
-- and of an item's fields only the few named below.
-- What is public: an item marked so, and what goes with a public one (its type's belongs_with in the type table: a
-- test with the question it helps answer, a result with its test), so that a question is made public once and
-- brings its proof with it. Followed four steps out at most; each step through what is not archived.
create or replace function pelago_is_public(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  with recursive up(id, depth) as (
    select e.id, 0 from entity e where e.id = target and e.archived_at is null
    union
    select n.id, u.depth + 1 from up u
      join entity c on c.id = u.id
      join type_def t on t.id = c.type and t.what = 'type'
      cross join lateral jsonb_array_elements(coalesce(t.def->'belongs_with', '[]'::jsonb)) w
      join relation r on r.type = w->>'relation' and r.valid_to is null
                     and (case when w->>'direction' = 'out' then r.from_id else r.to_id end) = c.id
      join entity n on n.id = (case when w->>'direction' = 'out' then r.to_id else r.from_id end) and n.archived_at is null
    where u.depth < 4
  )
  select exists (select 1 from up join entity e on e.id = up.id where e.visibility = 'public')
$fn$;

-- The public items that belong to a public one, through whatever lies between: a public question in a feature that
-- is not public is still its public product's. Gives ids only, and only of what is public.
create or replace function pelago_public_under(root text) returns setof text
language sql stable security definer set search_path = public as $fn$
  with recursive scope(id) as (
    select root where pelago_is_public(root)
    union
    select r.from_id from relation r join scope s on r.to_id = s.id where r.type in ('part_of', 'about') and r.valid_to is null
  )
  select id from scope where pelago_is_public(id)
$fn$;

-- Of a public item's fields, the ones its page shows and no others: what a test compares and found, and a release's
-- version. Where a result's evidence or picture lies in its repository, or anything else kept on the item, is not given.
create or replace function pelago_public_props(target text) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce((select jsonb_object_agg(f.key, f.value) from jsonb_each(e.props) f
                   where f.key in ('build', 'passed', 'value', 'compares', 'tolerance', 'environment', 'version')), '{}'::jsonb)
  from entity e where e.id = target and pelago_is_public(target)
$fn$;

do $$ begin create role pelago_public nologin; exception when duplicate_object then null; end $$;
grant select (id, workspace, type, title, status, is_open, visibility, created_at, updated_at, archived_at) on entity to pelago_public;
-- A database made before 12 Oct 2026 gave the role every field.
revoke select (props) on entity from pelago_public;
grant select (id, type, from_id, to_id, valid_to) on relation to pelago_public;
grant select on picture to pelago_public;
grant execute on function pelago_is_public(text), pelago_public_under(text), pelago_public_props(text) to pelago_public;

drop policy if exists public_entity on entity;
create policy public_entity on entity for select to pelago_public using (pelago_is_public(id));
drop policy if exists public_relation on relation;
create policy public_relation on relation for select to pelago_public using (pelago_is_public(from_id) and pelago_is_public(to_id));
drop policy if exists public_picture on picture;
create policy public_picture on picture for select to pelago_public using (pelago_is_public(entity_id));

-- Tokens and settings. A member sees and changes the tokens that are their own; an admin, all of them. Of the
-- settings a member reads the few every request needs (who the owner is, whether new things are private, whether
-- agents' changes are held, whether agents may download backups) and keeps the place it has read a connection's log up to; the rest, the sealed secrets
-- among them, is an admin's. Whether the viewer is an admin is said with the viewer, by the server, from the token.
alter table token   enable row level security;
alter table setting enable row level security;
grant delete on setting to pelago_member;

-- An act is seen by whoever it was made for, and by an admin, who decides the held ones.
alter table act enable row level security;
drop policy if exists member_act on act;
create policy member_act on act for all to pelago_member
  using (current_setting('pelago.admin', true) = '1' or made_for = current_setting('pelago.viewer', true))
  with check (true);

drop policy if exists member_token on token;
create policy member_token on token for all to pelago_member
  using (current_setting('pelago.admin', true) = '1' or entity_id = current_setting('pelago.viewer', true))
  with check (current_setting('pelago.admin', true) = '1' or entity_id = current_setting('pelago.viewer', true));

drop policy if exists member_setting_read on setting;
create policy member_setting_read on setting for select to pelago_member
  using (key in ('me', 'default_visibility', 'agent_changes', 'agent_backups'));
drop policy if exists member_setting on setting;
create policy member_setting on setting for all to pelago_member
  using (current_setting('pelago.admin', true) = '1' or key like 'audit_cursor:%')
  with check (current_setting('pelago.admin', true) = '1' or key like 'audit_cursor:%');

-- A document's links are seen, made and revoked by whoever may see the document.
grant select, insert, update on share to pelago_member;
alter table share enable row level security;
drop policy if exists member_share on share;
create policy member_share on share for all to pelago_member
  using (entity_id in (select id from entity))
  with check (entity_id in (select id from entity));

-- What a link shows, and nothing else: the document it was made for, while the link stands and the document is not
-- archived, and the items its note brings in by a line holding only their id. An item private to anyone but the
-- document's own author is left out, as is anything archived or in another workspace. Titles, states and notes only.
create or replace function pelago_shared_document(secret_hash text) returns jsonb
language sql stable security definer set search_path = public as $fn$
  with d as (
    select e.* from share s join entity e on e.id = s.entity_id
    where s.hash = secret_hash and s.revoked_at is null and e.archived_at is null
  ),
  named as (
    select distinct m[1] as id from d, regexp_matches(d.body, '^[ \\t]*(e_[a-z0-9]{8})[ \\t]*$', 'gn') as m
  ),
  items as (
    select i.id, i.type, i.title, i.status, i.body, i.updated_at, exists (select 1 from picture p where p.entity_id = i.id) as picture
    from entity i join named n on n.id = i.id, d
    where i.archived_at is null and i.workspace = d.workspace and (i.private_to is null or i.private_to = d.private_to)
  )
  select jsonb_build_object(
    'id', d.id, 'type', d.type, 'title', d.title, 'body', d.body, 'status', d.status, 'props', d.props, 'updated_at', d.updated_at,
    'items', coalesce((select jsonb_agg(to_jsonb(items)) from items), '[]'::jsonb))
  from d
$fn$;
-- The figure of one item a link shows, and of nothing else.
create or replace function pelago_shared_picture(secret_hash text, target text)
returns table (content_type text, bytes bytea)
language sql stable security definer set search_path = public as $fn$
  select p.content_type, p.bytes from picture p
  where p.entity_id = target
    and exists (select 1 from jsonb_array_elements(pelago_shared_document(secret_hash) -> 'items') i where i ->> 'id' = target)
$fn$;
grant execute on function pelago_shared_document(text), pelago_shared_picture(text, text) to pelago_public;

drop policy if exists member_proposal on proposal;
create policy member_proposal on proposal for all to pelago_member
  using (private_to is null or private_to = current_setting('pelago.viewer', true))
  with check (true);

-- A database made while this was called Lattice: its roles and functions go, now that those above stand in their place.
drop function if exists lattice_active_holds(boolean, text), lattice_external_dependents(text, text), lattice_public_props(text), lattice_public_under(text), lattice_is_public(text);
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lattice_member') then drop owned by lattice_member; drop role lattice_member; end if;
  if exists (select 1 from pg_roles where rolname = 'lattice_public') then drop owned by lattice_public; drop role lattice_public; end if;
end $$;
`;

// What only many connections need. Events are read in the order they are numbered (watch, the prompt hook,
// automations): a transaction that writes them holds a lock until it commits, so none is seen before one numbered
// ahead of it. The lock is taken by the first change to an item too, before any row is locked, so two writers never
// wait on each other. And one claim of a resource at a time. PGlite needs none of it, and its locks keep a timer.
export const ORDERED = `
create or replace function pelago_event_order() returns trigger language plpgsql as $fn$ begin perform pg_advisory_xact_lock(hashtext('pelago.event')); return null; end $fn$;
create or replace trigger event_order before insert on event for each statement execute function pelago_event_order();
create or replace trigger entity_order before insert or update or delete on entity for each statement execute function pelago_event_order();
create or replace trigger relation_order before insert or update or delete on relation for each statement execute function pelago_event_order();
create or replace trigger proposal_order before insert or update or delete on proposal for each statement execute function pelago_event_order();
create or replace function pelago_hold_lock(resource text) returns void language sql as $fn$ select pg_advisory_xact_lock(hashtext('pelago.holds'), hashtext(resource)) $fn$;
`;

/**
 * What an agent's token may write: within these items and what is part of them (null is everything), and how
 * (report, propose or change). A repository limit is the case of within, so the tokens limited to repositories are
 * within them; repos is still written beside within, for the commit before this one while both run. may is left
 * empty by a backup made before it, and empty is change.
 */
export const TOKEN_SCOPE = `
alter table token add column if not exists within jsonb;
alter table token add column if not exists may text default 'change';
update token set within = repos where repos is not null and within is null;
`;

/** A client a person allowed by signing in through the browser, and the hash of its refresh token (src/auth.ts). */
export const TOKEN_GRANT = `alter table token add column if not exists granted jsonb;`;

/** Members, each by an email address (src/members.ts): step 6. Only the whole database reads it. */
export const MEMBER = `
create table if not exists member (
  email      text primary key,
  person_id  text not null,
  admin      boolean not null default false,
  added_at   timestamptz not null default now(),
  added_by   text,
  removed_at timestamptz
);
alter table member enable row level security;
`;

/** Step 7 (src/migrate.ts): a share may be made out to another workspace on the server instead of to a secret (src/workspace-share.ts). */
export const WORKSPACE_SHARE = `
alter table share add column if not exists to_workspace text;
alter table share add column if not exists to_item text;
alter table share alter column hash drop not null;

-- What a share made out to a workspace shows to that workspace, and nothing else: as pelago_shared_document, but
-- found by the share and the reading workspace, which the server says, not by a secret the reader holds.
create or replace function pelago_workspace_document(share_id text, reader text) returns jsonb
language sql stable security definer set search_path = public as $fn$
  with d as (
    select e.* from share s join entity e on e.id = s.entity_id
    where s.id = share_id and s.to_workspace = reader and s.revoked_at is null and e.archived_at is null
  ),
  named as (
    select distinct m[1] as id from d, regexp_matches(d.body, '^[ \\t]*(e_[a-z0-9]{8})[ \\t]*$', 'gn') as m
  ),
  items as (
    select i.id, i.type, i.title, i.status, i.body, i.updated_at, exists (select 1 from picture p where p.entity_id = i.id) as picture
    from entity i join named n on n.id = i.id, d
    where i.archived_at is null and i.workspace = d.workspace and (i.private_to is null or i.private_to = d.private_to)
  )
  select jsonb_build_object(
    'id', d.id, 'type', d.type, 'title', d.title, 'body', d.body, 'status', d.status, 'props', d.props, 'updated_at', d.updated_at,
    'items', coalesce((select jsonb_agg(to_jsonb(items)) from items), '[]'::jsonb))
  from d
$fn$;
create or replace function pelago_workspace_picture(share_id text, reader text, target text)
returns table (content_type text, bytes bytea)
language sql stable security definer set search_path = public as $fn$
  select p.content_type, p.bytes from picture p
  where p.entity_id = target
    and exists (select 1 from jsonb_array_elements(pelago_workspace_document(share_id, reader) -> 'items') i where i ->> 'id' = target)
$fn$;
grant execute on function pelago_workspace_document(text, text), pelago_workspace_picture(text, text, text) to pelago_public;`;

/** Step 12 (src/migrate.ts): a member, and so an agent's token, reads whether the owner lets agents publish (src/published.ts). */
/** Step 14 (src/migrate.ts): and whether the owner lets agents change the code drawings run, unreviewed (src/rules.ts, lifted). */
export const AGENT_CODE_READ = `
drop policy if exists member_setting_read on setting;
create policy member_setting_read on setting for select to pelago_member
  using (key in ('me', 'default_visibility', 'agent_changes', 'agent_backups', 'agent_publish', 'agent_code'));
`;

export const AGENT_PUBLISH_READ = `
drop policy if exists member_setting_read on setting;
create policy member_setting_read on setting for select to pelago_member
  using (key in ('me', 'default_visibility', 'agent_changes', 'agent_backups', 'agent_publish'));
`;

/** Step 16 (src/migrate.ts): a held change keeps the rule that held it (src/rules.ts, decide). */
export const HELD_BY = `alter table proposal add column if not exists held_by jsonb;`;
