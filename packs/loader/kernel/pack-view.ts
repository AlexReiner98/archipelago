// The loader root's service for the query pack (docs/kernel-packs.md, "Root services"): a view a plain pack answers
// with its own code, run in the sandbox as the pack's (root.pack_view). Asked by its name, the query pack finds which
// pack declares it; the sandbox runs it as the one who asked, on the island's version of the pack when the view's
// params name an island. Values in, values out.

import type { RootCall } from './root-calls.ts';
import type { Actor } from '../../write/kernel/pelago.ts';
import { islandRegistry } from './island-pin.ts';
import { parts } from './manifest.ts';
import { hostIn } from './packtools.ts';

/** root.pack_view: what a pack's view answers, run in the sandbox as the actor who asked; null when it answers nothing. */
export async function packView(call: RootCall, input: { pack: string; view: string; params?: Record<string, unknown>; actor: Actor }): Promise<unknown> {
  const map = call.map;
  if (!map) throw new Error('A view is read of a map: a server duty has none');
  const params = input?.params ?? {};
  // As the view is found: on the island's version of the pack when its params name an island (packs/query/kernel/askview.ts).
  const l = typeof params.island === 'string' ? map.readIn(await islandRegistry(map, params.island)) : map;
  const pack = l.registry.packs.find((p) => p.id === input.pack);
  const def = pack && parts(pack).views.find((v) => v.id === input.view);
  if (!def) throw new Error(`No view "${input.view}" of the ${input.pack} pack here`);
  return (await (await hostIn(map, input.pack, params.island)).call(l, input.actor, input.pack, 'view', def.id, params, def.limit_ms)).answer ?? null;
}
