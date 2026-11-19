// Layer: marks. Which names show: names give way (the owner, 19 Nov 2026). Every node's name is laid out along its
// ray (./radial.js), and shows only where it has room: the more important first, a bough before a leaf, then the
// node said more often, then the one nearer the root; a name whose box (padded by reflex_name_pad) would meet a name
// already shown, or a wire other than its own, gives way, and its node is a dot with its name in its tooltip. Room is
// judged at the page's zoom: names keep one size on screen, so zoomed in each is smaller on the picture and more
// show (`f`, the picture's units a screen unit of name takes). A lit node shows its name whatever (./play.js).

import { boxOf } from './radial.js';

/** Whether two convex shapes (lists of corners) overlap: no axis of either's edges parts them. */
export const overlap = (a, b) => {
  for (const shape of [a, b])
    for (let i = 0; i < shape.length; i++) {
      const [x1, y1] = shape[i], [x2, y2] = shape[(i + 1) % shape.length], nx = y2 - y1, ny = x1 - x2;
      const pa = a.map(([x, y]) => x * nx + y * ny), pb = b.map(([x, y]) => x * nx + y * ny);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  return true;
};

/** The ids whose names show at `f`, each name's box with it: { shown: Set, boxes: Map }. */
export function namesShown(tree, placed, counts, z, n, f) {
  const pad = z('reflex_name_pad') * f;
  const asked = [...placed.labels.values()].sort((a, b) => {
    const na = tree.nodes.get(a.id), nb = tree.nodes.get(b.id);
    return Math.sign(nb.kids.length) - Math.sign(na.kids.length) || (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || na.depth - nb.depth || (a.id < b.id ? -1 : 1);
  });
  // Each wire as its segments, by the node it runs to.
  const wires = [...placed.along].map(([id, points]) => ({ id, segs: points.slice(1).map((p, k) => [points[k], p]) }));
  const shown = new Set(), boxes = new Map(), kept = [];
  for (const l of asked) {
    const box = boxOf(l, f, pad), node = tree.nodes.get(l.id);
    // Its own wires, in and out, run from where its name starts: they do not stop it.
    const own = new Set([l.id, ...node.kids.map((k) => k.id)]);
    if (kept.some((other) => overlap(box, other))) continue;
    if (wires.some((w) => !own.has(w.id) && w.segs.some((seg) => overlap(seg, box)))) continue;
    kept.push(box);
    shown.add(l.id);
    boxes.set(l.id, boxOf(l, f, 0));
  }
  return { shown, boxes };
}

/** A name's transform at `f`: at its node, turned along its ray, scaled. Its text stands at `nameAt`, in that frame. */
export const nameTransform = (l, f, at) => `translate(${at(l.x)} ${at(l.y)}) rotate(${at(l.turn)}) scale(${Math.round(f * 1000) / 1000})`;
/** Where a name's text stands in its own frame, and how it is anchored: outward or inward, read left to right. */
export function nameAt(l) {
  // Read left to right: on the left the frame is turned half round, so along the ray is its negative x.
  const sign = l.right ? 1 : -1, along = l.out * sign;
  return { x: along * l.gap, y: -l.lift * sign, anchor: along > 0 ? 'start' : 'end' };
}
