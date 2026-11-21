/**
 * Which island each drawn item is in. No pack owns a part of the data, so
 * an island is a link: an item is in the island it is part_of at any depth
 * (an item of kind `island`), or, by the other way, in the top of its
 * part_of chain. An item in neither is in the sea ("No island"). Pure.
 */
import type { Id, Json } from "../../spec/common.ts";
import type { FieldIn } from "./graph.ts";

interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}
interface Wire extends Row {
  from: Id;
  to: Id;
}
/** What it reads of `find.index`. */
export interface Source {
  item(id: Id): Row | undefined;
  linksOf(id: Id): Wire[];
  closed(row: Row): boolean;
}

export const BY = ["island items", "top of part_of"] as const;
const SEA = "sea";

export function fieldOf(src: Source, result: { items: Row[]; links: Wire[] }, by: number): FieldIn {
  // Each item's parents along part_of, read once per item met, at most 12 steps up.
  const parents = new Map<Id, Id[]>();
  const up = (id: Id) => {
    let p = parents.get(id);
    if (!p) parents.set(id, (p = src.linksOf(id).filter((l) => l.type === "part_of" && l.from === id && l.to !== id).map((l) => l.to)));
    return p;
  };
  const isIsland = (id: Id) => src.item(id)?.fields.kind === "island";
  const found = new Map<Id, Id>();
  const islandOf = (id: Id): Id => {
    const had = found.get(id);
    if (had) return had;
    let at = SEA;
    const seen = new Set([id]);
    if (by === 0) {
      // Breadth first, so the nearest island wins.
      let ring = [id];
      for (let depth = 0; depth <= 12 && ring.length && at === SEA; depth++) {
        const next: Id[] = [];
        for (const x of ring) {
          if (isIsland(x)) {
            at = x;
            break;
          }
          for (const p of up(x)) if (!seen.has(p) && src.item(p)) seen.add(p), next.push(p);
        }
        ring = next;
      }
    } else {
      // Up the first parent (by id, so it is the same each time) to the top.
      let x = id;
      for (let depth = 0; depth < 12; depth++) {
        const ps = up(x).filter((p) => !seen.has(p) && src.item(p)).sort();
        if (!ps.length) break;
        x = ps[0]!;
        seen.add(x);
      }
      // An item others are part of, at the top of its own chain, is its own island.
      if (x !== id) at = x;
      else if (src.linksOf(id).some((l) => l.type === "part_of" && l.to === id)) at = id;
    }
    found.set(id, at);
    return at;
  };
  const items = result.items.map((r) => ({
    id: r.id,
    title: String(r.fields.title ?? r.id),
    type: r.type,
    status: String(r.fields.status ?? ""),
    closed: src.closed(r),
    island: islandOf(r.id),
  }));
  const ids = [...new Set(items.map((it) => it.island))];
  return {
    items,
    islands: ids.map((id) => ({ id, title: id === SEA ? "No island" : String(src.item(id)?.fields.title ?? id) })),
    links: result.links.map((l) => ({ id: l.id, type: l.type, from: l.from, to: l.to })),
  };
}
