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

/** Put a dump into an empty database. Refuses one that already holds anything. */
export async function restore(db: Db, backup: Dump): Promise<Record<string, number>> {
  if (backup.format !== 1) throw new Error(`This backup is format ${backup.format}; this version reads format 1.`);
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
  });
  return counts;
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

export function readBackup(file: string): Dump {
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as Dump;
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
