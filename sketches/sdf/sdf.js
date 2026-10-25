// Signed distance: how far a point is from a shape, negative inside. A few primitives and the ways to join them.
// Each primitive is a function (x, y) => distance, in the species' own frame.

export const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

/** An ellipse with half-axes a, b, turned by rot (Quilez's close approximation). */
export function ellipse(cx, cy, a, b, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (x, y) => {
    const dx = x - cx, dy = y - cy, px = dx * c + dy * s, py = -dx * s + dy * c;
    const k0 = Math.hypot(px / a, py / b), k1 = Math.hypot(px / (a * a), py / (b * b));
    return k1 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b);
  };
}

/** A tapering stroke from a (radius ra) to b (radius rb). */
export function cone(ax, ay, bx, by, ra, rb) {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
    return Math.hypot(x - ax - vx * t, y - ay - vy * t) - (ra + (rb - ra) * t);
  };
}

/** Everything on one side of a line through (px, py), facing (nx, ny). */
export const half = (px, py, nx, ny) => (x, y) => (x - px) * nx + (y - py) * ny;

/** A union that melts where the two meet, over a width k. */
export const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};
export const melt = (k, ...fs) => (x, y) => fs.reduce((d, f) => smin(d, f(x, y), k), Infinity);
export const both = (...fs) => (x, y) => Math.max(...fs.map((f) => f(x, y)));
export const cut = (f, g) => (x, y) => Math.max(f(x, y), -g(x, y));
