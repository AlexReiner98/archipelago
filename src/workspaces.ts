// Tenancy: one database per customer. Each workspace has its own database,
// its own locally defined types and its own automation runner, so one
// customer's map cannot leak into another's by a missed filter: there is no
// shared table to filter.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSecret, newSecret, sameSecret, validWorkspaceId } from './auth.ts';
import { Automations } from './automations.ts';
import { openDb } from './db.ts';
import { Lattice, type Policy } from './lattice.ts';
import { Registry } from './packs.ts';

export const DEFAULT_WORKSPACE = 'default';

export interface Workspace {
  id: string;
  name: string;
  lattice: Lattice;
  automations: Automations;
}

interface WorkspacesConfig {
  /** The default workspace's database folder. Null keeps every database in memory (tests). */
  dataDir: string | null;
  /** Where other workspaces and the operator secret are kept. */
  rootDir: string;
  packsDir: string;
  packs?: string[];
  policy?: Partial<Policy>;
  /** Start each workspace's automation runner when it opens. */
  runAutomations?: boolean;
}

interface IndexFile {
  operator?: string; // hash of the operator secret
  workspaces: { id: string; name: string; created: string }[];
}

export class Workspaces {
  readonly config: WorkspacesConfig;
  private readonly open = new Map<string, Promise<Workspace>>();
  private readonly closing = new Map<string, Promise<void>>();
  /** Requests in hand on each workspace, and when each was last used. */
  private readonly held = new Map<string, number>();
  private readonly touched = new Map<string, number>();
  private index: IndexFile;

  constructor(config: WorkspacesConfig) {
    this.config = config;
    const file = this.indexFile();
    this.index = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { workspaces: [] };
  }

  private indexFile(): string {
    return join(this.config.rootDir, 'index.json');
  }

  private save(): void {
    mkdirSync(this.config.rootDir, { recursive: true });
    writeFileSync(this.indexFile(), JSON.stringify(this.index, null, 2) + '\n');
  }

  list(): { id: string; name: string }[] {
    return [{ id: DEFAULT_WORKSPACE, name: 'Default' }, ...this.index.workspaces.map(({ id, name }) => ({ id, name }))];
  }

  has(id: string): boolean {
    return id === DEFAULT_WORKSPACE || this.index.workspaces.some((w) => w.id === id);
  }

  /** Open a workspace, once. Unknown ids are refused rather than created. */
  get(id: string): Promise<Workspace> {
    if (!this.has(id)) return Promise.reject(new Error(`No workspace "${id}"`));
    this.touched.set(id, Date.now());
    let opening = this.open.get(id);
    if (!opening) {
      // A database being closed must be shut before it is opened again.
      opening = (this.closing.get(id) ?? Promise.resolve()).then(() => this.load(id));
      this.open.set(id, opening);
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
    const { rows } = await ws.lattice.db.query<{ busy: boolean }>(
      `select exists(select 1 from entity where archived_at is null and ((type = any($1::text[]) and status = 'enabled') or (type = any($2::text[]) and is_open))) as busy`,
      [ws.lattice.registry.family('sys.automation'), ws.lattice.registry.family('sys.run')],
    );
    // Asked again after waiting: a request may have arrived meanwhile.
    if (rows[0].busy || this.held.get(id) || this.open.get(id) !== opening) return false;
    this.open.delete(id);
    ws.automations.stop();
    const closing = ws.lattice.db.close().finally(() => this.closing.delete(id));
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

  private async load(id: string): Promise<Workspace> {
    const { dataDir, rootDir, packsDir, packs, policy } = this.config;
    const isDefault = id === DEFAULT_WORKSPACE;
    const dbDir = dataDir === null ? undefined : isDefault ? dataDir : join(rootDir, id, 'db');
    // Types a workspace defines for itself stay with that workspace.
    const localPack = isDefault ? undefined : join(rootDir, id, 'local-pack');
    const lattice = new Lattice(await openDb(dbDir), new Registry(packsDir, packs, localPack), policy, id);
    const automations = new Automations(lattice);
    if (this.config.runAutomations) automations.start();
    return { id, name: this.list().find((w) => w.id === id)!.name, lattice, automations };
  }

  async create(id: string, name: string): Promise<Workspace> {
    if (!validWorkspaceId(id)) throw new Error('A workspace id is 1 to 40 characters: lowercase letters, digits and hyphens, starting with a letter or digit.');
    if (this.has(id)) throw new Error(`Workspace "${id}" already exists`);
    this.index.workspaces.push({ id, name: name.trim() || id, created: new Date().toISOString() });
    this.save();
    return this.get(id);
  }

  /** Make the operator secret if there is none. Returns it only at that moment. */
  ensureOperator(): string | undefined {
    if (this.index.operator) return undefined;
    const secret = newSecret('latop');
    this.index.operator = hashSecret(secret);
    this.save();
    return secret;
  }

  isOperator(secret: string | undefined): boolean {
    return Boolean(secret && this.index.operator && sameSecret(secret, this.index.operator));
  }

  async closeAll(): Promise<void> {
    for (const opening of this.open.values()) {
      const ws = await opening.catch(() => undefined);
      ws?.automations.stop();
      await ws?.lattice.db.close();
    }
    this.open.clear();
  }
}
