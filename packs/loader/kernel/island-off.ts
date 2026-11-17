// A pack turned off on one island while the rest of the map keeps it (task e_hr4qvr9u; decision e_cagr6ssp, the
// owner, 17 Nov 2026). An island (an item of core's type island, or a focus) names the packs it has off in its field
// packs_off; its registry is the map's (or its pinned version's) with those off (packs/loader/kernel/island-pin.ts),
// so what relies on them waits there, and the types they declare are kept dormant: an item of one stays and is
// edited, and no new one is made on that island. Setting the field is a change like any other: a person's gesture
// applies, an agent's is judged by the rules (core's agent_island_pack, and agent_island_code for a pack that runs
// code, as agent_pack_set and agent_pack_code judge pack_set). The kernel's own pack is never turned off.

import { FOCUS, ISLAND, PACKS_OFF } from './island-items.ts';
import { isRequired } from './manifest.ts';
import { KERNEL_PACKS } from './packorder.ts';
import type { Registry } from './packs.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';
import type { Op } from '../../write/kernel/pelago-types.ts';

type ItemLike = { type: string; props?: Record<string, unknown> | null; archived_at?: unknown };

/** The why a pack has on an island that turned it off. */
export const OFF_HERE = 'turned off on this island'; // as packs/loader/kernel/packs.ts says it

/** Whether an item is an island: one of core's type island, or a focus (its own island, decision e_mqex8wrf). */
export const isIslandItem = (reg: Registry, item: ItemLike): boolean => reg.isA(item.type, ISLAND) || item.props?.[FOCUS] === true;

/** The packs an island has off, as it names them: none for an archived island or an item that is none. The kernel's own never is. */
export function offOn(reg: Registry, island: ItemLike | undefined): string[] {
  if (!island || island.archived_at || !isIslandItem(reg, island)) return [];
  const said = island.props?.[PACKS_OFF];
  return Array.isArray(said) ? [...new Set(said.filter((p): p is string => typeof p === 'string' && !KERNEL_PACKS.includes(p)))].sort() : [];
}

/** Whether a pack runs code on the server or reaches outside it: turning it on or off starts or stops that code. */
export function packRunsCode(reg: Registry, pack: string): boolean {
  const p = reg.found.find((f) => f.id === pack);
  return Boolean(p && (p.kernel || p.handlers?.length || p.actions?.length || p.layouts?.length || p.reach));
}

/** Why a pack cannot be turned off on an island, or undefined when it can. */
function cannotTurnOff(reg: Registry, pack: string): string | undefined {
  if (KERNEL_PACKS.includes(pack)) return `the ${pack} pack is the kernel's own: it is never turned off, on an island or anywhere`;
  const found = reg.found.find((p) => p.id === pack);
  if (!found) return `no pack "${pack}" here. Packs: ${[...reg.states.keys()].join(', ')}`;
  if (isRequired(found) && reg.internal.has(pack)) return `the ${pack} pack is the server's own and required: it is never turned off`;
  return undefined;
}

/** Why ops that set an island's packs_off cannot be kept, as sentences: no island, no list of pack ids, or a pack never turned off. */
export async function offRefusals(map: Archipelago, reg: Registry, ops: Op[]): Promise<string[]> {
  const errors: string[] = [];
  for (const [i, op] of ops.entries()) {
    const set = op.op === 'create' || op.op === 'update' ? op.props?.[PACKS_OFF] : undefined;
    if (set === undefined || set === null) continue;
    const where = `op ${i + 1} (${op.op})`;
    const island = op.op === 'create' ? { type: op.type, props: op.props ?? {} } : await map.entity((op as { id: string }).id);
    if (!island) continue;
    const merged = { ...island, props: { ...island.props, ...(op as { props?: Record<string, unknown> }).props } };
    if (!isIslandItem(reg, merged)) { errors.push(`${where}: ${PACKS_OFF} is an island's: this item is no island (an island, or a focus)`); continue; }
    if (!Array.isArray(set) || set.some((p) => typeof p !== 'string')) { errors.push(`${where}: ${PACKS_OFF} is a list of pack ids, e.g. ["build"]`); continue; }
    for (const pack of new Set(set as string[])) { const why = cannotTurnOff(reg, pack); if (why) errors.push(`${where}: ${why}`); }
  }
  return errors;
}

/** What the rules read of an op that sets an island's packs_off: whether a pack it turns off or on runs code (island_code). */
export function offFacts(reg: Registry, op: { op: string; type?: string; props?: Record<string, unknown> }, target: ItemLike | undefined): { island_code?: boolean } {
  if ((op.op !== 'create' && op.op !== 'update') || !op.props || !(PACKS_OFF in op.props)) return {};
  const island = op.op === 'create' ? { type: op.type ?? '', props: op.props } : target && { ...target, props: { ...target.props, ...op.props } };
  if (!island || !isIslandItem(reg, island)) return {};
  const was = new Set(offOn(reg, target)), now = new Set(offOn(reg, island));
  const turned = [...was, ...now].filter((p) => was.has(p) !== now.has(p));
  return turned.some((p) => packRunsCode(reg, p)) ? { island_code: true } : {};
}
