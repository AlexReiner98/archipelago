// Backups: each workspace written out as one file of plain rows, so it can be
// read, moved to a Postgres server, or restored into an empty database. A copy
// of the database's files is not a backup: taken while the server runs it may
// not open again, which is how the map was nearly lost on 7 Oct 2026.
//
// Restore, with the server stopped, into a data folder that does not exist yet, or into an empty database on a
// Postgres server (the address the server is given as PELAGO_DATABASE_URL; a workspace other than the default one
// goes in that database's own beside it, as the server looks for it):
//   node src/backup.ts restore <backup file> <new data folder | postgres://...> [vault backup file]
//
// What the map's rows say is sealed in the file with each item's key (src/backup-seal.ts), and the keys are backed up
// apart, kept 30 days (src/vault.ts): a backup is read with the vault as it is when it is restored, or with a vault
// backup given beside it, on a server with the same sealing key. What was forgotten since it was taken stays out.
//
// Backing every workspace up on a clock, sending a copy off the server and merging a backup into a map are the backup
// pack's (packs/backup/kernel/backup-run.ts): this module is the copy of the record and its way back.
//
// Since format 3 a backup is the log and a snapshot (src/backup-log.ts): the log's rows whole, the newest snapshot of
// the projections, and only what the log does not say. Items, links and the review queue are made again from them.

import { isSealed, seal, SECRET_SETTINGS } from '../../../src/secrets.ts';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { isServer, openDb, type Db, type Q } from '../../../src/db.ts';
import { addLocalType, addWorkspace } from '../../../src/control.ts';
import { indexWorkspace } from '../../../src/control-index.ts';
import type { Registry } from '../../../src/packs.ts';
import { regatherAll } from './closure.ts';
import { recountBytes } from '../../../src/bytes.ts';
import { mentionedAll } from '../../../src/mentions.ts';
import { databaseFor } from '../../../src/pg.ts';
import { analyzeAll, analyzeDue } from '../../../src/stats.ts';
import { FACT_ACTIONS, factEvents } from '../../../src/eventlog.ts';
import { bringIn, CARRIED, carryRows, doneEvents, type EventRow } from './activity.ts';
import { openTables, sealTables, sealedDump } from '../../../src/backup-seal.ts';
import { projectBackup } from './backup-log.ts';
import { liveSnapshot } from './snapshot.ts';
import { dumpVault, restoreVault, type VaultDump } from '../../../src/vault.ts';
import { restoreRows } from '../../../src/pelago.ts';
import type { RootCall } from '../../../src/root-calls.ts';
import { makePartitions } from './partitions.ts';

/** Every table, parents before the rows that point at them. */
const TABLES = ['entity', 'relation', 'proposal', 'token', 'share', 'setting', 'picture', 'type_def', 'act', 'member', 'published', 'public_view', 'log_entry', 'log_fact', 'log_op'] as const;
/** What the log makes, and a backup since format 3 does not carry but makes again. */
const PROJECTIONS: readonly string[] = ['entity', 'relation', 'proposal'];

export interface Dump {
  /** 1: rows in clear, as written before keys were; 2: sealed, read with the vault; 3: the log and a snapshot, sealed. */
  format: 1 | 2 | 3;
  taken: string;
  workspace: { id: string; name: string };
  /** The types this workspace defined for itself, as its local pack file. */
  local_pack: unknown;
  tables: Record<string, Record<string, unknown>[]>;
  /** A backup of the vault given beside the file, never written into it: what a restore opens the rows with. */
  vault?: VaultDump;
  /** Format 3: the projections at the head of the log, as a snapshot (src/snapshot.ts, liveSnapshot). */
  snapshot?: Record<string, unknown> | null;
}

/** All of a database's rows as they stand at one moment. Give it the unscoped database: a backup hides nothing. */
export async function dump(db: Db, workspace: { id: string; name: string }, localPack?: unknown): Promise<Dump> {
  const tables: Dump['tables'] = {};
  let snapshot: Record<string, unknown> | undefined;
  await db.transaction(async (tx) => {
    await tx.query(`set transaction isolation level repeatable read`);
    for (const table of TABLES.filter((t) => !PROJECTIONS.includes(t))) tables[table] = (await tx.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from ${table} t`)).rows.map((r) => r.row);
    // The projections go in as one snapshot of them at the head of the log, sealed, hashed and anchored to it.
    snapshot = await liveSnapshot(tx, workspace.id);
    // A merge does not take another map's log, so what its change sets did goes in as well, as the events it reads
    // as (a restore leaves those out). There is no event table since step 34: these are all a backup's events.
    // What was done outside change sets is in log_op, read the same way: a restore leaves those out too.
    const done = [...(await factEvents(tx, {}, Number.MAX_SAFE_INTEGER)), ...(await doneEvents(tx, {}, Number.MAX_SAFE_INTEGER))];
    tables.event = done.map(({ target_title: _t, target_type: _y, ...ev }) => ({ ...ev, workspace: workspace.id, private_to: null }));
    await sealTables(tx, workspace.id, tables);
  });
  // A secret stored before secrets were sealed has not been read since, and so is still as it was typed: it does not leave like that.
  for (const row of tables.setting ?? []) if (SECRET_SETTINGS.includes(row.key as string) && typeof row.value === 'string' && !isSealed(row.value)) row.value = seal(row.value);
  return { format: 3, taken: new Date().toISOString(), workspace, local_pack: localPack ?? null, tables, snapshot: snapshot ?? null };
}

/**
 * A backup's rows as they read here, in clear: a sealed one opened with the vault backup given beside it and this
 * database's own. `keep`: that vault backup goes into this database's vault, as what it opens comes in with it.
 */
export async function opened(tx: Q, backup: Dump, keep: boolean): Promise<Dump> {
  if (backup?.vault && keep) await restoreVault(tx, backup.vault);
  if (backup?.format === 1 && typeof backup.tables === 'object') return backup;
  if (!sealedDump(backup?.format) || typeof backup.tables !== 'object') throw new Error(`This backup is format ${backup?.format}; this version reads formats 1 to 3.`);
  const { tables, left_out } = await openTables(tx, structuredClone(backup.tables), backup.vault);
  if (backup.format === 3) {
    // The projections are its snapshot, with what the log says after it projected on; the log alone when the
    // snapshot cannot be built on (other projector code, or not anchored to this log).
    const made = await projectBackup(tx, tables, backup.snapshot ?? undefined, backup.vault);
    if (made.left_out && !made.rows.entity.length) throw new Error('This backup is sealed: give the backup of the key vault taken with it, on a server with the same sealing key.');
    const ids = new Set(made.rows.entity.map((r) => r.id));
    Object.assign(tables, made.rows);
    for (const t of ['picture', 'share', 'published', 'public_view']) tables[t] = (tables[t] ?? []).filter((r) => ids.has(r.entity_id));
    return { ...backup, format: 1, tables };
  }
  if (left_out && left_out === backup.tables.entity?.length) throw new Error('This backup is sealed: give the backup of the key vault taken with it, on a server with the same sealing key.');
  return { ...backup, format: 1, tables };
}

/** A backup with its rows in clear, to read before it is restored or merged: nothing is written. */
export const readable = (db: Db, backup: Dump) => db.transaction((tx) => opened(tx, backup, false));

/**
 * Put a dump into an empty database. Refuses one that already holds anything.
 * Give `as` when it becomes a workspace under another id: its tokens name the
 * workspace they were made for, so none of them would work there, and they are
 * restored revoked.
 */
export async function restore(db: Db, given: Dump, as?: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    for (const table of TABLES) {
      const { rows } = await tx.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      if (rows[0].n) throw new Error(`The database is not empty (${table} has ${rows[0].n} rows). Restore into a new data folder.`);
    }
    const backup = await opened(tx, given, true);
    // What a change set in the file's log did is read from that log again: its events are not rows.
    const logged = new Set((backup.tables.log_entry ?? []).map((e) => e.id as string));
    // And what log_op holds is read from there: an event row numbered as one of its entries is that entry, for a merge.
    const numbered = new Set((backup.tables.log_op ?? []).map((o) => Number(o.seq)).filter((n) => n > 0));
    // A backup from before 9 Nov 2026 holds the event table: its rows not yet in the activity stream are carried into
    // it once the stream is in (src/activity.ts), as step 34 carried the table's own.
    const events = (backup.tables.event ?? []).filter((ev) => !(logged.has(ev.changeset as string) && FACT_ACTIONS.includes(ev.action as string)) && !numbered.has(Number(ev.seq)));
    // The log goes into the years it was written in, in order: each entry follows the one before (src/partitions.ts),
    // the compacted streams' too, whose rows a forget has rewritten out of their order on disk.
    const logAt = new Map((backup.tables.log_entry ?? []).map((e) => [`${e.stream} ${e.pos}`, e.at]));
    for (const f of backup.tables.log_fact ?? []) f.at ??= logAt.get(`${f.stream} ${f.pos}`);
    for (const table of ['log_entry', 'log_fact', 'log_op'] as const) backup.tables[table]?.sort((a, b) => String(a.stream).localeCompare(String(b.stream)) || Number(a.pos) - Number(b.pos) || Number(a.n ?? 0) - Number(b.n ?? 0));
    const first = [...logAt.values(), ...(backup.tables.log_op ?? []).map((o) => o.at)].reduce((min: number, at) => Math.min(min, new Date(at as string).getTime()), Infinity);
    if (Number.isFinite(first)) await makePartitions(tx, new Date(first));
    for (const table of TABLES) {
      const rows = backup.tables[table] ?? [];
      // One statement per table: rows that point at each other (an entity's owner) are checked together.
      if (rows.length) await tx.query(`insert into ${table} select * from jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
      counts[table] = rows.length;
    }
    counts.event = await carryRows(tx, as ?? given.workspace?.id ?? 'default', [], events as unknown as EventRow[]);
    await tx.query(`delete from setting where key = $1`, [CARRIED]);
    await tx.query(`select setval('event_seq_seq', greatest((select coalesce(max(seq), 0) from log_fact), (select coalesce(max(seq), 0) from log_op where seq is not null), 1)) -- index log_fact_seq, log_op_seq`);
    // What is inside what is a projection of the links just written: made again whole.
    await regatherAll(tx, ['part_of']);
    await mentionedAll(tx);
    await recountBytes(tx);
    // The types it defined for itself go in its database, where the server looks for them.
    for (const def of (given.local_pack as { types?: { id: string }[] } | null)?.types ?? []) await addLocalType(tx, def);
    if (as !== undefined && as !== given.workspace?.id) {
      for (const table of ['entity', 'relation', 'proposal', 'share', 'picture', 'act', 'published', 'public_view']) await tx.query(`update ${table} set workspace = $1`, [as]);
      await tx.query(`update token set revoked_at = now() where revoked_at is null`);
    }
  });
  // Nearly every row is new: without statistics the planner would take the map for empty (src/stats.ts).
  await analyzeAll(db);
  return counts;
}

export { notImported } from '../../../src/eventlog.ts';

/** The types a workspace defined for itself, as a local pack file, if it has any. */
export const localPackOf = (registry: Registry) => registry.localPack();

/** A vault backup file's contents, as backupVault wrote it. */
export const parseVault = (bytes: Uint8Array): VaultDump => JSON.parse(gunzipSync(bytes, { maxOutputLength: BACKUP_MAX }).toString('utf8')) as VaultDump;
export const readVault = (file: string) => parseVault(readFileSync(file));

/** The most a backup may unpack to: a small file can be made that unpacks to more memory than the server has. */
const BACKUP_MAX = 256_000_000;

/** A backup file's contents, as written by backupAll. */
export function parseBackup(bytes: Uint8Array): Dump {
  let text: string;
  try {
    text = gunzipSync(bytes, { maxOutputLength: BACKUP_MAX }).toString('utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new Error(`That file unpacks to more than ${BACKUP_MAX / 1_000_000} MB, which is more than a backup is taken to be.`);
    throw new Error('That is not an Archipelago backup file (a .json.gz written by the server).');
  }
  try {
    return JSON.parse(text) as Dump;
  } catch {
    throw new Error('That is not an Archipelago backup file (a .json.gz written by the server).');
  }
}

export function readBackup(file: string): Dump {
  return parseBackup(readFileSync(file));
}

/**
 * Restore a backup from the command line: into a data folder that does not exist yet, or into a Postgres server
 * (postgres://...), where the default workspace goes in the database named and any other in its own beside it.
 * Answers with where it went, without the server's password, and how many rows of each table.
 */
export async function restoreTo(backup: Dump, target: string): Promise<{ where: string; counts: Record<string, number> }> {
  const id = backup?.workspace?.id ?? 'default';
  if (!isServer(target) && existsSync(target)) throw new Error(`${target} already exists. Restore into a folder that does not, then put it in place with the server stopped.`);
  const where = !isServer(target) ? target : id === 'default' ? target : await databaseFor(target, id);
  const db = await openDb(where);
  try {
    const counts = await restore(db, backup);
    // Another workspace is listed in the default one's database, where every server on it looks; and there its members
    // and tokens are noted, so they sign in (src/control-index.ts). A new folder has no index yet, and makes it whole.
    if (isServer(target)) {
      const control = id === 'default' ? db : await openDb(target);
      try {
        if (id !== 'default') await addWorkspace(control, { id, name: backup.workspace?.name ?? id });
        await indexWorkspace(control, id, db);
      } finally {
        if (control !== db) await control.close();
      }
    }
    return { where: isServer(where) ? `database ${new URL(where).pathname.slice(1)} on ${new URL(where).host}` : where, counts };
  } finally {
    await db.close();
  }
}

// The log's root services (docs/kernel-packs.md, "Root services"), called only by the packs packs/roots.json names
// for each (the backup pack): values in, values out, never a handle on the database.

/**
 * root.dump: a workspace's backup and its vault's, for a server duty that walks every workspace. The workspace is held
 * open while it is read and closed again if it was opened for this, so a backup never keeps every map in memory.
 */
export async function dumpOf(call: RootCall, input: { workspace: string; name: string }): Promise<{ dump: Dump; vault?: VaultDump; vault_error?: string }> {
  const ws = call.workspaces;
  if (!ws) throw new Error('root.dump is a server duty: it reads a workspace whole, and no map asks it');
  const wasOpen = ws.isOpen(input.workspace);
  const release = ws.hold(input.workspace);
  try {
    const { pelago } = await ws.get(input.workspace);
    const taken = await dump(pelago.db, { id: input.workspace, name: input.name }, localPackOf(pelago.registry));
    // The backup stands if the vault's fails: its caller writes it first, then says why the vault's did not come.
    return await dumpVault(pelago.db).then((vault) => ({ dump: taken, vault }), (err: Error) => ({ dump: taken, vault_error: err.message }));
  } finally {
    release();
    if (!wasOpen) await ws.closeIfUnused(input.workspace).catch(() => false);
  }
}

/** What merging a backup did to the map's rows, or would do: the backup pack makes its report from it. */
export interface Merged {
  from: { id: string; name: string };
  taken: string;
  /** Each item of the file, newest first, and what becomes of it here. */
  plan: { title: string; what: 'added' | 'updated' | 'kept_newer_here' | 'same' }[];
  relations: { added: boolean }[];
  proposals: { added: boolean }[];
  /** The positions its events took in this map's activity stream. */
  events: number[];
  owner_set: boolean;
  open_sessions: number;
  holds: number;
}

class Preview extends Error {}

/**
 * root.merge: a dump merged into the map that asks, matching rows by id. Nothing is deleted. An entity on both sides
 * keeps whichever was edited later, as a whole. A relation ended on either side is ended; a proposal decided on either
 * side is decided. Events the map does not have are added after its own, keeping their times. Tokens and settings stay
 * as they are here, except that a map with no owner takes the file's. Sessions still open in the file (of
 * `session_types`), and what they hold, are left out. Without `apply` it changes nothing. The map is the whole one.
 */
export async function mergeOf(call: RootCall, input: { dump: Dump; session_types?: string[]; apply?: boolean }): Promise<Merged> {
  const l = call.map;
  if (!l || l.viewer !== undefined) throw new Error('root.merge writes the whole map: call it from the whole map, not one person’s view');
  const { db, workspace } = l;
  const backup = await db.transaction((tx) => opened(tx, input.dump, Boolean(input.apply)));
  const here = (rows: Record<string, unknown>[] = []) => rows.map((row) => ({ ...row, workspace }));
  const openSession = (e: Record<string, unknown>) => Boolean(input.session_types?.includes(e.type as string) && e.is_open);
  const all = backup.tables.entity ?? [];
  const entities = JSON.stringify(here(all.filter((e) => !openSession(e))));
  const held = (r: Record<string, unknown>) => r.type === 'holds' && r.valid_to == null;
  const relations = backup.tables.relation ?? [];
  const me = backup.tables.setting?.find((s) => s.key === 'me')?.value ?? null;
  let merged!: Merged;
  try {
    await db.transaction(async (tx) => {
      const { rows: plan } = await tx.query<Merged['plan'][number]>(
        `select i.title, case when e.id is null then 'added' when i.updated_at > e.updated_at then 'updated' when e.updated_at > i.updated_at then 'kept_newer_here' else 'same' end as what
         from jsonb_populate_recordset(null::entity, $1::jsonb) i left join entity e on e.id = i.id order by i.updated_at desc`,
        [entities],
      );
      const rels = await restoreRows(tx, entities, JSON.stringify(here(relations.filter((r) => !held(r)))));
      await regatherAll(tx, ['part_of']);
      await mentionedAll(tx);
      await recountBytes(tx);
      const { rows: props } = await tx.query<{ added: boolean }>(
        `insert into proposal select * from jsonb_populate_recordset(null::proposal, $1::jsonb)
         on conflict (id) do update set status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at, note = excluded.note
         where proposal.status = 'pending' and excluded.status <> 'pending'
         returning (xmax = 0) as added`,
        [JSON.stringify(here(backup.tables.proposal))],
      );
      // Its events go in the activity stream, after this map's own (src/activity.ts): each once.
      const events = await bringIn(tx, workspace, [], backup.tables.event ?? []);
      // The file's owner, if this map has none and the person is on it: read by the id, as only an id names an item.
      const { rows: owner } = await tx.query(
        `insert into setting (key, value) select 'me', $1::jsonb where exists (select 1 from entity where id = $2) on conflict (key) do nothing returning key`,
        [JSON.stringify(me), typeof me === 'string' ? me : null],
      );
      merged = { from: backup.workspace, taken: backup.taken, plan, relations: rels, proposals: props, events, owner_set: owner.length > 0, open_sessions: all.filter(openSession).length, holds: relations.filter(held).length };
      // Looking only: undo all of it.
      if (!input.apply) throw new Preview();
    });
  } catch (err) {
    if (!(err instanceof Preview)) throw err;
  }
  if (input.apply) await analyzeDue(db);
  return merged;
}

// Run as `node src/backup.ts restore ...` too, through the shim the wave leaves there.
const ranAs = process.argv[1] ? resolve(process.argv[1]) : '';
if (import.meta.main || ranAs === resolve(import.meta.dirname, '../../../src/backup.ts')) {
  const [command, file, target, vault] = process.argv.slice(2);
  if (command !== 'restore' || !file || !target) {
    console.error('Usage: node src/backup.ts restore <backup file> <new data folder | postgres://...> [vault backup file]');
    process.exit(1);
  }
  const backup = { ...readBackup(file), ...(vault && { vault: readVault(vault) }) };
  const done = await restoreTo(backup, target).catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
  console.log(`Restored workspace "${backup.workspace.name}" (${backup.workspace.id}) as of ${backup.taken} into ${done.where}`);
  console.log(Object.entries(done.counts).map(([table, n]) => `${table}: ${n}`).join(', '));
  if (backup.workspace.id !== 'default' && !isServer(target)) console.log(`A server finds it once it is listed: create the workspace from this backup through the operator instead (POST /operator/workspaces).`);
}
