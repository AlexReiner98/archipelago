// The backup pack's half of what src/backup.ts held (docs/kernel-packs.md, "Where each module goes": backup's
// backupAll, upload and merge): every workspace backed up into files on a clock and a copy sent off the server, the
// vault's backups kept beside them, and a backup merged into a map that already holds one. Dump and restore, the copy
// of the record itself, stay with the log (src/backup.ts).
//
// What only a root may do it asks through the root services packs/roots.json lets it call (docs/kernel-packs.md,
// "Root services"): root.workspaces (identity) for the workspaces, root.dump (log) for a workspace's backup and its
// vault's, root.merge (log) for the writes a merge makes. The files are its own.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { KernelContext } from '#pelago/kernel';

/** How long a vault's backup is kept: the seal's VAULT_BACKUP_DAYS (src/vault.ts), the owner's 30 days (e_98cdhgn6). */
export const VAULT_DAYS = 30;

/** A backup as root.dump answers it: its rows, and when and of what it was taken. */
interface Dump { workspace: { id: string; name: string }; taken: string; tables: Record<string, Record<string, unknown>[]> }
/** A vault's backup as root.dump answers it. */
interface VaultDump { taken: string }

/** What root.merge did to the rows, or would do (src/backup.ts, Merged). */
interface Merged {
  from: { id: string; name: string };
  taken: string;
  plan: { title: string; what: 'added' | 'updated' | 'kept_newer_here' | 'same' }[];
  relations: { added: boolean }[];
  proposals: { added: boolean }[];
  events: number[];
  owner_set: boolean;
  open_sessions: number;
  holds: number;
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

/**
 * Merge a dump into the map the context is of, matching rows by id (root.merge, src/backup.ts, says what it keeps).
 * Without `apply` it changes nothing and reports what it would do. Give it the whole map's context.
 */
export async function merge(ctx: KernelContext, given: Dump, options: { sessionTypes?: string[]; apply?: boolean }): Promise<MergeReport> {
  const done = await ctx.call<unknown, Merged>('root.merge', { dump: given, session_types: options.sessionTypes, apply: options.apply });
  const count = (what: string) => done.plan.filter((p) => p.what === what).length;
  const some = (what: string) => done.plan.filter((p) => p.what === what).slice(0, 20).map((p) => p.title);
  const seqs = done.events;
  return {
    applied: Boolean(options.apply),
    from: done.from,
    taken: done.taken,
    entities: { added: count('added'), updated: count('updated'), kept_newer_here: count('kept_newer_here'), same: count('same') },
    examples: { added: some('added'), updated: some('updated'), kept_newer_here: some('kept_newer_here') },
    relations: { added: done.relations.filter((r) => r.added).length, ended: done.relations.filter((r) => !r.added).length },
    events: { added: seqs.length, first_seq: seqs.length ? seqs.reduce((a, b) => Math.min(a, b)) : null, last_seq: seqs.length ? seqs.reduce((a, b) => Math.max(a, b)) : null },
    proposals: { added: done.proposals.filter((p) => p.added).length, decided: done.proposals.filter((p) => !p.added).length },
    left_out: { open_sessions: done.open_sessions, holds: done.holds },
    owner_set: done.owner_set,
  };
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
 * sent away are not pruned from here. A server duty: its context is the server's.
 */
export async function backupAll(
  ctx: KernelContext,
  dir: string,
  keep: number,
  target?: UploadTarget,
): Promise<{ workspace: string; file?: string; rows?: number; error?: string; copied?: boolean; copy_error?: string }[]> {
  const done = [];
  for (const { id, name } of await ctx.call<unknown, { id: string; name: string }[]>('root.workspaces', {})) {
    try {
      // Read held open, and closed again if it was opened for this (root.dump): never every map in memory at once.
      const { dump: taken, vault, vault_error } = await ctx.call<unknown, { dump: Dump; vault?: VaultDump; vault_error?: string }>('root.dump', { workspace: id, name });
      const folder = join(dir, id);
      mkdirSync(folder, { recursive: true });
      const file = join(folder, `${taken.taken.replaceAll(':', '-')}.json.gz`);
      // Written under another name first, so a half-written file is never taken for a backup.
      writeFileSync(`${file}.part`, gzipSync(JSON.stringify(taken)));
      renameSync(`${file}.part`, file);
      const old = readdirSync(folder).filter((f) => f.endsWith('.json.gz')).sort().slice(0, -keep);
      for (const f of old) rmSync(join(folder, f));
      if (!vault) throw new Error(vault_error ?? 'the vault was not read');
      backupVault(join(folder, 'vault'), vault);
      // The backup stands whether or not the copy gets through; a failed copy is reported beside it.
      const copy = target ? await upload(file, id, target).then(() => ({ copied: true }), (err: Error) => ({ copied: false, copy_error: err.message })) : {};
      done.push({ workspace: id, file, rows: Object.values(taken.tables).reduce((n, rows) => n + rows.length, 0), ...copy });
    } catch (err) {
      done.push({ workspace: id, error: (err as Error).message });
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
    if (now - taken > VAULT_DAYS * 86_400_000) rmSync(join(folder, f));
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

/** Where and how often every workspace is backed up (the server's config), or false for never. */
export type BackupPlan = false | { dir: string; everyHours: number; keep: number; upload?: UploadTarget };

/** How often the server duty asks whether a backup is due. */
export const ASK_MS = 5 * 60_000;

/**
 * The server duty's question, asked while this server leads: every workspace backed up if the newest backup is older
 * than the plan says, going by the newest file, so restarting the server neither skips a backup nor piles them up.
 * Answers whether it ran. Its context is the server's (serverContext).
 */
export async function backupIfDue(ctx: KernelContext, plan: BackupPlan, now = Date.now()): Promise<boolean> {
  if (!plan) return false;
  const { dir, everyHours, keep, upload } = plan;
  const newest = newestBackup(dir);
  if (newest && now - newest.getTime() < everyHours * 3600_000) return false;
  for (const r of await backupAll(ctx, dir, keep, upload)) {
    if (r.error) console.error(`backup of ${r.workspace} FAILED: ${r.error}`);
    else if (r.copied === false) console.error(`backed up ${r.workspace}: ${r.rows} rows, but the copy off the server FAILED: ${r.copy_error}`);
    else console.log(`backed up ${r.workspace}: ${r.rows} rows${r.copied ? ', copied off the server' : ''}`);
  }
  return true;
}

/** The server duty: asked at once and every ASK_MS until what it answers is called. A failure is said, never thrown. */
export function backupDuty(ctx: KernelContext, plan: BackupPlan): () => void {
  const ask = () => void backupIfDue(ctx, plan).catch((err) => console.error('backup failed:', err));
  ask();
  const t = setInterval(ask, ASK_MS).unref();
  return () => clearInterval(t);
}

/** act.capture.backup_merge: a backup merged into the map that asks (the whole map, as the tool surface's import_backup hands it). */
export const mergeAct = (ctx: KernelContext, input: { dump: Dump; session_types?: string[]; apply?: boolean }) => merge(ctx, input.dump, { sessionTypes: input.session_types, apply: input.apply });
