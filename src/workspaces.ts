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
    let opening = this.open.get(id);
    if (!opening) {
      opening = this.load(id);
      this.open.set(id, opening);
    }
    return opening;
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
