// Embedded Postgres (PGlite). The same schema runs on a Postgres server.

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';

/** Anything that can run a query: the database or a transaction on it. */
export interface Q {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// Types are not stored here: pack files are the source of truth for them.
// `workspace` is unused until teams exist, but is far cheaper to carry from the
// start than to add to every table later.
const SCHEMA = `
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
  origin    text not null default 'lattice',
  actor     text not null,
  action    text not null,
  target_id text,
  changeset text,
  reason    text not null default '',
  detail    jsonb not null default '{}'
);
create index if not exists event_ts on event(ts);
create index if not exists event_target on event(target_id);

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
`;

// Who may see what, enforced by the database itself. A request made on behalf
// of a person runs as the role below with that person as "viewer", and row
// level security hides everything private to someone else: entities, any
// relation touching one, any event about one, and other people's proposals.
// No query in the application has to remember to filter.
const VISIBILITY = `
alter table entity   add column if not exists private_to text;
alter table proposal add column if not exists private_to text;
alter table event    add column if not exists private_to text;
alter table token    add column if not exists admin boolean not null default false;
-- What an agent's token is limited to changing (repository ids; null is everything), and where it has been used from.
alter table token    add column if not exists repos jsonb;
alter table token    add column if not exists seen jsonb;

do $$ begin create role lattice_member nologin; exception when duplicate_object then null; end $$;
grant select, insert, update on entity, relation, event, proposal, setting, token to lattice_member;
grant usage, select on all sequences in schema public to lattice_member;

alter table entity   enable row level security;
alter table relation enable row level security;
alter table event    enable row level security;
alter table proposal enable row level security;

drop policy if exists member_entity on entity;
create policy member_entity on entity for all to lattice_member
  using (private_to is null or private_to = current_setting('lattice.viewer', true))
  with check (true);

drop policy if exists member_relation on relation;
create policy member_relation on relation for all to lattice_member
  using (from_id in (select id from entity) and to_id in (select id from entity))
  with check (from_id in (select id from entity) and to_id in (select id from entity));

-- A picture is seen by whoever may see the result it is of.
grant select, insert, update, delete on picture to lattice_member;
alter table picture enable row level security;
drop policy if exists member_picture on picture;
create policy member_picture on picture for all to lattice_member
  using (entity_id in (select id from entity))
  with check (entity_id in (select id from entity));

drop policy if exists member_event on event;
create policy member_event on event for all to lattice_member
  using ((private_to is null or private_to = current_setting('lattice.viewer', true))
         and (target_id is null or target_id in (select id from entity)))
  with check (true);

-- Two facts have to cross the privacy line, or coordination breaks. Each is
-- answered by a function that sees everything and gives away as little as it
-- can.
--
-- Who holds a resource: a shared resource held by someone's private session
-- is still held. The holder's title is given only to those who may see it.
create or replace function lattice_active_holds(is_member boolean, viewer text)
returns table (id text, from_id text, to_id text, props jsonb, valid_from timestamptz, holder_title text)
language sql stable security definer set search_path = public as $fn$
  select h.id, h.from_id, h.to_id, h.props, h.valid_from,
         case when not is_member or s.private_to is null or s.private_to = viewer then s.title else 'someone''s private session' end
  from relation h join entity s on s.id = h.from_id
  where h.type = 'holds' and h.valid_to is null
$fn$;

-- How many things that are not the viewer's own private items depend on this
-- one. Only a count: it says a dependent exists, not what it is.
create or replace function lattice_external_dependents(target text, viewer text) returns int
language sql stable security definer set search_path = public as $fn$
  select count(*)::int from relation r join entity s on s.id = r.from_id
  where r.to_id = target and r.valid_to is null and r.type in ('depends_on', 'needs') and s.archived_at is null
    and (s.private_to is null or s.private_to <> viewer)
$fn$;

grant execute on function lattice_active_holds(boolean, text), lattice_external_dependents(text, text) to lattice_member;

-- Public: a third level, for anyone, with no login. A request for a public page runs as the role below, which may
-- read only what is public, and only some columns of it: never a note, an event, a proposal, a token or a setting.
-- What is public: an item marked so; a test that helps answer a public proof question; and a result of such a test,
-- so that a question is made public once and brings its proof with it.
create or replace function lattice_is_public(target text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from entity e where e.id = target and e.archived_at is null and (
      e.visibility = 'public'
      or exists (select 1 from relation a join entity q on q.id = a.to_id
                 where a.type = 'software.answers' and a.valid_to is null and a.from_id = e.id and q.visibility = 'public' and q.archived_at is null)
      or exists (select 1 from relation p
                 join relation a on a.from_id = p.from_id and a.type = 'software.answers' and a.valid_to is null
                 join entity q on q.id = a.to_id
                 where p.type = 'produced' and p.valid_to is null and p.to_id = e.id and q.visibility = 'public' and q.archived_at is null)))
$fn$;

-- The public items that belong to a public one, through whatever lies between: a public question in a feature that
-- is not public is still its public product's. Gives ids only, and only of what is public.
create or replace function lattice_public_under(root text) returns setof text
language sql stable security definer set search_path = public as $fn$
  with recursive scope(id) as (
    select root where lattice_is_public(root)
    union
    select r.from_id from relation r join scope s on r.to_id = s.id where r.type in ('part_of', 'about') and r.valid_to is null
  )
  select id from scope where lattice_is_public(id)
$fn$;

do $$ begin create role lattice_public nologin; exception when duplicate_object then null; end $$;
grant select (id, workspace, type, title, status, is_open, visibility, props, created_at, updated_at, archived_at) on entity to lattice_public;
grant select (id, type, from_id, to_id, valid_to) on relation to lattice_public;
grant select on picture to lattice_public;
grant execute on function lattice_is_public(text), lattice_public_under(text) to lattice_public;

drop policy if exists public_entity on entity;
create policy public_entity on entity for select to lattice_public using (lattice_is_public(id));
drop policy if exists public_relation on relation;
create policy public_relation on relation for select to lattice_public using (lattice_is_public(from_id) and lattice_is_public(to_id));
drop policy if exists public_picture on picture;
create policy public_picture on picture for select to lattice_public using (lattice_is_public(entity_id));

drop policy if exists member_proposal on proposal;
create policy member_proposal on proposal for all to lattice_member
  using (private_to is null or private_to = current_setting('lattice.viewer', true))
  with check (true);
`;

/** What the application needs of a database: the real one, or one scoped to a viewer. */
export interface Db extends Q {
  transaction<T>(fn: (tx: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Open the database at a folder, or in memory when no folder is given. */
export async function openDb(dataDir?: string): Promise<PGlite> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  // pg_trgm matches near-misses and typos in search; a Postgres server has it too.
  const db = dataDir ? new PGlite(dataDir, { extensions: { pg_trgm } }) : new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create extension if not exists pg_trgm`);
  await db.exec(SCHEMA);
  await db.exec(VISIBILITY);
  return db;
}

/**
 * The same database as one person sees it. Every statement runs inside a
 * transaction that first drops to the member role and names the viewer, so
 * the setting cannot leak between requests sharing the connection.
 */
export function scoped(db: Db, viewer: string): Db {
  const enter = async (tx: Q) => {
    await tx.query(`select set_config('lattice.viewer', $1, true)`, [viewer]);
    await tx.query(`set local role lattice_member`);
  };
  return {
    query: <T>(sql: string, params?: unknown[]) =>
      db.transaction(async (tx) => {
        await enter(tx);
        return tx.query<T>(sql, params);
      }),
    transaction: <T>(fn: (tx: Q) => Promise<T>) =>
      db.transaction(async (tx) => {
        await enter(tx);
        return fn(tx);
      }),
    close: () => db.close(),
  };
}

/** The same database as anyone at all sees it, with no login: only what is public, and only some columns of that. */
export function anyone(db: Db): Db {
  const enter = (tx: Q) => tx.query(`set local role lattice_public`);
  return {
    query: <T>(sql: string, params?: unknown[]) =>
      db.transaction(async (tx) => {
        await enter(tx);
        return tx.query<T>(sql, params);
      }),
    transaction: <T>(fn: (tx: Q) => Promise<T>) =>
      db.transaction(async (tx) => {
        await enter(tx);
        return fn(tx);
      }),
    close: () => db.close(),
  };
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newId(prefix: string): string {
  let out = '';
  for (const byte of randomBytes(8)) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}
