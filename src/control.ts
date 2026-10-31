// What the server keeps about itself rather than about one map: the workspaces it holds, the operator's secret, and
// for its server packs their sealed secrets, their keys and values, and the workspaces connected to each. It is kept in the default workspace's database,
// which on a Postgres server is the one every other workspace's database is named from, so every server on that
// database reads the same list. Before 19 Oct 2026 it was files beside the workspaces (workspaces/index.json,
// and a file of the GitHub App's); the first server to open the database took what they held, once, and left them where
// they are for the code before, should it be put back.
//
// It is operational state, no fact about a map: written here, not through change, in no workspace's backup, and no
// member's role is granted it. A workspace's own types (local_type) are its own database's, made by the same step.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Q } from './db.ts';

/** The tables, made by step 4 of the schema (src/migrate.ts). */
export const CONTROL = `
create table if not exists control_workspace (
  id      text primary key,
  name    text not null,
  created timestamptz not null default now()
);
create table if not exists control_value (
  key   text primary key,
  value jsonb not null
);
create table if not exists github_installation (
  id        text primary key,
  workspace text not null,
  account   text not null default ''
);
create table if not exists local_type (
  id         text primary key,
  def        jsonb not null,
  n          serial,
  defined_at timestamptz not null default now()
);
alter table control_workspace enable row level security;
alter table control_value enable row level security;
alter table github_installation enable row level security;
alter table local_type enable row level security;`;

export interface WorkspaceRow {
  id: string;
  name: string;
  created: string;
}

export async function listWorkspaces(db: Q): Promise<WorkspaceRow[]> {
  const { rows } = await db.query<{ id: string; name: string; created: Date | string }>(`select id, name, created from control_workspace order by created, id`);
  return rows.map((r) => ({ id: r.id, name: r.name, created: new Date(r.created).toISOString() }));
}

/** Add a workspace to the list. False when another server added one by that id first. */
export async function addWorkspace(db: Q, row: { id: string; name: string }): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`insert into control_workspace (id, name) values ($1, $2) on conflict (id) do nothing returning id`, [row.id, row.name]);
  return rows.length > 0;
}

export async function removeWorkspace(db: Q, id: string): Promise<void> {
  await db.query(`delete from control_workspace where id = $1`, [id]);
}

export async function controlValue<T>(db: Q, key: string): Promise<T | undefined> {
  const { rows } = await db.query<{ value: T }>(`select value from control_value where key = $1`, [key]);
  return rows[0]?.value;
}

export async function setControlValue(db: Q, key: string, value: unknown): Promise<void> {
  await db.query(`insert into control_value (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
}

/** Set a value only if there is none yet. False when one was there: another server set it first. */
export async function claimControlValue(db: Q, key: string, value: unknown): Promise<boolean> {
  const { rows } = await db.query<{ key: string }>(`insert into control_value (key, value) values ($1, $2::jsonb) on conflict (key) do nothing returning key`, [key, JSON.stringify(value)]);
  return rows.length > 0;
}

/** Take a value away as it is read: whichever server asks first has it, once. */
export async function takeControlValue<T>(db: Q, key: string): Promise<T | undefined> {
  const { rows } = await db.query<{ value: T }>(`delete from control_value where key = $1 returning value`, [key]);
  return rows[0]?.value;
}

/** The hash of the operator's secret, and of a reset prepared for it. */
export const OPERATOR = 'operator';
export const OPERATOR_RESET = 'operator_reset';

/** Set in a database once the files kept before it was used for this have been read into it. */
const IMPORTED = 'files_imported';
const LOCAL_IMPORTED = 'local_pack_imported';

/** Bring in what the files beside the workspaces held, the first time this database is opened for it. */
export async function importControlFiles(db: Q, rootDir: string): Promise<string[]> {
  if (await controlValue(db, IMPORTED)) return [];
  const brought: string[] = [];
  const index = join(rootDir, 'index.json');
  if (existsSync(index)) {
    const was = JSON.parse(readFileSync(index, 'utf8')) as { operator?: string; workspaces?: WorkspaceRow[] };
    for (const w of was.workspaces ?? []) await db.query(`insert into control_workspace (id, name, created) values ($1, $2, $3) on conflict (id) do nothing`, [w.id, w.name, w.created ?? new Date().toISOString()]);
    if (was.operator && !(await controlValue(db, OPERATOR))) await setControlValue(db, OPERATOR, was.operator);
    brought.push(`${was.workspaces?.length ?? 0} workspaces`);
  }
  await setControlValue(db, IMPORTED, true);
  return brought;
}

// ---- a workspace's own types --------------------------------------------

/** The types a workspace defined for itself, in the order they were defined. */
export async function localTypes<T>(db: Q): Promise<T[]> {
  return (await db.query<{ def: T }>(`select def from local_type order by n`)).rows.map((r) => r.def);
}

export async function addLocalType(db: Q, def: { id: string }): Promise<void> {
  await db.query(`insert into local_type (id, def) values ($1, $2::jsonb) on conflict (id) do nothing`, [def.id, JSON.stringify(def)]);
}

/** Bring in a workspace's local pack file, kept in a folder before 19 Oct 2026, the first time its database is opened for it. */
export async function importLocalPack(db: Q, file: string): Promise<number> {
  if (await controlValue(db, LOCAL_IMPORTED)) return 0;
  const types = existsSync(file) ? ((JSON.parse(readFileSync(file, 'utf8')) as { types?: { id: string }[] }).types ?? []) : [];
  for (const def of types) await addLocalType(db, def);
  await setControlValue(db, LOCAL_IMPORTED, true);
  return types.length;
}

// ---- what a server pack keeps (src/server-host.ts) ----------------------

/** Step 8 of the schema: keys and values a server pack keeps, each pack its own, some until a time. */
export const PACK_STORE = `
create table if not exists pack_store (
  pack  text not null,
  key   text not null,
  value jsonb not null,
  until timestamptz,
  primary key (pack, key)
);
alter table pack_store enable row level security;`;

export async function storeGet<T>(db: Q, pack: string, key: string): Promise<T | undefined> {
  const { rows } = await db.query<{ value: T }>(`select value from pack_store where pack = $1 and key = $2 and (until is null or until >= now())`, [pack, key]);
  return rows[0]?.value;
}

/** Keep a value, for `ms` or for good, in place of what was there; what has run out is cleared as it goes. */
export async function storePut(db: Q, pack: string, key: string, value: unknown, ms?: number): Promise<void> {
  await db.query(`delete from pack_store where until < now()`);
  await db.query(
    `insert into pack_store (pack, key, value, until) values ($1, $2, $3::jsonb, case when $4::float8 is null then null else now() + make_interval(secs => $4::float8) end)
     on conflict (pack, key) do update set value = excluded.value, until = excluded.until`,
    [pack, key, JSON.stringify(value ?? null), ms === undefined ? null : ms / 1000],
  );
}

/** What a pack keeps under a prefix, in the order of its keys, up to `most` of them. */
export async function storeList<T>(db: Q, pack: string, prefix: string, most: number): Promise<{ key: string; value: T }[]> {
  const { rows } = await db.query<{ key: string; value: T }>(`select key, value from pack_store where pack = $1 and starts_with(key, $2) and (until is null or until >= now()) order by key collate "C" limit $3`, [pack, prefix, most]);
  return rows;
}

/** A value given once: taken away as it is read, by whichever call asks first. */
export async function storeTake<T>(db: Q, pack: string, key: string): Promise<T | undefined> {
  const { rows } = await db.query<{ value: T; live: boolean }>(`delete from pack_store where pack = $1 and key = $2 returning value, (until is null or until >= now()) as live`, [pack, key]);
  return rows[0]?.live ? rows[0].value : undefined;
}

/**
 * Step 13 of the schema: what the GitHub App kept when it was the kernel's, as its server pack's (packs/github_app).
 * Each installation (step 4's table) becomes a connection, its key and signing secret (still sealed) and its id the
 * pack's secrets, and its name what the pack keeps. Copied, not moved: the code before still reads the old places
 * during a switch. History only: nothing reads the old places now, and a later step may drop them.
 */
export const ADOPT_APP = `
insert into control_value (key, value)
  select 'connection:github_app:' || id, jsonb_build_object('workspace', workspace, 'account', account) from github_installation
  on conflict (key) do nothing;
insert into control_value (key, value)
  select 'pack_secret:github_app:' || k.name, to_jsonb(k.value) from control_value c,
    lateral (values ('key', c.value->>'pem'), ('hook', c.value->>'webhook_secret'), ('app_id', c.value->>'id')) as k (name, value)
  where c.key = 'github_app' and k.value is not null
  on conflict (key) do nothing;
insert into pack_store (pack, key, value)
  select 'github_app', 'app', jsonb_build_object('id', value->'id', 'slug', value->'slug', 'name', value->'name') from control_value where key = 'github_app'
  on conflict (pack, key) do nothing;`;
