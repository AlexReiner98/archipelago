// What hangs on each item of the knot: the trees peeled off it, each a comb on the side its way says, and the block an item
// takes with them. Layer: graph, with the comb's own lengths until combs are wires of the solver. Pure: steps in, combs out.

import { comb, peel } from './combs.js';

/** `a` is who is joined to whom, `ways` how each link runs; answers with the core, the combs, and each item's block. */
export function hangsOf({ a, ways, nodes, sizes, gap, z, aspect }) {
  const stepSize = (id) => nodes.get(id), firm = (p, q) => (ways.get(`${p} ${q}`) ?? ways.get(`${q} ${p}`) ?? 0) > 1;
  const zc = { row: gap / 4, col: gap, stub: z.run, join: z.join, bus: sizes.flow_comb_bus }, combGap = Math.max(gap, z.join);
  // In a small picture a headed link is a wire in the rows, so a chain reads straight down; a big one needs the room combs save.
  const { kids, core } = peel(a, new Set(), nodes.size <= sizes.plane_rows_most ? firm : undefined);
  // What comes before an item hangs above it, and the rest below; `lead` is the room over the box.
  const sideOf = (p, k) => (ways.has(`${p} ${k}`) ? 1 : ways.has(`${k} ${p}`) ? -1 : 0);
  const combs = new Map(core.map((id) => {
    const sides = (kids.get(id) ?? []).map((k) => sideOf(id, k) || 1), how = { level: true, near: true, alone: new Set(sides).size < 2, aspect };
    return [id, { down: comb(id, kids, stepSize, zc, sideOf, 1, 1, how), up: comb(id, kids, stepSize, zc, sideOf, -1, 1, how) }];
  }));
  /** How far each comb's level sits from the middle of the box, where there are two. */
  const portOff = (id) => {
    const { down, up } = combs.get(id);
    return down.items.length && up.items.length ? Math.min(stepSize(id).h / 4, zc.row / 2) : 0;
  };
  const block = (id) => {
    const s = stepSize(id), { down, up } = combs.get(id);
    if (!down.items.length && !up.items.length) return { w: s.w, h: s.h, lead: 0 };
    // A kid alone sits level with the box, half of it either side; a comb hangs clear of it on its own side.
    const off = portOff(id), over = ([hang, other]) => Math.max(s.h / 2, hang.items.length ? hang.h + off : 0, other.above ?? 0);
    const top = over([up, down]), foot = over([down, up]);
    return { w: s.w + combGap + Math.max(down.w, up.w), h: top + foot, lead: top - s.h / 2 };
  };
  return { kids, core, combs, combGap, portOff, block };
}

/** The core's connected parts. */
export function partsOf(core, a) {
  const inCore = new Set(core), seen = new Set(), parts = [];
  for (const s of core) {
    if (seen.has(s)) continue;
    const list = [s];
    seen.add(s);
    for (let k = 0; k < list.length; k++) for (const w of a.get(list[k])) if (inCore.has(w) && !seen.has(w)) (seen.add(w), list.push(w));
    parts.push(list);
  }
  return parts;
}
