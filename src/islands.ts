// Packs on an island map (decisions e_pp5mu6xd and e_rf6q3q34): a workspace with the setting `islands` on takes a pack
// only if its file holds vocabulary (types, links, the rules on its own items), views and instructions, and builds on
// the shared set alone. The shared set is the list `shared` in the kernel's pack file: type ids, grown only by the
// owner's decision. Its views are those the kernel draws (a tree, a screen, a reason for attention, a lens): a read
// a pack's code computes runs code, which is not a pack's on an island map. A pack there requires the kernel's pack and no other, uses none, adds no fields to another pack's
// types, and its types, links and rules name only its own types, the shared set, a capability or anything (`*`).
// The kernel's own pack is not judged here. Off is the default: with the setting off, nothing here is asked.

import { capabilityOf } from './link-ends.ts';
import { MANIFEST_KEYS, parts, type Manifest } from './manifest.ts';
import { KERNEL_PACKS } from './packorder.ts';

/** The workspace setting that holds packs to the island rules. Off unless set, and set only on a new workspace. */
export const ISLANDS = 'islands';

/** The keys that are not a pack's on an island map: what it uses of other packs, tools, code, looks and reach. */
const NOT_ISLAND = ['uses', 'actions', 'handlers', 'layouts', 'reach', 'shared'];
/** The keys a pack file may have on an island map: what it is, what it requires, its vocabulary, views and instructions. */
export const ISLAND_KEYS: readonly string[] = MANIFEST_KEYS.filter((k) => !NOT_ISLAND.includes(k));

/** The presets in `styles` that are instructions and views; any other (a look) is not a pack's on an island map. */
const PRESETS_KEPT = ['instruction', 'lens'];

/** What a pack on an island map may build on: the shared set's types, and the kernel's link types. */
export interface Shared {
  types: Set<string>;
  links: Set<string>;
}

/** The shared set as the kernel's packs declare it: types core itself declares (task and decision moved there from Work, the owner, 5 Nov 2026, e_rf6q3q34), so a pack on an island map always finds them. */
export function sharedOf(kernel: Manifest[]): Shared {
  return { types: new Set(kernel.flatMap((m) => m.shared ?? [])), links: new Set(kernel.flatMap((m) => parts(m).relations.map((r) => r.id))) };
}

/** Why a pack may not be active on an island map, as sentences; none when it may. */
export function islandProblems(m: Manifest, shared: Shared): string[] {
  if (KERNEL_PACKS.includes(m.id)) return [];
  const problems: string[] = [];
  const keys = Object.keys(m).filter((k) => !ISLAND_KEYS.includes(k));
  if (keys.length) problems.push(`its file holds ${keys.join(', ')}: a pack holds only vocabulary, views and instructions`);
  const looks = (m.styles ?? []).filter((s) => !PRESETS_KEPT.includes(s.type ?? 'style')).map((s) => s.id);
  if (looks.length) problems.push(`styles holds looks (${looks.join(', ')}): of styles, a pack keeps only instructions and views`);
  const computed = (m.views ?? []).filter((v) => v.form === undefined).map((v) => v.id);
  if (computed.length) problems.push(`views holds reads its code computes (${computed.join(', ')}): a pack's views are drawn (a tree, a screen, attention, a lens)`);
  const other = (m.requires ?? []).filter((p) => !KERNEL_PACKS.includes(p));
  if (other.length) problems.push(`it requires ${other.join(', ')}: a pack builds on the shared set alone, never on another pack`);
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
  if (named.size) problems.push(`it names ${[...named].join(', ')}, not its own nor in the shared set (${[...shared.types].join(', ')})`);
  const built = p.relations.filter((r) => r.extends && !links.has(r.extends) && !shared.links.has(r.extends)).map((r) => `${r.id} extends ${r.extends}`);
  if (built.length) problems.push(`its links extend another pack's (${built.join('; ')}): only the kernel's or its own`);
  return problems;
}

/** The packs found that an island map does not take, each with why. */
export function islandsOff(found: Iterable<Manifest>, local: string): Map<string, string> {
  const all = [...found];
  const shared = sharedOf(all.filter((m) => KERNEL_PACKS.includes(m.id)));
  const off = new Map<string, string>();
  for (const m of all) {
    if (m.id === local) continue;
    const problems = islandProblems(m, shared);
    if (problems.length) off.set(m.id, `not taken on an island map: ${problems.join('; ')}`);
  }
  return off;
}
