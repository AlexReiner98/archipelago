// Layer: shape. Each wire's points, at right angles only: out of its first item (its top, its foot, or its right side
// into its gutter), down or up to its track in each street it crosses, across, and so on to its last item. A bracket
// joins two items of one column in their gutter. Pure: ends, stops, tracks and rows' y in; points out.

/** The points with each one that lies on the line through its neighbours left out, and each repeat. */
export function simplified(points) {
  const out = [];
  for (const p of points) {
    if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue;
    if (out.length > 1) {
      const [a, b] = [out.at(-2), out.at(-1)];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Where an end stands down: the top, middle and foot of its box, in a row that stands at `rowY`. */
const downOf = (g, rowY) => {
  const top = rowY[g.row] + g.box.y;
  return { top, mid: top + g.box.h / 2, foot: top + g.box.h };
};

/** From the item to where the wire meets its first street (or, reversed, from its last street to the item). */
function lead(g, rowY) {
  if (g.side === 'port') return [[g.x, rowY[g.row]]];
  const { top, mid, foot } = downOf(g, rowY);
  if (g.side === 'top') return [[g.x, top]];
  if (g.side === 'bottom') return [[g.x, foot]];
  return [[g.box.x + g.box.w, mid], [g.x, mid]];
}

/** A wire through the streets: { a, b, stops, track (each run's y, or null to go straight) }. */
export function routed({ a, b, stops, track }, rowY) {
  const points = [...lead(a, rowY)];
  let x = stops[0];
  track.forEach((y, k) => {
    if (y === null) return;
    points.push([x, y], [stops[k + 1], y]);
    x = stops[k + 1];
  });
  points.push(...lead(b, rowY).reverse());
  return simplified(points);
}

/** Two items of one column joined in their gutter, at lane x: out of one's right side, along, into the other's. */
export function bracket(a, b, x) {
  return [[a.x + a.w, a.y + a.h / 2], [x, a.y + a.h / 2], [x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2]];
}
