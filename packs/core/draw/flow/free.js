// Steps put where a person put them (the owner, 25 Oct 2026: the canvas is flexible), and the wires to them solved
// live, still at right angles. Where things were put on this canvas is the style's `placed`, by item: the page reads it
// from the places stream beside the lens and keeps what was moved here in it, with `moved` over it when given. A wire
// to a step that was put by hand leaves the foot of the step it comes from and comes down into the head of the one it
// goes to, round both when the second is not below the first. Pure: positions in, points out.

/** Where each step of this picture was put by hand: the middle of each, by item. */
export function placesOf(answer, style) {
  return { ...(style.placed ?? {}), ...(style.moved ?? {}) };
}

/** How many of these boxes a path of right angles passes through (each box { x, y, w, h }, its middle and size). */
const crossings = (points, boxes) => {
  let n = 0;
  for (let k = 1; k < points.length; k++) {
    const [[x1, y1], [x2, y2]] = [points[k - 1], points[k]];
    for (const b of boxes) if (Math.max(x1, x2) > b.x - b.w / 2 && Math.min(x1, x2) < b.x + b.w / 2 && Math.max(y1, y2) > b.y - b.h / 2 && Math.min(y1, y2) < b.y + b.h / 2) n++;
  }
  return n;
};

/**
 * A wire at right angles from the foot of a to the head of b (each { x, y, w, h }, x and y its middle), across the
 * track that passes through the fewest of the other steps (`others`), the middle one when more than one ties.
 */
export function route(a, b, lead, others = []) {
  const [ax, ay, bx, by] = [a.x, a.y + a.h / 2, b.x, b.y - b.h / 2];
  const best = (candidates, path) => candidates.map((t) => path(t)).reduce((p, q) => (crossings(q, others) < crossings(p, others) ? q : p));
  // Tracks across, the middle first, out to the very ends of the room (just under the one, just over the other).
  const spread = (from, to, n = 5) => [...Array.from({ length: n }, (_, k) => from + ((to - from) * (k + 0.5)) / n), from, to].sort((p, q) => Math.abs(p - (from + to) / 2) - Math.abs(q - (from + to) / 2));
  if (by - ay >= 2 * lead) return best(spread(ay + lead, by - lead), (my) => [[ax, ay], [ax, my], [bx, my], [bx, by]]);
  // Not below: down out of the first, across beside them both (or between, where there is room), and down into the second.
  const between = Math.abs(bx - ax) >= (a.w + b.w) / 2 + 2 * lead;
  const side = Math.max(ax + a.w / 2, bx + b.w / 2) + lead, other = Math.min(ax - a.w / 2, bx - b.w / 2) - lead;
  const columns = between ? [ax < bx ? (ax + a.w / 2 + bx - b.w / 2) / 2 : (ax - a.w / 2 + bx + b.w / 2) / 2, side, other] : [side, other];
  return best(columns, (cx) => [[ax, ay], [ax, ay + lead], [cx, ay + lead], [cx, by - lead], [bx, by - lead], [bx, by]]);
}

/** The picture's size once steps may be anywhere (never above or left of its corner: the page keeps them there). */
export function sizeOf(g, margin) {
  const steps = g.all.filter((n) => !n.dummy);
  return {
    width: Math.max(g.width, ...steps.map((n) => g.x.get(n.id) + n.w / 2 + margin)),
    height: Math.max(g.height, ...steps.map((n) => g.y.get(n.id) + n.h / 2 + margin)),
  };
}
