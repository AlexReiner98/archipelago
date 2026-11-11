// Packs on an island map (decisions e_pp5mu6xd, e_rf6q3q34 and e_ubd8satd). A workspace with the setting `islands` on
// knows two kinds of pack, read off the file with no key of its own. An island pack speaks on an island: it declares a
// type that lives on one (src/island-items.ts, livesOnIsland), a link type, or fields on another pack's type. It is
// held to the island rules: its file holds vocabulary (types, links, the rules on its own items), views the kernel
// draws and instructions, and it builds on the shared set alone, requiring the kernel's pack and no other. The shared
// set is the list `shared` in the kernel's pack file: type ids, grown only by the owner's decision. A map pack owns no
// type that lives on an island and brings looks, layouts, views, actions, handlers, uses and reach to the whole map,
// each part judged by the gate it already has (a layout by the sandbox, code by code-runs, reach by core's pack reach
// rule, adding a pack by the owner); it may require other packs. A pack that is both is refused: split it into an
// island pack and a map pack. The kernel's own pack is not judged here. Off is the default: with the setting off,
// nothing here is asked.

import { capabilityOf } from './link-ends.ts';
import { MANIFEST_KEYS, parts, type Manifest } from './manifest.ts';
import { KERNEL_PACKS, needOf } from './packorder.ts';

/** The workspace setting that holds packs to the island rules. Off unless set, and set only on a new workspace. */
export const ISLANDS = 'islands';

/** The keys that are not a pack's on an island map: what it uses of other packs, tools, code, looks and reach. */
const NOT_ISLAND = ['uses', 'actions', 'handlers', 'layouts', 'reach', 'shared'];
/** The keys a pack file may have on an island map: what it is, what it requires, its vocabulary, views and instructions. */
export const ISLAND_KEYS: readonly string[] = MANIFEST_KEYS.filter((k) => !NOT_ISLAND.includes(k));

/** The presets in `styles` that are instructions and views; any other (a look) is not a pack's on an island map. */
const PRESETS_KEPT = ['instruction', 'lens'];

/** What a pack on an island map may build on: the shared set's types and the kernel's link types; and the types known to be actors, which live on no island. */
export interface Shared {
  types: Set<string>;
  links: Set<string>;
  actors?: Set<string>;
}

/** The two kinds of pack, and the kernel's own. */
export type PackKind = 'kernel' | 'island' | 'map';

/** The shared set as the kernel's packs declare it: types core itself declares (task and decision moved there from Work, the owner, 5 Nov 2026, e_rf6q3q34), so a pack on an island map always finds them. */
export function sharedOf(kernel: Manifest[]): Shared {
  return { types: new Set(kernel.flatMap((m) => m.shared ?? [])), links: new Set(kernel.flatMap((m) => parts(m).relations.map((r) => r.id))), actors: actorsOf(kernel) };
}

/** The types of these packs that are actors: actor and every type whose line of `extends` reaches it. */
export function actorsOf(packs: Manifest[], known: Set<string> = new Set(['actor'])): Set<string> {
  const parent = new Map(packs.flatMap((m) => parts(m).types.map((t) => [t.id, t.extends] as const)));
  const actors = new Set([...known, 'actor']);
  for (const id of parent.keys()) {
    const seen = new Set<string>();
    for (let at: string | undefined = id; at && !seen.has(at); at = parent.get(at)) {
      seen.add(at);
      if (actors.has(at)) { for (const s of seen) actors.add(s); break; }
    }
  }
  return actors;
}

/** The types of a pack that live on an island: its own, but actors. A pack's types never carry the kernel flag (src/packs.ts), so none is the kernel's own. */
const islandTypes = (m: Manifest, shared: Shared) => {
  const actors = actorsOf([m], shared.actors);
  return parts(m).types.filter((t) => !actors.has(t.id)).map((t) => t.id);
};

/** What a pack speaks on an island, as phrases: types that live on one, link types, fields on another pack's types. */
function vocabulary(m: Manifest, shared: Shared): string[] {
  const p = parts(m);
  const types = islandTypes(m, shared);
  const added = Object.keys(p.adds);
  return [
    ...(types.length ? [`types ${types.join(', ')}`] : []),
    ...(p.relations.length ? [`links ${p.relations.map((r) => r.id).join(', ')}`] : []),
    ...(added.length ? [`fields on ${added.join(', ')}`] : []),
  ];
}

/** Which kind a pack is: the kernel's own, an island pack (it speaks on an island) or a map pack (everything else). */
export function packKind(m: Manifest, shared: Shared): PackKind {
  if (KERNEL_PACKS.includes(m.id)) return 'kernel';
  return vocabulary(m, shared).length ? 'island' : 'map';
}

/** What of a pack runs or reaches past an island, as phrases: tools, code, looks, computed views, uses, reach, another pack required. */
function running(m: Manifest): string[] {
  const keys = Object.keys(m).filter((k) => !ISLAND_KEYS.includes(k));
  const looks = (m.styles ?? []).filter((s) => !PRESETS_KEPT.includes(s.type ?? 'style')).map((s) => s.id);
  const computed = (m.views ?? []).filter((v) => v.form === undefined).map((v) => v.id);
  const other = (m.requires ?? []).filter((r) => { const n = needOf(r); return n.by === 'event' || (n.by === 'pack' && !KERNEL_PACKS.includes(n.name)); }); // a capability or a type is vocabulary; an event is heard by code
  return [
    ...keys,
    ...(looks.length ? [`looks (${looks.join(', ')})`] : []),
    ...(computed.length ? [`views its code computes (${computed.join(', ')})`] : []),
    ...(other.length ? [`requires ${other.join(', ')}`] : []),
  ];
}

/** Why a pack may not be active on an island map, as sentences; none when it may. A map pack always may; an island pack keeps the island rules, and one that is also a map pack is told to split. */
export function islandProblems(m: Manifest, shared: Shared): string[] {
  if (KERNEL_PACKS.includes(m.id)) return [];
  const words = vocabulary(m, shared);
  if (!words.length) return []; // a map pack: each part is judged by the gate it already has
  const problems: string[] = [];
  const runs = running(m);
  if (runs.length) problems.push(`it is both an island pack (${words.join('; ')}) and a map pack (${runs.join(', ')}): split it into an island pack, words only, and a map pack that owns no type on an island`);
  const p = parts(m);
  const added = Object.keys(p.adds);
  if (added.length) problems.push(`it adds fields to ${added.join(', ')}: a pack adds no fields to another pack's types`);
  const own = new Set(p.types.map((t) => t.id));
  const links = new Set(p.relations.map((r) => r.id));
  const fine = (name: string) => name === '*' || own.has(name) || shared.types.has(name) || capabilityOf(name) !== undefined;
  const named = new Set<string>();
  for (const t of p.types) if (t.extends && !fine(t.extends)) named.add(t.extends);
  for (const r of p.relations) for (const end of [...r.from, ...r.to]) if (!fine(end)) named.add(end);
  for (const r of m.rules ?? []) for (const t of [r.when?.type, r.type].flat()) if (typeof t === 'string' && !fine(t)) named.add(t);
  for (const r of m.requires ?? []) { const n = needOf(r); if (n.by === 'type' && !fine(n.name) && !links.has(n.name) && !shared.links.has(n.name)) named.add(n.name); if (n.of && !fine(n.of)) named.add(n.of); }
  if (named.size) problems.push(`it names ${[...named].join(', ')}, not its own nor in the shared set (${[...shared.types].join(', ')})`);
  const built = p.relations.filter((r) => r.extends && !links.has(r.extends) && !shared.links.has(r.extends)).map((r) => `${r.id} extends ${r.extends}`);
  if (built.length) problems.push(`its links extend another pack's (${built.join('; ')}): only the kernel's or its own`);
  return problems;
}

/** The packs found that an island map does not take, each with why. */
export function islandsOff(found: Iterable<Manifest>, local: string): Map<string, string> {
  const all = [...found];
  const kernel = sharedOf(all.filter((m) => KERNEL_PACKS.includes(m.id)));
  const shared = { ...kernel, actors: actorsOf(all, kernel.actors) };
  const off = new Map<string, string>();
  for (const m of all) {
    if (m.id === local) continue;
    const problems = islandProblems(m, shared);
    if (problems.length) off.set(m.id, `not taken on an island map: ${problems.join('; ')}`);
  }
  return off;
}
