// What a pack's code may write (Rule 8 of the target model, packs in space): the types, link types and fields of
// the pack itself, of the packs it requires and what they require, of those it uses while they are active, and
// core's. Core's rule pack_reach refuses a change a pack's action or handler makes outside it (src/rules.ts).

import type { Registry } from './packs.ts';

const reaches = new WeakMap<Registry['packs'], Map<string, Set<string>>>();

/** The packs whose types a pack's code may write, as the registry stands: read again after every reload. */
export function reachOf(reg: Pick<Registry, 'packs'>, pack: string): Set<string> {
  const cache = reaches.get(reg.packs) ?? reaches.set(reg.packs, new Map()).get(reg.packs)!;
  const known = cache.get(pack);
  if (known) return known;
  const active = new Map(reg.packs.map((p) => [p.id, p]));
  const out = new Set<string>(['core']);
  const visit = (id: string) => {
    if (out.has(id) && id !== 'core') return;
    out.add(id);
    for (const r of active.get(id)?.requires ?? []) visit(r);
  };
  visit(pack);
  for (const u of active.get(pack)?.uses ?? []) if (active.has(u)) visit(u);
  cache.set(pack, out);
  return out;
}

/** Whether a type or link type is in a pack's reach. One the registry does not know is for the write path to refuse. */
export function inReach(reg: Pick<Registry, 'packs' | 'types' | 'relations'>, pack: string, typeOrLink: string): boolean {
  const def = reg.types.get(typeOrLink) ?? reg.relations.get(typeOrLink);
  return !def || reachOf(reg, pack).has(def.pack);
}

/** Whether a field of a type is in a pack's reach: one another pack added to the type, or to what it extends, is that pack's. */
export function fieldInReach(reg: Pick<Registry, 'packs' | 'types' | 'added'>, pack: string, type: string, field: string): boolean {
  for (const t of reg.types.get(type)?.lineage ?? [type]) {
    const by = reg.added.get(t)?.get(field);
    if (by) return reachOf(reg, pack).has(by);
  }
  return true;
}
