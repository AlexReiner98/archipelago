// The root service family (docs/kernel-packs.md, "Root services"): a root pack may provide service names under
// `root.`, each a function, and only the internal packs that packs/roots.json names for a name may call it. The list
// is pinned with the roots (the owner's word for it is their approval of the pull request that changes roots.json),
// checked at boot (src/boot.ts, checkRoots) and at every call (callRoot): any other caller is refused by name.
//
// A root's provider is handed a RootCall, not a KernelContext: who calls, the map the caller's context is of, and for
// a server duty the server's workspaces. It answers with values, never a handle on the database.
//
// Kept apart from src/boot.ts, which is the entry module: a module that imports it while it is still in its top-level
// await never settles.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Archipelago } from '../../write/kernel/pelago.ts';
import type { Workspaces } from '../../identity/kernel/workspaces.ts';

/** The repository whose packs/ and roots.json are read, unless told otherwise. */
export const ROOT_HOME = join(import.meta.dirname, '..', '..', '..');
const ROOTS = 'packs/roots.json';
/** A root service's name: `root.` and a word. */
export const ROOT_NAME = /^root\.[a-z][a-z0-9_]*$/;
export const isRootName = (name: string) => name.startsWith('root.');

/** What a root's provider is handed with its input. */
export interface RootCall {
  /** The internal pack that calls. */
  caller: string;
  /** The map the caller's context is of: as it asks, a person's view under row-level security when it is one. */
  map?: Archipelago;
  /** A server duty's (backupAll): the server's workspaces, and no map. */
  workspaces?: Pick<Workspaces, 'get' | 'isOpen' | 'hold' | 'closeIfUnused'> & { list(): Promise<{ id: string; name: string }[]> };
}

interface Pack { id?: string; kernel?: { trust?: string; internal?: boolean; modules?: string; provides?: Record<string, { run?: string }> }; requires?: string[]; uses?: string[] }
interface Provider { root: string; dir: string; run: string }
/** Who provides each root name and who may call it, as roots.json and the root packs' manifests say. */
export interface RootTable { provides: Map<string, Provider>; callers: Map<string, string[]> }

const text = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const manifest = (home: string, id: string): Pack | undefined => {
  const file = join(home, 'packs', id, 'pack.json');
  return existsSync(file) ? (JSON.parse(text(file)) as Pack) : undefined;
};

/** The table, and every way it is wrong: a name no root provides, a caller that is no internal service pack here. */
export function readRootTable(home = ROOT_HOME): { table: RootTable; problems: string[] } {
  const problems: string[] = [];
  const file = join(home, ROOTS);
  const parsed = existsSync(file) ? (JSON.parse(text(file)) as { roots?: { id: string }[]; calls?: unknown }) : {};
  const provides = new Map<string, Provider>();
  for (const { id } of parsed.roots ?? []) {
    const m = manifest(home, id);
    for (const [name, p] of Object.entries(m?.kernel?.provides ?? {})) {
      if (!ROOT_NAME.test(name)) { problems.push(`${id} provides ${name}: a root pack provides only root.<name>`); continue; }
      if (typeof p?.run !== 'string' || !/^[\w./-]+\.ts#[A-Za-z_$][\w$]*$/.test(p.run) || p.run.includes('..')) { problems.push(`${id} provides ${name} by ${JSON.stringify(p?.run)}: a function of its modules, <file>.ts#<export>`); continue; }
      if (provides.has(name)) { problems.push(`${name} is provided by ${provides.get(name)!.root} and ${id}: one name, one root`); continue; }
      provides.set(name, { root: id, dir: join(home, 'packs', id, m?.kernel?.modules ?? 'kernel/'), run: p.run });
    }
  }
  const callers = new Map<string, string[]>();
  const calls = parsed.calls ?? {};
  if (typeof calls !== 'object' || Array.isArray(calls)) problems.push(`${ROOTS}: calls is { "root.<name>": [the packs that may call it] }`);
  else for (const [name, packs] of Object.entries(calls as Record<string, unknown>)) {
    if (!ROOT_NAME.test(name)) { problems.push(`${ROOTS} lets packs call ${name}, which is no root service: root.<name>`); continue; }
    if (!provides.has(name)) problems.push(`${ROOTS} lets packs call ${name}, which no root pack provides`);
    if (!Array.isArray(packs) || packs.some((p) => typeof p !== 'string')) { problems.push(`${ROOTS}: calls.${name} is a list of pack ids`); continue; }
    for (const id of packs as string[]) {
      const m = manifest(home, id);
      if (!m) problems.push(`${ROOTS} lets ${id} call ${name}, but there is no pack ${id} here (packs/${id}/pack.json)`);
      else if (!m.kernel?.trust || m.kernel.trust === 'root' || m.kernel.internal !== true) // a service pack: in-process, internal, no root
        problems.push(`${ROOTS} lets ${id} call ${name}, but ${id} is no internal service pack`);
    }
    callers.set(name, packs as string[]);
  }
  return { table: { provides, callers }, problems };
}

/** The table as this process read it first, per repository: roots.json and the roots change only with a restart. */
const read = new Map<string, RootTable>();
const tableOf = (home: string) => read.get(home) ?? read.set(home, readRootTable(home).table).get(home)!;

/** The packs roots.json lets call a root name. */
export const rootCallers = (name: string, home = ROOT_HOME): string[] => tableOf(home).callers.get(name) ?? [];

/** Whether an internal pack's manifest says it calls a service name (requires or uses it). */
export const declares = (pack: Pack, name: string) => [...(pack.requires ?? []), ...(pack.uses ?? [])].includes(`service:${name}`);

/** A pack's manifest as the server's own folder has it, for a call made with no map (a server duty). */
export const ownManifest = (id: string, home = ROOT_HOME) => manifest(home, id);

/**
 * Call a root service as `caller`: refused unless roots.json names the caller for it. The provider is the root's
 * function, `<file>.ts#<export>` under its modules, handed the RootCall and the input.
 */
export async function callRoot<O = unknown>(caller: string, name: string, input: unknown, at: Omit<RootCall, 'caller'>, home = ROOT_HOME): Promise<O> {
  const table = tableOf(home);
  const p = table.provides.get(name);
  if (!p) throw new Error(`No root pack provides ${name}`);
  const may = table.callers.get(name) ?? [];
  if (!may.includes(caller)) throw new Error(`The ${caller} pack may not call ${name}: ${ROOTS} lets only ${may.length ? may.join(', ') : 'no pack'} call it`);
  const [file, fn] = p.run.split('#');
  const mod = (await import(pathToFileURL(join(p.dir, file)).href)) as Record<string, unknown>;
  const f = mod[fn];
  if (typeof f !== 'function') throw new Error(`The ${p.root} root pack names ${p.run} for ${name}, which it does not export as a function`);
  return (await f({ caller, ...at }, input)) as O;
}
