// What an island declares, as the island answer says it (task e_ter3cwup; decisions e_cy9dfsna, e_57bjxy2x,
// e_e3ss8nqm): the pack it speaks and the packs that one requires, each with its state on this island (active,
// waiting or off) and why, read from the registry the island runs (packs/loader/kernel/island-pin.ts), and how many
// of its items turning its pack off there would send waiting. An item waits when its type's pack is not active on its
// island: derived each time, nothing written to it, so it wakes by itself when the pack is back. A pack's glyph is what
// the looks on its types say (decision e_3c3wr7jv), else its own style preset's; with none the page shows its initial.

import { packParts, type PartKind } from './island-parts.ts';
import { islandRegistry } from './island-pin.ts';
import { packLayer, styleSources, type Sources } from './island-style.ts';
import { dependentsOf, KERNEL_PACKS, providersOf, type PackState } from './packorder.ts';
import type { PackFile, Registry } from './packs.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

/** A part of a pack as an island's header names it: its state there, and what it lacks while it waits (feature e_4r82mvf3). */
export interface DeclaredPart { id: string; kind: PartKind; state: PackState['state']; lacks?: string[] }
/** A name a pack requires, and the pack active on the island that gives it, if one does. */
export interface Consumed { name: string; by?: string }
/**
 * A pack as an island's header names it: its state there and why, its parts with theirs, the names it gives there
 * (`type:<id>` for each type and link type it declares on that island), the names it requires with who gives each, and
 * what it lacks while it waits.
 */
export interface Declared {
  id: string; title: string; glyph?: string; state: PackState['state']; why?: string; /** The kernel's own: always on, never turned off. */ kernel?: true;
  parts: DeclaredPart[]; provides: string[]; consumes: Consumed[]; lacks?: string[];
}
/** An island's own pack, with what it requires and what turning it off there would send waiting. */
export type IslandDecl = Declared & { requires: Declared[]; off_would_wait: number };
/** Why an item waits: the pack of its type, not active on its island, and why. */
export interface Waiting { pack: string; why: string }

/** The glyph a pack's style preset gives it, if any (decision e_e3ss8nqm). */
export const glyphOf = (pack: PackFile | undefined): string | undefined => {
  const preset = (pack?.styles ?? []).find((s) => (s.type ?? 'style') === 'style' && typeof s.props?.glyph === 'string' && s.props.glyph !== '');
  return preset?.props.glyph as string | undefined;
};

/**
 * A pack's glyph: what the looks on its types say (a preset a map pack ships, the owner's version of it, a style kept
 * on its types: decision e_3c3wr7jv, F), read as the map runs its packs, else its own style preset's.
 */
const glyphFor = (map: Registry, id: string, pack: PackFile | undefined, sources?: Sources) => {
  const said = sources && packLayer(map, id, sources).glyph;
  return typeof said === 'string' && said !== '' ? said : glyphOf(pack);
};

/**
 * A pack's parts on an island: each it declares, in its manifest's order, with its state there. The island's registry
 * runs the pack without the parts it turned off and what needs them (packs/loader/kernel/island-parts.ts), so those are
 * read from its part states; a part of a pack not active there takes the pack's state. The kernel's own has none to show.
 */
function partsOn(map: Registry, run: Registry, id: string, state: PackState['state']): DeclaredPart[] {
  if (KERNEL_PACKS.includes(id)) return [];
  const here = run.found.find((p) => p.id === id), whole = map.found.find((p) => p.id === id);
  const named = [...(whole ? packParts(whole) : []), ...(here ? packParts(here) : [])];
  for (const [pid, ps] of run.partStates) if (ps.pack === id) named.push({ id: pid, kind: ps.kind, needs: [] });
  const seen = new Set<string>();
  return named.filter((p) => !seen.has(p.id) && seen.add(p.id)).map((p) => {
    const ps = run.partStates.get(p.id);
    if (ps?.pack === id) return { id: p.id, kind: p.kind, state: ps.state, ...(ps.state === 'waiting' && { lacks: ps.lacks }) };
    return { id: p.id, kind: p.kind, state };
  });
}

/** The names a pack requires, each with the pack active on the island that gives it (itself and none left out). */
const consumesOn = (run: Registry, pack: PackFile | undefined): Consumed[] => (pack?.requires ?? []).map((name) => {
  const by = providersOf(name, run.found).find((p) => p !== pack!.id && run.states.get(p)?.state === 'active');
  return { name, ...(by && { by }) };
});

/** The names a pack gives on an island: each type and link type it declares there, parts off taken out. */
const providesOn = (pack: PackFile | undefined): string[] =>
  pack ? [...(pack.types ?? []).flatMap((t) => ('of' in t ? [] : [`type:${t.id}`])), ...(pack.links ?? []).map((r) => `type:${r.id}`)] : [];

/** A pack as found here, with its state in a registry an island runs, its parts, and what it gives, takes and lacks. */
function declared(map: Registry, run: Registry, id: string, sources?: Sources): Declared {
  const here = run.found.find((p) => p.id === id), pack = here ?? map.found.find((p) => p.id === id);
  const s = run.states.get(id) ?? { state: 'off' as const, why: 'not on this server' };
  const glyph = glyphFor(map, id, pack, sources);
  return {
    id, title: pack?.title ?? id, ...(glyph && { glyph }), state: s.state, ...(s.why && { why: s.why }), ...(KERNEL_PACKS.includes(id) && { kernel: true as const }),
    parts: partsOn(map, run, id, s.state), provides: providesOn(here), consumes: consumesOn(run, pack),
    ...(s.state === 'waiting' && s.lacks?.length && { lacks: s.lacks }),
  };
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
export async function islandDeclarations(map: Archipelago, islands: { id: string; pack: string | null }[], items: { id: string; type: string; island?: string }[], given?: Sources) {
  const reg = map.registry, sources = given ?? (await styleSources(map));
  const runs = new Map<string, Registry>();
  for (const isle of islands) runs.set(isle.id, await islandRegistry(map, isle.id));
  // How many live items of each type each island holds: what turning its pack off would send waiting.
  const ids = islands.filter((i) => i.pack).map((i) => i.id);
  const counts = ids.length ? (await map.db.query<{ island: string; type: string; n: number }>(`select props->>'island' as island, type, count(*)::int as n from entity where props->>'island' = any($1::text[]) and archived_at is null group by 1, 2 -- index entity_island`, [ids])).rows : [];
  const decls = new Map<string, IslandDecl>();
  for (const isle of islands) {
    const run = runs.get(isle.id)!;
    if (!isle.pack) continue;
    const own = declared(reg, run, isle.pack, sources);
    const going = own.state === 'active' ? new Set([isle.pack, ...dependentsOf(run.packs, [isle.pack])]) : new Set<string>();
    const wouldWait = counts.filter((c) => c.island === isle.id && going.has(packOf(reg, run, c.type) ?? '')).reduce((n, c) => n + c.n, 0);
    decls.set(isle.id, { ...own, requires: requiredBy(run, isle.pack).map((id) => declared(reg, run, id, sources)), off_would_wait: wouldWait });
  }
  const waiting = new Map<string, Waiting>();
  for (const e of items) {
    const run = e.island ? runs.get(e.island) : undefined;
    const w = run && waitingOf(reg, run, e.type);
    if (w) waiting.set(e.id, w);
  }
  return { decls, waiting };
}
