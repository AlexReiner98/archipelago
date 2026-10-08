// Backups: each workspace written out as one file of plain rows, so it can be
// read, moved to a Postgres server, or restored into an empty database. A copy
// of the database's files is not a backup: taken while the server runs it may
// not open again, which is how the map was nearly lost on 7 Oct 2026.
//
// Restore, with the server stopped, into a data folder that does not exist yet:
//   node src/backup.ts restore <backup file> <new data folder>

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { openDb, type Db } from './db.ts';
import { LOCAL_PACK } from './packs.ts';
import type { Workspace, Workspaces } from './workspaces.ts';

/** Every table, parents before the rows that point at them. */
const TABLES = ['entity', 'relation', 'event', 'proposal', 'token', 'setting'] as const;

export interface Dump {
  format: 1;
  taken: string;
  workspace: { id: string; name: string };
  /** The types this workspace defined for itself, as its local pack file. */
  local_pack: unknown;
  tables: Record<string, Record<string, unknown>[]>;
}

/** All of a database's rows as they stand at one moment. Give it the unscoped database: a backup hides nothing. */
export async function dump(db: Db, workspace: { id: string; name: string }, localPack?: unknown): Promise<Dump> {
  const tables: Dump['tables'] = {};
  await db.transaction(async (tx) => {
    await tx.query(`set transaction isolation level repeatable read`);
    for (const table of TABLES) tables[table] = (await tx.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from ${table} t`)).rows.map((r) => r.row);
  });
  return { format: 1, taken: new Date().toISOString(), workspace, local_pack: localPack ?? null, tables };
}

/**
 * Put a dump into an empty database. Refuses one that already holds anything.
 * Give `as` when it becomes a workspace under another id: its tokens name the
 * workspace they were made for, so none of them would work there, and they are
 * restored revoked.
 */
export async function restore(db: Db, backup: Dump, as?: string): Promise<Record<string, number>> {
  if (backup?.format !== 1 || typeof backup.tables !== 'object') throw new Error(`This backup is format ${backup?.format}; this version reads format 1.`);
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    for (const table of TABLES) {
      const { rows } = await tx.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      if (rows[0].n) throw new Error(`The database is not empty (${table} has ${rows[0].n} rows). Restore into a new data folder.`);
    }
    for (const table of TABLES) {
      const rows = backup.tables[table] ?? [];
      // One statement per table: rows that point at each other (an entity's owner) are checked together.
      if (rows.length) await tx.query(`insert into ${table} select * from jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
      counts[table] = rows.length;
    }
    await tx.query(`select setval(pg_get_serial_sequence('event', 'seq'), greatest((select coalesce(max(seq), 0) from event), 1))`);
    if (as !== undefined && as !== backup.workspace?.id) {
      for (const table of ['entity', 'relation', 'event', 'proposal']) await tx.query(`update ${table} set workspace = $1`, [as]);
      await tx.query(`update token set revoked_at = now() where revoked_at is null`);
    }
  });
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

/** True of an event that was written here, false of one that arrived in a merged backup: those are history, not news. */
export const notImported = (ev: string) =>
  `not exists (select 1 from event imp where imp.action = 'workspace.import' and ${ev}.seq between (imp.detail->>'first_seq')::bigint and (imp.detail->>'last_seq')::bigint)`;

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
export async function merge(db: Db, backup: Dump, options: { workspace: string; sessionTypes?: string[]; apply?: boolean }): Promise<MergeReport> {
  if (backup?.format !== 1 || typeof backup.tables !== 'object') throw new Error(`This backup is format ${backup?.format}; this version reads format 1.`);
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
      const { rows: cols } = await tx.query<{ set: string }>(`select string_agg(format('%I = excluded.%I', column_name, column_name), ', ') as set from information_schema.columns where table_schema = 'public' and table_name = 'entity' and column_name <> 'id'`);
      // One statement: rows that point at each other (an entity's owner) are checked together.
      await tx.query(`insert into entity select * from jsonb_populate_recordset(null::entity, $1::jsonb) on conflict (id) do update set ${cols[0].set} where excluded.updated_at > entity.updated_at`, [entities]);

      const { rows: rels } = await tx.query<{ added: boolean }>(
        `insert into relation select i.* from jsonb_populate_recordset(null::relation, $1::jsonb) i
         where exists (select 1 from entity where id = i.from_id) and exists (select 1 from entity where id = i.to_id)
         on conflict (id) do update set valid_to = excluded.valid_to where relation.valid_to is null and excluded.valid_to is not null
         returning (xmax = 0) as added`,
        [JSON.stringify(here(relations.filter((r) => !held(r))))],
      );
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

const localPackOf = (ws: Workspace) => {
  const { registry } = ws.lattice;
  const file = registry.localDir ? join(registry.localDir, 'pack.json') : join(registry.dir, LOCAL_PACK, 'pack.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
};

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
  for (const { id, name } of workspaces.list()) {
    // A workspace opened only to be backed up is closed again, or a backup would
    // put every customer's database in memory at once.
    const wasOpen = workspaces.isOpen(id);
    const release = workspaces.hold(id);
    try {
      const ws = await workspaces.get(id);
      const taken = await dump(ws.lattice.db, { id, name }, localPackOf(ws));
      const folder = join(dir, id);
      mkdirSync(folder, { recursive: true });
      const file = join(folder, `${taken.taken.replaceAll(':', '-')}.json.gz`);
      // Written under another name first, so a half-written file is never taken for a backup.
      writeFileSync(`${file}.part`, gzipSync(JSON.stringify(taken)));
      renameSync(`${file}.part`, file);
      const old = readdirSync(folder).filter((f) => f.endsWith('.json.gz')).sort().slice(0, -keep);
      for (const f of old) rmSync(join(folder, f));
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

/** When the newest backup of the default workspace was taken, if there is one. */
export function newestBackup(dir: string, workspace = 'default'): Date | undefined {
  const folder = join(dir, workspace);
  const newest = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.json.gz')).sort().at(-1) : undefined;
  // The file is named for the moment it was taken, with the colons of the time replaced.
  return newest ? new Date(newest.replace('.json.gz', '').replace(/T(\d\d)-(\d\d)-/, 'T$1:$2:')) : undefined;
}

/** A backup file's contents, as written by backupAll. */
export function parseBackup(bytes: Uint8Array): Dump {
  try {
    return JSON.parse(gunzipSync(bytes).toString('utf8')) as Dump;
  } catch {
    throw new Error('That is not a Lattice backup file (a .json.gz written by the server).');
  }
}

export function readBackup(file: string): Dump {
  return parseBackup(readFileSync(file));
}

if (import.meta.main) {
  const [command, file, target] = process.argv.slice(2);
  if (command !== 'restore' || !file || !target) {
    console.error('Usage: node src/backup.ts restore <backup file> <new data folder>');
    process.exit(1);
  }
  if (existsSync(target)) {
    console.error(`${target} already exists. Restore into a folder that does not, then put it in place with the server stopped.`);
    process.exit(1);
  }
  const backup = readBackup(file);
  const db = await openDb(target);
  const counts = await restore(db, backup);
  await db.close();
  console.log(`Restored workspace "${backup.workspace.name}" (${backup.workspace.id}) as of ${backup.taken} into ${target}`);
  console.log(Object.entries(counts).map(([table, n]) => `${table}: ${n}`).join(', '));
  if (backup.local_pack) console.log('This workspace defined types of its own. They are in the backup under "local_pack"; write them to its local pack file.');
}
