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
// Since format 3 a backup is the log and a snapshot (src/backup-log.ts): the log's rows whole, the newest snapshot of
// the projections, and only what the log does not say. Items, links and the review queue are made again from them.

import { isSealed, seal, SECRET_SETTINGS } from './secrets.ts';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { isServer, openDb, type Db, type Q } from './db.ts';
import { addLocalType, addWorkspace } from './control.ts';
import type { Registry } from './packs.ts';
import { restoreRows } from './pelago.ts';
import { databaseFor } from './pg.ts';
import { analyzeAll, analyzeDue } from './stats.ts';
import { FACT_ACTIONS, factEvents } from './eventlog.ts';
import { openTables, sealTables, sealedDump } from './backup-seal.ts';
import { projectBackup } from './backup-log.ts';
import { liveSnapshot } from './snapshot.ts';
import { dumpVault, restoreVault, VAULT_BACKUP_DAYS, type VaultDump } from './vault.ts';
import type { Workspaces } from './workspaces.ts';

/** Every table, parents before the rows that point at them. */
const TABLES = ['entity', 'relation', 'event', 'proposal', 'token', 'share', 'setting', 'picture', 'type_def', 'act', 'member', 'published', 'log_entry', 'log_fact'] as const;
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
    // as (a restore leaves those out).
    const done = await factEvents(tx, {}, Number.MAX_SAFE_INTEGER);
    tables.event.push(...done.map(({ target_title: _t, target_type: _y, ...ev }) => ({ ...ev, workspace: workspace.id, private_to: null })));
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
async function opened(tx: Q, backup: Dump, keep: boolean): Promise<Dump> {
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
    for (const t of ['picture', 'share', 'published']) tables[t] = (tables[t] ?? []).filter((r) => ids.has(r.entity_id));
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
    backup.tables.event = (backup.tables.event ?? []).filter((ev) => !(logged.has(ev.changeset as string) && FACT_ACTIONS.includes(ev.action as string)));
    for (const table of TABLES) {
      const rows = backup.tables[table] ?? [];
      // One statement per table: rows that point at each other (an entity's owner) are checked together.
      if (rows.length) await tx.query(`insert into ${table} select * from jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
      counts[table] = rows.length;
    }
    await tx.query(`select setval(pg_get_serial_sequence('event', 'seq'), greatest((select coalesce(max(seq), 0) from event), (select coalesce(max(seq), 0) from log_fact), 1))`);
    // The types it defined for itself go in its database, where the server looks for them.
    for (const def of (given.local_pack as { types?: { id: string }[] } | null)?.types ?? []) await addLocalType(tx, def);
    if (as !== undefined && as !== given.workspace?.id) {
      for (const table of ['entity', 'relation', 'event', 'proposal', 'share', 'picture', 'act', 'published']) await tx.query(`update ${table} set workspace = $1`, [as]);
      await tx.query(`update token set revoked_at = now() where revoked_at is null`);
    }
  });
  // Nearly every row is new: without statistics the planner would take the map for empty (src/stats.ts).
  await analyzeAll(db);
  return counts;
}

/** What merging a backup into a map did, or would do. */
export interface MergeReport {
  applied: boolean;
  from: { id: string; name: string };
  taken: string;
  entities: { added: number; updated: number; kept_newer_here: number; same: number };
  /** Up to twenty of each, to show what the numbers mean. */
  examples: { added: string[]; updated: string[]; kept_newer_here: string[] };
  relations: { added: number; ended: number };
  events: { added: number; first_seq: number | null; last_seq: number | null };
  proposals: { added: number; decided: number };
  /** Sessions still open where the file came from, and what they hold: they belong to that machine. */
  left_out: { open_sessions: number; holds: number };
  owner_set: boolean;
}

class Preview extends Error {}

export { notImported } from './eventlog.ts';

/**
 * Merge a dump into a database that already holds a map, matching rows by id.
 * Nothing is deleted. An entity on both sides keeps whichever was edited
 * later, as a whole: there is no common ancestor to merge fields against. A
 * relation ended on either side is ended. A proposal decided on either side
 * is decided. Events the map does not have are added after its own, keeping
 * their times. Tokens and settings stay as they are here, except that a map
 * with no owner takes the file's. Sessions still open in the file, and what
 * they hold, are left out. Without `apply` it changes nothing and reports
 * what it would do. Give it the unscoped database.
 */
export async function merge(db: Db, given: Dump, options: { workspace: string; sessionTypes?: string[]; apply?: boolean }): Promise<MergeReport> {
  const backup = await db.transaction((tx) => opened(tx, given, Boolean(options.apply)));
  const here = (rows: Record<string, unknown>[] = []) => rows.map((row) => ({ ...row, workspace: options.workspace }));
  const openSession = (e: Record<string, unknown>) => Boolean(options.sessionTypes?.includes(e.type as string) && e.is_open);
  const all = backup.tables.entity ?? [];
  const entities = JSON.stringify(here(all.filter((e) => !openSession(e))));
  const held = (r: Record<string, unknown>) => r.type === 'holds' && r.valid_to == null;
  const relations = backup.tables.relation ?? [];
  let report!: MergeReport;
  try {
    await db.transaction(async (tx) => {
      const { rows: plan } = await tx.query<{ title: string; what: 'added' | 'updated' | 'kept_newer_here' | 'same' }>(
        `select i.title, case when e.id is null then 'added' when i.updated_at > e.updated_at then 'updated' when e.updated_at > i.updated_at then 'kept_newer_here' else 'same' end as what
         from jsonb_populate_recordset(null::entity, $1::jsonb) i left join entity e on e.id = i.id order by i.updated_at desc`,
        [entities],
      );
      const count = (what: string) => plan.filter((p) => p.what === what).length;
      const some = (what: string) => plan.filter((p) => p.what === what).slice(0, 20).map((p) => p.title);
      const rels = await restoreRows(tx, entities, JSON.stringify(here(relations.filter((r) => !held(r)))));
      const { rows: props } = await tx.query<{ added: boolean }>(
        `insert into proposal select * from jsonb_populate_recordset(null::proposal, $1::jsonb)
         on conflict (id) do update set status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at, note = excluded.note
         where proposal.status = 'pending' and excluded.status <> 'pending'
         returning (xmax = 0) as added`,
        [JSON.stringify(here(backup.tables.proposal))],
      );
      // An event is the same one if everything about it but its number is the same.
      const { rows: events } = await tx.query<{ seq: number }>(
        `insert into event (workspace, ts, origin, actor, action, target_id, changeset, reason, detail, private_to)
         select i.workspace, i.ts, i.origin, i.actor, i.action, i.target_id, i.changeset, i.reason, i.detail, i.private_to
         from jsonb_populate_recordset(null::event, $1::jsonb) i
         where (i.target_id is null or exists (select 1 from entity where id = i.target_id))
           and not exists (select 1 from event e where e.ts = i.ts and e.actor = i.actor and e.action = i.action and e.origin = i.origin and e.reason = i.reason and e.detail = i.detail
                           and e.target_id is not distinct from i.target_id and e.changeset is not distinct from i.changeset)
         order by i.seq
         returning seq::int as seq`,
        [JSON.stringify(here(backup.tables.event))],
      );
      const { rows: owner } = await tx.query(
        `insert into setting (key, value) select 'me', $1::jsonb where exists (select 1 from entity where to_jsonb(id) = $1::jsonb) on conflict (key) do nothing returning key`,
        [JSON.stringify(backup.tables.setting?.find((s) => s.key === 'me')?.value ?? null)],
      );
      const seqs = events.map((e) => e.seq);
      report = {
        applied: Boolean(options.apply),
        from: backup.workspace,
        taken: backup.taken,
        entities: { added: count('added'), updated: count('updated'), kept_newer_here: count('kept_newer_here'), same: count('same') },
        examples: { added: some('added'), updated: some('updated'), kept_newer_here: some('kept_newer_here') },
        relations: { added: rels.filter((r) => r.added).length, ended: rels.filter((r) => !r.added).length },
        events: { added: seqs.length, first_seq: seqs.length ? seqs.reduce((a, b) => Math.min(a, b)) : null, last_seq: seqs.length ? seqs.reduce((a, b) => Math.max(a, b)) : null },
        proposals: { added: props.filter((p) => p.added).length, decided: props.filter((p) => !p.added).length },
        left_out: { open_sessions: all.filter(openSession).length, holds: relations.filter(held).length },
        owner_set: owner.length > 0,
      };
      // Looking only: undo all of it.
      if (!options.apply) throw new Preview();
    });
  } catch (err) {
    if (!(err instanceof Preview)) throw err;
  }
  if (options.apply) await analyzeDue(db);
  return report;
}

/**
 * Where a copy of each backup is sent, off the server: an address that takes
 * a file by POST with a bearer key. Supabase Storage is one:
 * https://<project>.supabase.co/storage/v1/object/<bucket>
 */
export interface UploadTarget {
  url: string;
  key: string;
}

async function upload(file: string, workspace: string, target: UploadTarget): Promise<void> {
  const res = await fetch(`${target.url.replace(/\/$/, '')}/${workspace}/${basename(file)}`, {
    method: 'POST',
    // Supabase's gateway wants the key as `apikey` as well as in the bearer header.
    headers: { authorization: `Bearer ${target.key}`, apikey: target.key, 'content-type': 'application/gzip', 'x-upsert': 'true' },
    body: readFileSync(file),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** The types a workspace defined for itself, as a local pack file, if it has any. */
export const localPackOf = (registry: Registry) => registry.localPack();

/**
 * Back up every workspace into `dir/<workspace>/<time>.json.gz`, keeping the
 * newest `keep` of each, and send a copy of each new file to `target` when
 * there is one. One that fails is reported and the rest still run. Copies
 * sent away are not pruned from here.
 */
export async function backupAll(
  workspaces: Workspaces,
  dir: string,
  keep: number,
  target?: UploadTarget,
): Promise<{ workspace: string; file?: string; rows?: number; error?: string; copied?: boolean; copy_error?: string }[]> {
  const done = [];
  for (const { id, name } of await workspaces.list()) {
    // A workspace opened only to be backed up is closed again, or a backup would
    // put every customer's database in memory at once.
    const wasOpen = workspaces.isOpen(id);
    const release = workspaces.hold(id);
    try {
      const ws = await workspaces.get(id);
      const taken = await dump(ws.pelago.db, { id, name }, localPackOf(ws.pelago.registry));
      const folder = join(dir, id);
      mkdirSync(folder, { recursive: true });
      const file = join(folder, `${taken.taken.replaceAll(':', '-')}.json.gz`);
      // Written under another name first, so a half-written file is never taken for a backup.
      writeFileSync(`${file}.part`, gzipSync(JSON.stringify(taken)));
      renameSync(`${file}.part`, file);
      const old = readdirSync(folder).filter((f) => f.endsWith('.json.gz')).sort().slice(0, -keep);
      for (const f of old) rmSync(join(folder, f));
      backupVault(join(folder, 'vault'), await dumpVault(ws.pelago.db));
      // The backup stands whether or not the copy gets through; a failed copy is reported beside it.
      const copy = target ? await upload(file, id, target).then(() => ({ copied: true }), (err: Error) => ({ copied: false, copy_error: err.message })) : {};
      done.push({ workspace: id, file, rows: Object.values(taken.tables).reduce((n, rows) => n + rows.length, 0), ...copy });
    } catch (err) {
      done.push({ workspace: id, error: (err as Error).message });
    } finally {
      release();
      if (!wasOpen) await workspaces.closeIfUnused(id).catch(() => false);
    }
  }
  return done;
}

/**
 * The vault, backed up apart from the map, beside it in `vault/`: kept 30 days and then deleted, so a forgotten item
 * can be brought back for 30 days at most (the owner, e_98cdhgn6). Never sent off the server with the map's copies.
 */
export function backupVault(folder: string, vault: VaultDump, now = Date.now()): string {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${vault.taken.replaceAll(':', '-')}.json.gz`);
  writeFileSync(`${file}.part`, gzipSync(JSON.stringify(vault)));
  renameSync(`${file}.part`, file);
  for (const f of readdirSync(folder).filter((f) => f.endsWith('.json.gz'))) {
    const taken = new Date(f.replace('.json.gz', '').replace(/T(\d\d)-(\d\d)-/, 'T$1:$2:')).getTime();
    if (now - taken > VAULT_BACKUP_DAYS * 86_400_000) rmSync(join(folder, f));
  }
  return file;
}

/** A vault backup file's contents, as backupVault wrote it. */
export const parseVault = (bytes: Uint8Array): VaultDump => JSON.parse(gunzipSync(bytes, { maxOutputLength: BACKUP_MAX }).toString('utf8')) as VaultDump;
export const readVault = (file: string) => parseVault(readFileSync(file));

/** When the newest backup of the default workspace was taken, if there is one. */
export function newestBackup(dir: string, workspace = 'default'): Date | undefined {
  const folder = join(dir, workspace);
  const newest = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.json.gz')).sort().at(-1) : undefined;
  // The file is named for the moment it was taken, with the colons of the time replaced.
  return newest ? new Date(newest.replace('.json.gz', '').replace(/T(\d\d)-(\d\d)-/, 'T$1:$2:')) : undefined;
}

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
    const dump = JSON.parse(text) as Dump;
    // A backup written while this was called Lattice says so on each event of its own.
    for (const event of dump.tables?.event ?? []) if (event.origin === 'lattice') event.origin = 'pelago';
    return dump;
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
    // Another workspace is listed in the default one's database, where every server on it looks.
    if (isServer(target) && id !== 'default') {
      const control = await openDb(target);
      await addWorkspace(control, { id, name: backup.workspace?.name ?? id }).finally(() => control.close());
    }
    return { where: isServer(where) ? `database ${new URL(where).pathname.slice(1)} on ${new URL(where).host}` : where, counts: await restore(db, backup) };
  } finally {
    await db.close();
  }
}

if (import.meta.main) {
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
