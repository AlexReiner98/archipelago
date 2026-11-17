// What an island declares, as the island answer says it (task e_ter3cwup; decisions e_cy9dfsna, e_57bjxy2x,
// e_e3ss8nqm): the pack it speaks and the packs that one requires, each with its state on this island (active,
// waiting or off) and why, read from the registry the island runs (packs/loader/kernel/island-pin.ts), and how many
// of its items turning its pack off there would send waiting. An item waits when its type's pack is not active on its
// island: derived each time, nothing written to it, so it wakes by itself when the pack is back. A pack's glyph is its
// style preset's (props.glyph); a pack with none says none, and the page shows its initial.

import { islandRegistry } from './island-pin.ts';
import { dependentsOf, KERNEL_PACKS, providersOf, type PackState } from './packorder.ts';
import type { PackFile, Registry } from './packs.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

/** A pack as an island's header names it. */
export interface Declared { id: string; title: string; glyph?: string; state: PackState['state']; why?: string }
/** An island's own pack, with what it requires and what turning it off there would send waiting. */
export type IslandDecl = Declared & { requires: Declared[]; off_would_wait: number };
/** Why an item waits: the pack of its type, not active on its island, and why. */
export interface Waiting { pack: string; why: string }

/** The glyph a pack's style preset gives it, if any (decision e_e3ss8nqm). */
export const glyphOf = (pack: PackFile | undefined): string | undefined => {
  const preset = (pack?.styles ?? []).find((s) => (s.type ?? 'style') === 'style' && typeof s.props?.glyph === 'string' && s.props.glyph !== '');
  return preset?.props.glyph as string | undefined;
};

/** A pack as found here, with its state in a registry an island runs. */
function declared(map: Registry, run: Registry, id: string): Declared {
  const pack = run.found.find((p) => p.id === id) ?? map.found.find((p) => p.id === id);
  const s = run.states.get(id) ?? { state: 'off' as const, why: 'not on this server' };
  const glyph = glyphOf(pack);
  return { id, title: pack?.title ?? id, ...(glyph && { glyph }), state: s.state, ...(s.why && { why: s.why }) };
}

/** The packs a pack requires, by the packs that provide each (an active one first), the kernel's own left out: it is on every island. */
export function requiredBy(run: Registry, id: string): string[] {
  const pack = run.found.find((p) => p.id === id);
  const out = new Set<string>();
  for (const need of pack?.requires ?? []) {
    const by = providersOf(need, run.found).filter((p) => p !== id && !KERNEL_PACKS.includes(p));
    const pick = by.find((p) => run.states.get(p)?.state === 'active') ?? by[0];
    if (pick) out.add(pick);
  }
  return [...out];
}

/** The pack an item's type is of, as the island's registry has it, else the map's. */
const packOf = (map: Registry, run: Registry, type: string) => (run.type(type) ?? map.type(type))?.pack;

/** Why an item of a type waits on an island that runs `run`, or undefined while its pack is active there. */
export function waitingOf(map: Registry, run: Registry, type: string): Waiting | undefined {
  const pack = packOf(map, run, type);
  if (!pack) return undefined;
  const s = run.states.get(pack);
  if (s?.state === 'active') return undefined;
  return { pack, why: s?.why ?? 'its pack is not on this server' };
}

/**
 * The declarations of each island (by id, with the pack it speaks) and why each item on one waits, for the island
 * answer. `items` are those sent, each with the island it lives on.
 */
export async function islandDeclarations(map: Archipelago, islands: { id: string; pack: string | null }[], items: { id: string; type: string; island?: string }[]) {
  const reg = map.registry;
  const runs = new Map<string, Registry>();
  for (const isle of islands) runs.set(isle.id, await islandRegistry(map, isle.id));
  // How many live items of each type each island holds: what turning its pack off would send waiting.
  const ids = islands.filter((i) => i.pack).map((i) => i.id);
  const counts = ids.length ? (await map.db.query<{ island: string; type: string; n: number }>(`select props->>'island' as island, type, count(*)::int as n from entity where props->>'island' = any($1::text[]) and archived_at is null group by 1, 2 -- index entity_island`, [ids])).rows : [];
  const decls = new Map<string, IslandDecl>();
  for (const isle of islands) {
    const run = runs.get(isle.id)!;
    if (!isle.pack) continue;
    const own = declared(reg, run, isle.pack);
    const going = own.state === 'active' ? new Set([isle.pack, ...dependentsOf(run.packs, [isle.pack])]) : new Set<string>();
    const wouldWait = counts.filter((c) => c.island === isle.id && going.has(packOf(reg, run, c.type) ?? '')).reduce((n, c) => n + c.n, 0);
    decls.set(isle.id, { ...own, requires: requiredBy(run, isle.pack).map((id) => declared(reg, run, id)), off_would_wait: wouldWait });
  }
  const waiting = new Map<string, Waiting>();
  for (const e of items) {
    const run = e.island ? runs.get(e.island) : undefined;
    const w = run && waitingOf(reg, run, e.type);
    if (w) waiting.set(e.id, w);
  }
  return { decls, waiting };
}
