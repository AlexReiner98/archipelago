// An island's legend, as a drawing names it beside the island's border: the pack it speaks, its types and link types,
// and those of the shared set the picture uses there. A small pure helper copied from the loader's island items
// (islandPack), read off the registry a pack is handed.

import type { KernelContext } from '#pelago/kernel';

type Registry = KernelContext['registry'];

/** Whether items of a type live on an island: all but the kernel's own (the kernel flag) and actors. */
const livesOnIsland = (t: { system: boolean; lineage: string[] }) => !t.system && !t.lineage.includes('actor');
/** Whether a type is named in an island's legend: one that lives on an island and extends a starter, nor what is retired or gone. */
const typeOnLegend = (t: { system: boolean; lineage: string[]; retired?: boolean; dormant?: boolean }) => livesOnIsland(t) && t.lineage.length > 1 && !t.retired && !t.dormant;
/** Whether a link type is named in an island's legend: never the kernel's own, nor what is retired or gone. */
const linkOnLegend = (r: { kernel?: boolean; retired?: boolean; dormant?: boolean }) => !r.kernel && !r.retired && !r.dormant;

/** The legend of an island that speaks a pack: its own types and link types, and those of others the picture uses on it. */
export function islandPack(registry: Registry, id: string, used?: { types: Iterable<string>; links: Iterable<string> }) {
  const pack = registry.packs.find((p) => p.id === id);
  if (!pack) return undefined;
  const ownTypes = [...registry.types.values()].filter((t) => t.pack === id && typeOnLegend(t));
  const ownLinks = [...registry.relations.values()].filter((r) => r.pack === id && linkOnLegend(r));
  const usedTypes = [...new Set(used?.types ?? [])].map((t) => registry.types.get(t)).filter((t) => t !== undefined && !ownTypes.includes(t) && livesOnIsland(t) && !t.retired && !t.dormant);
  const usedLinks = [...new Set(used?.links ?? [])].map((r) => registry.relations.get(r)).filter((r) => r !== undefined && !ownLinks.includes(r) && linkOnLegend(r));
  const types = [...ownTypes, ...(usedTypes as typeof ownTypes)];
  const links = [...ownLinks, ...(usedLinks as typeof ownLinks)];
  return {
    id, title: pack.title,
    types: types.map((t) => ({ id: t.id, title: t.title, ...(t.lineage.length > 1 && { is: t.lineage.slice(1) }) })),
    links: links.map((r) => ({ id: r.id, title: r.title })),
  };
}
