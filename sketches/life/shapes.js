// Drawing helpers: hand-drawn curves as SVG path strings, with no page.

export const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const between = (rnd, lo, hi) => lo + (hi - lo) * rnd();
export const choose = (rnd, list) => list[Math.floor(rnd() * list.length)];

const f = (v) => +v.toFixed(1);
const xy = ([x, y]) => `${f(x)} ${f(y)}`;
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** A closed curve rounded through points. */
export function closed(pts) {
  let d = `M${xy(mid(pts[pts.length - 1], pts[0]))}`;
  pts.forEach((p, i) => (d += `Q${xy(p)} ${xy(mid(p, pts[(i + 1) % pts.length]))}`));
  return d + 'Z';
}
/** An open curve rounded through points. */
export function open(pts) {
  let d = `M${xy(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) d += `Q${xy(pts[i])} ${xy(mid(pts[i], pts[i + 1]))}`;
  return d + `L${xy(pts[pts.length - 1])}`;
}
/** A straight polygon. */
export const poly = (pts) => 'M' + pts.map(xy).join('L') + 'Z';
export const circle = (x, y, r) => `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;

export const turn = ([x, y], a, [cx, cy] = [0, 0]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
export const shake = (rnd, pts, j) => pts.map(([x, y]) => [x + (rnd() - 0.5) * j, y + (rnd() - 0.5) * j]);

/** A point on a quadratic curve. */
export const bez = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];

/** Points along a centre line, pushed out each side by width(t): a stalk, a tail, a blade. */
export function band(line, width) {
  const left = [], right = [];
  line.forEach((p, i) => {
    const q = line[Math.min(i + 1, line.length - 1)], o = line[Math.max(i - 1, 0)];
    const a = Math.atan2(q[1] - o[1], q[0] - o[0]), w = width(i / (line.length - 1));
    left.push([p[0] - Math.sin(a) * w, p[1] + Math.cos(a) * w]);
    right.push([p[0] + Math.sin(a) * w, p[1] - Math.cos(a) * w]);
  });
  return [...left, ...right.reverse()];
}

/** A leaf from its base, pointing at angle a: length, width, how lobed (lobes, depth) and how it bends. */
export function leaf(base, a, len, wid, { lobes = 0, depth = 0, bend = 0, n = 10, round = 0.75 } = {}) {
  const side = (sgn) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const s = i / n, half = wid * Math.sin(Math.PI * s) ** round * (1 + depth * Math.abs(Math.sin(lobes * Math.PI * s)));
      return turn([s * len, sgn * half + bend * s * s * len], a, base);
    });
  const l = side(1), r = side(-1).reverse();
  return [...l, ...r.slice(1, -1)];
}
