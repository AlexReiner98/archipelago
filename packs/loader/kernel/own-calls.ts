// The slot `loader.calls` (docs/kernel-packs.md, "Slots"): what a root calls of an internal pack on any map, whether
// or not that map has the pack on. A session's acts and hooks answer on every map, as they did before sessions moved
// into its optional pack, so the roots that call them (the surface's session acts, the loader's hook adapter) cannot
// ask a service name, which only a pack on the map provides. Each filling is an export of the pack's own modules,
// named in its manifest under `kernel.hooks["loader.calls"]` and called by its export's name, handed the pack's own
// context of the map it is called on (ownContext) and the arguments. Filled once for the process from the server's own
// folder, as rules.<on> is (rule-events.ts): it holds nothing of a map, so an optional pack may fill it.

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isInternal, type Manifest } from './manifest.ts';
import { OWN_PACKS } from './pack-folders.ts';
import { ownManifest } from './root-calls.ts';
import { ownContext } from './kernel-context.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

const POINT = 'loader.calls';

type Call = (ctx: ReturnType<typeof ownContext>, ...args: never[]) => unknown;

/** Each name filled, with its pack and function: read once, from the server's own folder. */
let filled: Promise<Map<string, { pack: string; run: Call }>> | undefined;

async function fillings(home = OWN_PACKS): Promise<Map<string, { pack: string; run: Call }>> {
  const out = new Map<string, { pack: string; run: Call }>();
  for (const id of readdirSync(home).sort()) {
    const m = ownManifest(id, join(home, '..')) as Manifest | undefined;
    if (!m || !isInternal(m) || m.kernel?.trust !== 'service') continue;
    for (const ref of [m.kernel?.hooks?.[POINT] ?? []].flat()) {
      const [file, name] = ref.split('#');
      if (!file || file.includes('..')) throw new Error(`The ${id} pack fills ${POINT} with ${ref}, outside its modules`);
      const had = out.get(name);
      if (had) throw new Error(`${name} is filled by the ${had.pack} and the ${id} pack: one name, one owner (${POINT})`);
      const dir = resolve(home, id, m.kernel?.modules ?? 'kernel/');
      const f = ((await import(pathToFileURL(resolve(dir, file)).href)) as Record<string, unknown>)[name];
      if (typeof f !== 'function') throw new Error(`The ${id} pack fills ${POINT} with ${ref}, which is no function of its modules`);
      out.set(name, { pack: id, run: f as Call });
    }
  }
  return out;
}

/** Call what an internal pack fills `loader.calls` with by this name, on its own context of the map: refused when none does. */
export async function ownCall<O = unknown>(l: Archipelago, name: string, ...args: unknown[]): Promise<O> {
  const found = (await (filled ??= fillings())).get(name);
  if (!found) throw new Error(`No pack of this server fills ${name} (${POINT})`);
  return (await found.run(ownContext(l, found.pack), ...(args as never[]))) as O;
}
