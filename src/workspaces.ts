// Tenancy: one database per customer. Each workspace has its own database,
// its own locally defined types and its own automation runner, so one
// customer's map cannot leak into another's by a missed filter: there is no
// shared table to filter. Which workspaces there are is kept in the default
// workspace's database (src/control.ts), so every server on it agrees.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { hashSecret, newSecret, OPERATOR_RESET_FILE, sameSecret, validWorkspaceId } from './auth.ts';
import { Automations } from './automations.ts';
import { restore, type Dump } from './backup.ts';
import { addLocalType, addWorkspace, claimControlValue, controlValue, importControlFiles, importLocalPack, listWorkspaces, localTypes, OPERATOR, OPERATOR_RESET, removeWorkspace, setControlValue, takeControlValue } from './control.ts';
import { startSchedules, stopSchedules } from './hooks.ts';
import { openDb, type Database } from './db.ts';
import { databaseFor, dropDatabaseFor } from './pg.ts';
import { dueForDeletion, setEnded } from './ended.ts';
import { Archipelago, type Policy } from './pelago.ts';
import { LOCAL_PACK, Registry, type TypeDef } from './packs.ts';
import { followPacks, packsOff, syncPacks } from './packstate.ts';
import { hostFor } from './packtools.ts';
import { syncTypes } from './typetable.ts';
import { onTypesChanged, typeItems } from './type-items.ts';

// The type table follows the types kept on the map as it follows the packs.
onTypesChanged(syncTypes);

/** The type items each open workspace's registry last took, to follow another server's change to them. */
const taken = new WeakMap<Archipelago, string>();

/** Take in the types and link types kept on the map, when they changed: ones that no longer load (a pack gone) are said, and left out. */
async function takeTypeItems(pelago: Archipelago): Promise<boolean> {
  const items = await typeItems(pelago);
  const now = JSON.stringify(items);
  if (taken.get(pelago) === now) return false;
  taken.set(pelago, now);
  try {
    pelago.registry.takeItems(items);
  } catch (err) {
    console.error(`the types kept on the map in ${pelago.workspace} do not load: ${(err as Error).message}`);
    return false;
  }
  return true;
}

export const DEFAULT_WORKSPACE = 'default';
/** How soon a pack switched on another server is followed here. */
const FOLLOW_MS = 5_000;
/** How often the server that leads looks for ended workspaces whose day to be deleted has come. */
const DELETE_DUE_MS = 3_600_000;

export interface Workspace {
  id: string;
  name: string;
  pelago: Archipelago;
  automations: Automations;
}

interface WorkspacesConfig {
  /** The default workspace's database folder. Null keeps every database in memory (tests). */
  dataDir: string | null;
  /**
   * A Postgres server holding every workspace's database instead of folders: the default workspace's is the
   * database this names, another's that name and _<id> (src/pg.ts). Carries a password: from the environment only.
   */
  databaseUrl?: string;
  /** Where other workspaces' folders are kept, and the files the server kept before its database held them. */
  rootDir: string;
  packsDir: string;
  packs?: string[];
  policy?: Partial<Policy>;
  /** Start each workspace's automation runner and schedules when it opens: while this process leads (lead). */
  runAutomations?: boolean;
  /** Where the scheduled backups are written, one folder a workspace: a deleted workspace's go with it. */
  backupsDir?: string;
}

export class Workspaces {
  readonly config: WorkspacesConfig;
  private readonly open = new Map<string, Promise<Workspace>>();
  private readonly closing = new Map<string, Promise<void>>();
  /** Requests in hand on each workspace, and when each was last used. */
  private readonly held = new Map<string, number>();
  private readonly touched = new Map<string, number>();
  /** The default workspace's database, which keeps the list of workspaces; opened on first need, never before. */
  private base: Promise<Database> | undefined;
  /** The workspaces besides the default one, as last read from it. */
  private known = new Map<string, string>();
  private leading: boolean;
  private deleting: ReturnType<typeof setTimeout> | undefined;

  constructor(config: WorkspacesConfig) {
    this.config = config;
    this.leading = Boolean(config.runAutomations);
    // Other servers on the same Postgres may add a workspace, define a type or turn a pack off or on: this one
    // follows within FOLLOW_MS.
    if (config.databaseUrl) setInterval(() => void this.follow(), FOLLOW_MS).unref();
  }

  /** The database that keeps which workspaces there are: the default workspace's. */
  control(): Promise<Database> {
    this.base ??= (async () => {
      const { dataDir, databaseUrl, rootDir } = this.config;
      const db = await openDb(dataDir === null ? undefined : databaseUrl || dataDir);
      try {
        if (dataDir !== null) {
          const brought = await importControlFiles(db, rootDir);
          if (brought.length) console.log(`taken into the database from ${rootDir}: ${brought.join(', ')}`);
        }
        await this.refresh(db);
        return db;
      } catch (err) {
        await db.close();
        throw err;
      }
    })().catch((err) => {
      this.base = undefined;
      throw err;
    });
    return this.base;
  }

  private async refresh(db: Database): Promise<void> {
    this.known = new Map((await listWorkspaces(db)).map((w) => [w.id, w.name]));
  }

  /** Catch every open workspace up with what other servers changed in it that this process keeps in memory. */
  async follow(): Promise<void> {
    if (this.base) await this.refresh(await this.base).catch((err) => console.error(`reading the workspaces failed: ${(err as Error).message}`));
    for (const [id, opening] of this.open) {
      const ws = await opening.catch(() => undefined);
      if (!ws) continue;
      try {
        if (ws.pelago.registry.followLocal(await localTypes<TypeDef>(ws.pelago.db))) await syncTypes(ws.pelago);
        if (await takeTypeItems(ws.pelago)) await syncTypes(ws.pelago);
        await followPacks(ws.pelago);
      } catch (err) {
        console.error(`following ${id} failed: ${(err as Error).message}`);
      }
    }
  }

  async list(): Promise<{ id: string; name: string }[]> {
    await this.refresh(await this.control());
    return [{ id: DEFAULT_WORKSPACE, name: 'Default' }, ...[...this.known].map(([id, name]) => ({ id, name }))];
  }

  /** Whether there is a workspace by this id: asked of the database when this server has not heard of it. */
  async has(id: string): Promise<boolean> {
    if (id === DEFAULT_WORKSPACE || this.known.has(id)) return true;
    await this.refresh(await this.control());
    return this.known.has(id);
  }

  /** Open a workspace, once. Unknown ids are refused rather than created. */
  get(id: string): Promise<Workspace> {
    this.touched.set(id, Date.now());
    let opening = this.open.get(id);
    if (!opening) {
      opening = (async () => {
        if (!(await this.has(id))) throw new Error(`No workspace "${id}"`);
        // A database being closed must be shut before it is opened again.
        await this.closing.get(id);
        return this.load(id);
      })();
      const mine = opening;
      this.open.set(id, mine);
      mine.catch(() => this.open.get(id) === mine && this.open.delete(id));
    }
    return opening;
  }

  isOpen(id: string): boolean {
    return this.open.has(id);
  }

  /** Say a workspace is in use, for as long as a request on it lasts. Call what it returns when done. */
  hold(id: string): () => void {
    this.held.set(id, (this.held.get(id) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.held.set(id, (this.held.get(id) ?? 1) - 1);
      this.touched.set(id, Date.now());
    };
  }

  /**
   * Close one workspace's database if nothing needs it open: no request in
   * hand, no automation that must keep running, no session that could go quiet
   * unnoticed. It opens again on the next request. Each open workspace costs
   * about 200 MB, so this is what lets one server hold more customers than
   * fit in memory at once. The default workspace and in-memory ones stay open.
   */
  async closeIfUnused(id: string): Promise<boolean> {
    const opening = this.open.get(id);
    if (!opening || id === DEFAULT_WORKSPACE || this.config.dataDir === null || this.held.get(id)) return false;
    const ws = await opening.catch(() => undefined);
    if (!ws) return false;
    const { rows } = await ws.pelago.db.query<{ busy: boolean }>(
      `select exists(select 1 from entity where archived_at is null and ((type = any($1::text[]) and status = 'enabled') or (type = any($2::text[]) and is_open))) as busy`,
      [ws.pelago.registry.family('sys.automation'), ws.pelago.registry.family('sys.run')],
    );
    // Asked again after waiting: a request may have arrived meanwhile.
    if (rows[0].busy || this.held.get(id) || this.open.get(id) !== opening) return false;
    this.open.delete(id);
    this.clocks(ws, false);
    hostFor(ws.pelago.registry).stop();
    const closing = ws.pelago.db.close().finally(() => this.closing.delete(id));
    this.closing.set(id, closing);
    await closing;
    return true;
  }

  /** Close every workspace nobody has used for `idleMs`. Returns the ones closed. */
  async closeIdle(idleMs: number, now = Date.now()): Promise<string[]> {
    const closed = [];
    for (const id of [...this.open.keys()]) {
      if (now - (this.touched.get(id) ?? 0) >= idleMs && (await this.closeIfUnused(id))) closed.push(id);
    }
    return closed;
  }

  private async load(id: string, backup?: Dump): Promise<Workspace> {
    const { dataDir, databaseUrl, rootDir, packsDir, packs, policy } = this.config;
    const isDefault = id === DEFAULT_WORKSPACE;
    let db: Database;
    if (isDefault) db = await this.control();
    else {
      const onServer = databaseUrl && (await databaseFor(databaseUrl, id));
      db = await openDb(dataDir === null ? undefined : onServer || join(rootDir, id, 'db'));
    }
    try {
      if (backup) await restore(db, backup, id);
      // Types a workspace defines for itself are in its own database. Those kept in a folder before are taken in once.
      if (dataDir !== null) await importLocalPack(db, isDefault ? join(packsDir, LOCAL_PACK, 'pack.json') : join(rootDir, id, 'local-pack', 'pack.json'));
      const registry = new Registry(packsDir, packs, await localTypes<TypeDef>(db));
      registry.keepLocal = (def) => addLocalType(db, def);
      const pelago = new Archipelago(db, registry, policy, id);
      // The packs the owner turned off here stay off; what they made is dormant.
      pelago.registry.turnOff(await packsOff(pelago));
      await takeTypeItems(pelago);
      await syncTypes(pelago);
      await syncPacks(pelago); // which packs are present, and as which manifests, is a fact on the log
      const ws = { id, name: isDefault ? 'Default' : (this.known.get(id) ?? id), pelago, automations: new Automations(pelago) };
      if (this.leading) this.clocks(ws, true);
      return ws;
    } catch (err) {
      if (!isDefault) await db.close();
      throw err;
    }
  }

  /** Start or stop what runs on a clock in one workspace: its automations and its packs' schedules. */
  private clocks(ws: Workspace, on: boolean): void {
    ws.automations.stop();
    stopSchedules(ws.pelago.registry);
    if (!on) return;
    startSchedules(ws.pelago);
    ws.automations.start();
  }

  /**
   * Become the server that runs the clocks (src/leader.ts), or stop being it. On a Postgres server every workspace is
   * opened as this one takes the lead, since a request may never come here to open one whose automations are due.
   */
  async lead(on: boolean): Promise<void> {
    this.leading = on;
    // The first look a minute after taking the lead, then hourly; unref'd, so this clock alone keeps nothing running.
    clearTimeout(this.deleting);
    const look = () => {
      this.deleting = setTimeout(look, DELETE_DUE_MS).unref();
      void this.deleteDue().catch((err) => console.error(`deleting ended workspaces failed: ${(err as Error).message}`));
    };
    this.deleting = on ? setTimeout(look, 60_000).unref() : undefined;
    if (on && this.config.databaseUrl) for (const { id } of await this.list()) await this.get(id).catch((err) => console.error(`opening ${id} to lead failed: ${(err as Error).message}`));
    for (const opening of this.open.values()) {
      const ws = await opening.catch(() => undefined);
      if (ws) this.clocks(ws, this.leading);
    }
  }

  /**
   * Make a workspace: an empty one, or with `backup` one holding everything a
   * backup file holds, which is how a map moves between servers. If the backup
   * cannot be put in, no workspace is left behind.
   */
  async create(id: string, name: string, backup?: Dump): Promise<Workspace> {
    if (!validWorkspaceId(id)) throw new Error('A workspace id is 1 to 40 characters: lowercase letters, digits and hyphens, starting with a letter or digit.');
    if (await this.has(id)) throw new Error(`Workspace "${id}" already exists`);
    const folder = join(this.config.rootDir, id);
    // Nothing found there is ours to restore over, or to delete if it fails.
    if (backup && existsSync(folder)) throw new Error(`There is already a folder for "${id}" on this server. Choose another id.`);
    const control = await this.control();
    const named = name.trim() || backup?.workspace?.name || id;
    if (!(await addWorkspace(control, { id, name: named }))) throw new Error(`Workspace "${id}" already exists`);
    this.known.set(id, named);
    if (!backup) return this.get(id);
    try {
      this.touched.set(id, Date.now());
      const opening = this.load(id, backup);
      this.open.set(id, opening);
      return await opening;
    } catch (err) {
      this.open.delete(id);
      await removeWorkspace(control, id);
      this.known.delete(id);
      rmSync(folder, { recursive: true, force: true });
      if (this.config.databaseUrl) await dropDatabaseFor(this.config.databaseUrl, id).catch(() => {});
      throw err;
    }
  }

  /** Make the operator secret if there is none. Returns it only at that moment, on the one server that made it. */
  async ensureOperator(): Promise<string | undefined> {
    const secret = newSecret('latop');
    return (await claimControlValue(await this.control(), OPERATOR, hashSecret(secret))) ? secret : undefined;
  }

  async isOperator(secret: string | undefined): Promise<boolean> {
    if (!secret) return false;
    const hash = await controlValue<string>(await this.control(), OPERATOR);
    return Boolean(hash && sameSecret(secret, hash));
  }

  /**
   * Replace a lost operator secret. Nobody can be asked for the old one, so
   * the proof is being able to write where the server keeps its state: the
   * caller puts a value's hash in its database (`pelago operator-reset`), or
   * the value in a file beside the workspaces, and then names that value.
   * Either is good for one try. Returns the new secret, once.
   */
  async resetOperator(proof: string | undefined): Promise<string | undefined> {
    const db = await this.control();
    const prepared = await takeControlValue<string>(db, OPERATOR_RESET);
    const file = join(this.config.rootDir, OPERATOR_RESET_FILE);
    let good: boolean;
    if (prepared) good = Boolean(proof && sameSecret(proof, prepared));
    else if (existsSync(file)) {
      const expected = readFileSync(file, 'utf8').trim();
      rmSync(file, { force: true });
      good = Boolean(proof && expected.length >= 32 && sameSecret(proof, hashSecret(expected)));
    } else return undefined;
    if (!good) return undefined;
    const secret = newSecret('latop');
    await setControlValue(db, OPERATOR, hashSecret(secret));
    return secret;
  }

  /**
   * Delete a workspace from this server, whole and for good: its database, its folder, its scheduled backups, and what
   * the server kept about it. Only what has ended and whose day has come is deleted by itself (deleteDue).
   */
  async delete(id: string): Promise<void> {
    if (id === DEFAULT_WORKSPACE) throw new Error('The default workspace is never deleted.');
    const opening = this.open.get(id);
    this.open.delete(id);
    const ws = await opening?.catch(() => undefined);
    if (ws) {
      this.clocks(ws, false);
      hostFor(ws.pelago.registry).stop();
      await ws.pelago.db.close().catch(() => {});
    }
    await this.closing.get(id)?.catch(() => {});
    const control = await this.control();
    await removeWorkspace(control, id);
    for (const key of [`member_limit:${id}`, `server_pack_made:${id}`]) await takeControlValue(control, key);
    await control.query(`delete from control_value where key like 'connection:%' and value->>'workspace' = $1`, [id]);
    await setEnded(control, id, null);
    this.known.delete(id);
    rmSync(join(this.config.rootDir, id), { recursive: true, force: true });
    if (this.config.backupsDir) rmSync(join(this.config.backupsDir, id), { recursive: true, force: true });
    if (this.config.databaseUrl) await dropDatabaseFor(this.config.databaseUrl, id);
  }

  /** Delete every ended workspace whose day has come. Returns those deleted. */
  async deleteDue(now = new Date()): Promise<string[]> {
    const due = await dueForDeletion(await this.control(), now);
    for (const id of due) {
      await this.delete(id);
      console.log(`deleted the ended workspace ${id}`);
    }
    return due;
  }

  async closeAll(): Promise<void> {
    clearTimeout(this.deleting);
    this.deleting = undefined;
    for (const opening of this.open.values()) {
      const ws = await opening.catch(() => undefined);
      if (ws) {
        this.clocks(ws, false);
        hostFor(ws.pelago.registry).stop();
      }
      if (ws?.id !== DEFAULT_WORKSPACE) await ws?.pelago.db.close();
    }
    this.open.clear();
    const base = this.base;
    this.base = undefined;
    await (await base?.catch(() => undefined))?.close();
  }
}
