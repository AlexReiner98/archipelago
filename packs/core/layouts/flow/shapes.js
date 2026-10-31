// Where a wire meets a step, on the outline that is drawn and not on its box: a diamond's slopes, a pill's round ends, a
// sheet's wave. These are the shapes `outline` in ./index.js draws. Pure: a step and a line in, points out.

const near = (a, b) => Math.abs(a - b);

/** The foot of a sheet at `x`: its wave, two curves, read at enough points to land on. */
function waveAt(x, cx, cy, w, h) {
  const [l, r, b] = [cx - w / 2, cx + w / 2, cy + h / 2];
  const curve = (p0, p1, p2, p3) => Array.from({ length: 25 }, (_, k) => { const t = k / 24, u = 1 - t; return [u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0], u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]]; });
  const wave = [...curve([r, b - 5], [r - w / 4, b - 13], [cx + w / 8, b + 5], [cx, b - 3]), ...curve([cx, b - 3], [cx - w / 8, b - 11], [l + w / 4, b + 5], [l, b - 3])];
  return wave.reduce((best, p) => (near(p[0], x) < near(best[0], x) ? p : best))[1];
}

/** Where a wire running down or up the page at `x`, coming from `side` (-1 above, 1 below), meets the shape. */
function downTo(n, cx, cy, x, side) {
  const hw = n.w / 2, hh = n.h / 2, dx = Math.min(hw, near(x, cx));
  if (n.shape === 'diamond') return cy + side * hh * (1 - dx / hw);
  if (n.shape === 'pill' || n.shape === 'end') {
    const over = Math.max(0, dx - (hw - hh));
    return cy + side * Math.sqrt(Math.max(0, hh * hh - over * over));
  }
  if (n.shape === 'sheet' && side > 0) return waveAt(x, cx, cy, n.w, n.h);
  return cy + side * hh;
}

/** Where a wire running across the page at `y`, coming from `side` (-1 left, 1 right), meets the shape. */
function acrossTo(n, cx, cy, y, side) {
  const hw = n.w / 2, hh = n.h / 2, dy = Math.min(hh, near(y, cy));
  if (n.shape === 'diamond') return cx + side * hw * (1 - dy / hh);
  if (n.shape === 'pill' || n.shape === 'end') return cx + side * (hw - hh + Math.sqrt(Math.max(0, hh * hh - dy * dy)));
  return cx + side * hw;
}

/** The end of a wire at step `n`, set on its outline, `from` being the point before it on the line. */
export function landOn(n, cx, cy, end, from) {
  if (end[0] === from[0]) return [end[0], downTo(n, cx, cy, end[0], Math.sign(from[1] - cy) || -1)];
  if (end[1] === from[1]) return [acrossTo(n, cx, cy, end[1], Math.sign(from[0] - cx) || -1), end[1]];
  // A straight line, not at right angles: along it to the outline.
  const dx = from[0] - cx, dy = from[1] - cy, reach = n.shape === 'diamond' ? Math.abs(dx) / (n.w / 2) + Math.abs(dy) / (n.h / 2) : Math.max(Math.abs(dx) / (n.w / 2), Math.abs(dy) / (n.h / 2));
  return [cx + dx / reach, cy + dy / reach];
}

/** Whether point `p` lies on the outline of `n`, within `by`. */
export function onOutline(n, cx, cy, p, by = 1.5) {
  const way = [Math.sign(p[0] - cx) || 1, Math.sign(p[1] - cy) || 1];
  return near(downTo(n, cx, cy, p[0], way[1]), p[1]) <= by || near(acrossTo(n, cx, cy, p[1], way[0]), p[0]) <= by;
}
