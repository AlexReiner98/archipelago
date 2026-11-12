// The log's slot log.appended (docs/kernel-packs.md, "Slots"), filled by the loader: each internal pack that declares
// `kernel.hooks["log.appended"]` is handed every append's stored facts, in its transaction, with a context that
// reaches nothing outside it (as a log.project projector's, src/log-project.ts) and a writer of the database's
// functions. Filled from a map's registry when the map is made, so it is there before anything is appended; the
// internal packs are the server's own, never turned off, so a filling holds for the process.

import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fillAppended } from '../../../src/log.ts';
import { isInternal, type Manifest } from './manifest.ts';
import { codeFolder } from './code-folder.ts';
import type { Q } from '../../../src/db.ts';
import type { KernelContext } from '../../../src/kernel-context.ts';
import type { Registry } from './packs.ts';

/** What a filling writes with: a function of the database's own, by name, handed one JSON argument. */
export interface AppendedRows { definer(name: string, arg: unknown): Promise<void> }
type Run = (ctx: KernelContext, entry: { facts: unknown[] }, rows: AppendedRows) => unknown;

/** A function the database makes for the packs: pelago_<name>, nothing else. */
const DEFINER = /^pelago_[a-z][a-z0-9_]*$/;

const modules = new Map<string, Promise<Record<string, unknown>>>();
const filled = new WeakSet<object>();

/** The context a filling is handed: who it is and the types, and nothing that reaches outside the append. */
function appendedContext(reg: Registry, pack: Manifest): KernelContext {
  const none = (what: string) => () => { throw new Error(`The ${pack.id} pack's log.appended ${what}: it is handed only the append's facts`); };
  return {
    pack: { id: pack.id, version: pack.version, hash: reg.hashes.get(pack.id) ?? '' },
    workspace: '',
    reads: none('reads the map'),
    registry: reg,
    call: none('calls a service'),
    provided: none('reads the names of a family'),
    island: none('reads an island'),
    change: none('makes a change'),
    move: none('moves what it keeps'),
    record: none('records on a stream'),
    secret: none('asks for a secret'),
    fetch: none('calls out'),
    now: () => new Date(),
    said: (message) => console.error(`${pack.id}: ${message}`),
  };
}

const rowsOf = (tx: Q, pack: string): AppendedRows => ({
  definer: async (name, arg) => {
    if (!DEFINER.test(name)) throw new Error(`The ${pack} pack writes through ${name}, which is no function of the database's (pelago_<name>)`);
    await tx.query(`select ${name}($1::jsonb)`, [JSON.stringify(arg)]);
  },
});

/** Fill log.appended from a registry's internal packs, once a registry: each function loaded when first run, never a file outside its pack's modules. */
export function fillLogSlots(reg: Registry): void {
  if (filled.has(reg) || !Array.isArray(reg?.packs)) return; // a stand-in registry (a test's) has no packs
  filled.add(reg);
  for (const pack of reg.packs.filter(isInternal)) {
    for (const ref of [pack.kernel?.hooks?.['log.appended'] ?? []].flat()) {
      const [file, name] = ref.split('#');
      const dir = resolve(codeFolder(reg, pack), pack.kernel?.modules ?? 'kernel/');
      const path = resolve(dir, file);
      const inside = relative(dir, path);
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`The ${pack.id} pack names ${ref}, outside its modules`);
      fillAppended(`${pack.id}:${ref}`, async (entry, tx) => {
        if (!modules.has(path)) modules.set(path, import(pathToFileURL(path).href) as Promise<Record<string, unknown>>);
        const run = (await modules.get(path)!)[name];
        if (typeof run !== 'function') throw new Error(`The ${pack.id} pack names ${ref}, which it does not export as a function`);
        await (run as Run)(appendedContext(reg, pack), entry, rowsOf(tx, pack.id));
      });
    }
  }
}
