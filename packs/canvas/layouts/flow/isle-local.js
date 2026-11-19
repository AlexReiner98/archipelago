// Each island drawn about its own corner (task: draw only what a query edit changes). Layer: marks. What an island
// holds and its land are drawn in its own units, from the top left of its land, inside a group moved to where the
// island stands: an island that only moved (another opened beside it) is the same marks under another move, which the
// page keeps as they are and moves (packs/walls/page/layout.js). Its places are rounded to a thousandth of a unit, so
// the same island laid out at another place says its marks alike. Pure: the model in, places and marks out.

/** A place in an island's own units, the same however far the island was moved. */
const near = (v) => Math.round(v * 1000) / 1000;

/** Each island's corner: the top left of its land, by its id. */
export function cornersOf(g) {
  return new Map((g.islands ?? []).filter((i) => i.land?.length).map((i) => [i.id, [Math.min(...i.land.map((r) => r.l)), Math.min(...i.land.map((r) => r.t))]]));
}

/** Where a step of island `id` stands in that island's own units: `[x, y]` less its corner, none for no island. */
export const localTo = (corners) => (id, [x, y]) => ((c) => (c ? [near(x - c[0]), near(y - c[1])] : [x, y]))(corners.get(id));

/** The islands as the marks of their land read them, each about its own corner. */
export function localIslands(g, corners) {
  const by = (c) => (r) => ({ l: near(r.l - c[0]), t: near(r.t - c[1]), r: near(r.r - c[0]), b: near(r.b - c[1]) });
  const at = (c, [x, y]) => [near(x - c[0]), near(y - c[1])];
  return (g.islands ?? []).map((i) => {
    const c = corners.get(i.id);
    if (!c) return i;
    return { ...i, land: i.land.map(by(c)), name: at(c, i.name), entries: i.entries.map((e) => at(c, e)), ...(i.look && { look: { ...i.look, at: at(c, i.look.at) } }), ...(i.canvas && { canvas: { ...i.canvas, at: at(c, i.canvas.at) } }) };
  });
}

/** A group's move to an island's corner. */
export const moveTo = ([x, y]) => `translate(${x} ${y})`;

/**
 * `marks` (one for each of `steps`) with those of an island in one group each, moved to its corner, where its first
 * step stood; what stands on no island stays as it is.
 */
export function grouped(steps, marks, corners, m) {
  const groups = new Map(), out = [];
  steps.forEach((n, k) => {
    const id = n.item?.island, c = corners.get(id);
    if (!c) return void out.push(marks[k]);
    if (!groups.has(id)) out.push((groups.set(id, m('g', { key: `isle:${id}`, transform: moveTo(c) })), groups.get(id)));
    groups.get(id).push(marks[k]);
  });
  return out;
}
