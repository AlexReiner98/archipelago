// The backup pack's half of what src/backup.ts held (docs/kernel-packs.md, "Where each module goes": backup's
// backupAll, upload and merge): every workspace backed up into files on a clock and a copy sent off the server, the
// vault's backups kept beside them, and a backup merged into a map that already holds one. Dump and restore, the copy
// of the record itself, stay with the log (src/backup.ts).
//
// Not yet ctx calls: each reads the unscoped database or every workspace, which no root pack offers a service pack
// through its context (a root provides no service name, src/manifest.ts). Its kernel imports are named in the step's
// report (e_jjvdu795) with what each would become.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Db } from '../../../src/db.ts';
import { restoreRows } from '../../../src/pelago.ts';
import { regatherAll } from '../../../src/closure.ts';
import { recountBytes } from '../../../src/bytes.ts';
import { mentionedAll } from '../../../src/mentions.ts';
import { analyzeDue } from '../../../src/stats.ts';
import { bringIn } from '../../../src/activity.ts';
import { dump, localPackOf, opened, type Dump } from '../../../src/backup.ts';
import { dumpVault, VAULT_BACKUP_DAYS, type VaultDump } from '../../../src/vault.ts';
import type { Workspaces } from '../../../src/workspaces.ts';

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
      const seqs = await bringIn(tx, options.workspace, [], backup.tables.event ?? []);
      const { rows: owner } = await tx.query(
        `insert into setting (key, value) select 'me', $1::jsonb where exists (select 1 from entity where to_jsonb(id) = $1::jsonb) on conflict (key) do nothing returning key`,
        [JSON.stringify(backup.tables.setting?.find((s) => s.key === 'me')?.value ?? null)],
      );
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

/** When the newest backup of the default workspace was taken, if there is one. */
export function newestBackup(dir: string, workspace = 'default'): Date | undefined {
  const folder = join(dir, workspace);
  const newest = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.json.gz')).sort().at(-1) : undefined;
  // The file is named for the moment it was taken, with the colons of the time replaced.
  return newest ? new Date(newest.replace('.json.gz', '').replace(/T(\d\d)-(\d\d)-/, 'T$1:$2:')) : undefined;
}
