// Layer: metrics. Each block's own geometry: where each member stands in it, its columns side by side with a gutter
// to the right of each as wide as the wires it holds (their lanes packed by the left-edge method, ./tracks.js), and the
// quiet lines that tie each part to its whole: a spine down from the whole and a short stub to each part, a bus across
// the top of the columns. Pure: blocks, their gutters' runs and the style's lengths in; sizes and places in the block out.

import { packed } from './tracks.js';

/**
 * A block's geometry: { w, h, at: id -> { x, y } from its top left, lane: run key -> x, spines: part link points }.
 * `runs` are the gutters' runs (./plan.js gutterRuns) by gutter name.
 */
export function shapeOf(block, itemsById, runs, z) {
  const head = itemsById.get(block.head), at = new Map([[block.head, { x: 0, y: 0 }]]), lane = new Map(), spines = [];
  if (!block.columns.length) return { w: head.w, h: head.h, at, lane, spines };
  const top = head.h, bus = top + z.line / 2, last = block.columns.length - 1;
  const xs = [];
  let x = 0;
  block.columns.forEach((c, k) => {
    xs.push(x);
    for (const l of c.lines) at.set(l.id, { x: x + z.indent * (1 + l.depth), y: l.y });
    let right = Math.max(...c.lines.map((l) => at.get(l.id).x + itemsById.get(l.id).w));
    if (k === last) right = Math.max(right, head.w);
    const { track, count } = packed(runs.get(`${block.id}:${k}`) ?? [], z.lane / 2);
    for (const [key, t] of track) lane.set(key, right + z.lane * (1 + t));
    x = right + z.lane * count + (k === last ? 0 : z.gap);
  });
  // The tree: each whole's spine from its foot, a stub to each part's left; a column's parts of the head hang from the bus.
  const midOf = (id) => at.get(id).y + itemsById.get(id).h / 2;
  for (const [part, whole] of block.parent) {
    const p = at.get(part), s = at.get(whole);
    if (whole === block.head) {
      const k = block.columns.findIndex((c) => c.lines.some((l) => l.id === part)), spine = xs[k] + z.indent / 2;
      spines.push({ part, whole, points: k === 0 ? [[spine, top], [spine, midOf(part)], [p.x, midOf(part)]] : [[z.indent / 2, top], [z.indent / 2, bus], [spine, bus], [spine, midOf(part)], [p.x, midOf(part)]] });
    } else {
      const spine = s.x + z.indent / 2;
      spines.push({ part, whole, points: [[spine, s.y + itemsById.get(whole).h], [spine, midOf(part)], [p.x, midOf(part)]] });
    }
  }
  return { w: x, h: block.h, at, lane, spines };
}
