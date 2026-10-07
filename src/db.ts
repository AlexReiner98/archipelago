// Embedded Postgres (PGlite). The same schema runs on a Postgres server.

import { PGlite } from '@electric-sql/pglite';
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
`;

/** Open the database at a folder, or in memory when no folder is given. */
export async function openDb(dataDir?: string): Promise<PGlite> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.exec(SCHEMA);
  return db;
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newId(prefix: string): string {
  let out = '';
  for (const byte of randomBytes(8)) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}
