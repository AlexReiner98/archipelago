// The slot `loader.leading` (docs/kernel-packs.md, "Slots"; the owner, 12 Nov 2026, e_nxqn32mb): what an internal pack
// runs on a beat in each workspace while this server leads. An optional pack may fill it (sessions: the look for
// quiet sessions), since a pack's own `kernel.timers` are filled at a workspace's open and would outlive the switch.
// Each filling is an export of the pack's own modules, named in its manifest under `kernel.hooks["loader.leading"]`,
// read once for the process from the server's own folder, as loader.calls is (./own-calls.ts). Whether its pack is on
// is read at each beat, so a filling stops the moment a map turns its pack off, and starts again when it is turned on;
// it is handed its pack's context of the map (kernelContext), as the map has the pack.

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Workspace } from '../../identity/kernel/workspaces.ts';
import { every } from '../../identity/kernel/lifecycle.ts';
import { kernelContext } from './kernel-context.ts';
import { isInternal, type Manifest } from './manifest.ts';
import { OWN_PACKS } from './pack-folders.ts';
import { ownManifest } from './root-calls.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

const POINT = 'loader.leading';
/** How often the slot's fillings run in each workspace this server leads: every 30 seconds, as the quiet look's timer did. */
export const BEAT_MS = 30_000;

type Filling = { pack: string; run: (ctx: ReturnType<typeof kernelContext>) => unknown };

/** The slot's fillings, in pack order: read once, from the server's own folder. */
let filled: Promise<Filling[]> | undefined;

async function fillings(home = OWN_PACKS): Promise<Filling[]> {
  const out: Filling[] = [];
  for (const id of readdirSync(home).sort()) {
    const m = ownManifest(id, join(home, '..')) as Manifest | undefined;
    if (!m || !isInternal(m) || m.kernel?.trust !== 'service') continue;
    for (const ref of [m.kernel?.hooks?.[POINT] ?? []].flat()) {
      const [file, name] = ref.split('#');
      if (!file || file.includes('..')) throw new Error(`The ${id} pack fills ${POINT} with ${ref}, outside its modules`);
      const f = ((await import(pathToFileURL(resolve(home, id, m.kernel?.modules ?? 'kernel/', file)).href)) as Record<string, unknown>)[name];
      if (typeof f !== 'function') throw new Error(`The ${id} pack fills ${POINT} with ${ref}, which is no function of its modules`);
      out.push({ pack: id, run: f as Filling['run'] });
    }
  }
  return out;
}

/** One beat on a map: each filling whose pack this map has on, on that pack's context of it. Answers the packs that ran. */
export async function beat(l: Archipelago): Promise<string[]> {
  const ran: string[] = [];
  for (const { pack, run } of await (filled ??= fillings())) {
    if (!l.registry.packs.some((p) => p.id === pack)) continue; // off on this map: nothing of it runs
    await run(kernelContext(l, pack));
    ran.push(pack);
  }
  return ran;
}

/** The duty the loader runs while this server leads (its LEADING, ./open.ts): a beat in the workspace, one at a time. */
export function leadingBeat(ws: Workspace, everyMs = BEAT_MS): () => void {
  let busy = false;
  return every(everyMs, () => {
    if (busy) return;
    busy = true;
    void beat(ws.pelago)
      .catch((err: Error) => console.error(`${POINT} in ${ws.id} failed: ${err.message}`))
      .finally(() => (busy = false));
  });
}
