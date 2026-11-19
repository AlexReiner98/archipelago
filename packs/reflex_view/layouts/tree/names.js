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

/** A shape's bounds, [left, top, right, bottom]. */
const boundsOf = (shape) => [Math.min(...shape.map((c) => c[0])), Math.min(...shape.map((c) => c[1])), Math.max(...shape.map((c) => c[0])), Math.max(...shape.map((c) => c[1]))];
/** Whether two bounds meet. */
const meet = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** The ids whose names show at `f`, each name's box with it: { shown: Set, boxes: Map }. */
export function namesShown(tree, placed, counts, z, n, f) {
  const pad = z('reflex_name_pad') * f;
  const asked = [...placed.labels.values()].sort((a, b) => {
    const na = tree.nodes.get(a.id), nb = tree.nodes.get(b.id);
    return Math.sign(nb.kids.length) - Math.sign(na.kids.length) || (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || na.depth - nb.depth || (a.id < b.id ? -1 : 1);
  });
  // Each wire as its segments, by the node it runs to, each with its bounds: a shape whose bounds miss is never tested
  // whole (a tree of hundreds of nodes has thousands of segments).
  const segs = [...placed.along].flatMap(([id, points]) => points.slice(1).map((p, k) => ({ id, seg: [points[k], p], b: boundsOf([points[k], p]) })));
  const shown = new Set(), boxes = new Map(), kept = [];
  for (const l of asked) {
    const box = boxOf(l, f, pad), b = boundsOf(box), node = tree.nodes.get(l.id);
    // Its own wires, in and out, run from where its name starts: they do not stop it.
    const own = new Set([l.id, ...node.kids.map((k) => k.id)]);
    if (kept.some((other) => meet(b, other.b) && overlap(box, other.box))) continue;
    if (segs.some((w) => !own.has(w.id) && meet(b, w.b) && overlap(w.seg, box))) continue;
    kept.push({ box, b });
    shown.add(l.id);
    boxes.set(l.id, boxOf(l, f, 0));
  }
  return { shown, boxes };
}

/** A name's transform at `f`, in its node's group (which stands at the node): turned along its ray, scaled. Its text stands at `nameAt`, in that frame. */
export const nameTransform = (l, f, at) => `rotate(${at(l.turn)}) scale(${Math.round(f * 1000) / 1000})`;
/** Where a name's text stands in its own frame, and how it is anchored: outward or inward, read left to right. */
export function nameAt(l) {
  // Read left to right: on the left the frame is turned half round, so along the ray is its negative x.
  const sign = l.right ? 1 : -1, along = l.out * sign;
  return { x: along * l.gap, y: -l.lift * sign, anchor: along > 0 ? 'start' : 'end' };
}

/**
 * Names chosen again as the page zooms, once it settles: while the plane moves the names scale with the picture, and
 * once no move has come for `settle` ms the names are laid at their size there and which show is chosen again, and
 * only what changed is sent (a name's size where it shows; whether it shows). Applying a change to every name on each
 * step of a zoom held the page for tens of milliseconds a step on a tree of hundreds of nodes.
 * `choose(f)` answers the set of ids shown at `f`; `labels` are every name laid out; `send(patches)` sends.
 */
export function rescaler({ labels, choose, shownAt, rescale, least, settle, at, send, by = 1 }) {
  let f = 1, shown = shownAt, timer = null, wanted = 1;
  const sized = new Map([...labels.values()].map((l) => [l.id, 1]));
  const apply = () => {
    timer = null;
    if (Math.abs(Math.log(wanted / f)) < Math.log(rescale)) return;
    f = wanted;
    const next = choose(f), out = [];
    for (const l of labels.values()) {
      const on = next.has(l.id);
      if (on !== shown.has(l.id)) out.push({ key: `nm:${l.id}`, toggle: { 'rt-quiet': !on } });
      // A name that does not show keeps the size it had: it is laid again when it shows.
      if (on && sized.get(l.id) !== f) (sized.set(l.id, f), out.push({ key: `nm:${l.id}`, set: { transform: nameTransform(l, f, at) } }));
    }
    shown = next;
    if (out.length) send(out);
  };
  return {
    viewport(view) {
      // `by`: the picture's units a unit of its box shows at, where its frame is fitted into a box of another size.
      wanted = 1 / Math.max(least, (Number(view?.scale) || 1) * by);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(apply, settle);
      return [];
    },
    end: () => timer !== null && clearTimeout(timer),
  };
}
